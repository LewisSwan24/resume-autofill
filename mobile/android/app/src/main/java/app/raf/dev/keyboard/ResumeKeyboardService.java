package app.raf.dev.keyboard;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.inputmethodservice.InputMethodService;
import android.os.SystemClock;
import android.os.UserManager;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.widget.TextView;

import java.util.Locale;

import app.raf.dev.R;

/**
 * The resume keyboard (简历输入法): an input method that types resume entries into any field of any app,
 * plus a plain English keyboard. It runs in its own ":keyboard" process (no WebView, no Capacitor), reads only the
 * sealed projection the app writes (keyboard.enc, never creating the key), and never reads the field's text, goes
 * online, learns, suggests, copies or logs. See design sections 3.5 to 3.10 and 6.
 */
public final class ResumeKeyboardService extends InputMethodService implements KeyboardRootView.Actions {
    static final String PREFS = "kb_prefs";
    static final String PREF_TIP = "tipChineseSeen";

    private KeyboardDataStore store;
    private KeyboardRootView root;
    private KbTheme theme;

    private KeyboardData data;
    private KeyboardGate.DataState dataState = KeyboardGate.DataState.LOADING;
    private Field field = FieldClassifier.classify(0x1, 0, null, null);
    private int inputType;
    private EnterAction.Enter enter = EnterAction.of(0, 0x1);
    private boolean locked;
    private final RevealScope reveal = new RevealScope();
    private boolean typingChosen;
    private boolean pickerOpen;
    private boolean backConsumed;
    private String currentResume;
    private String selectedGroup;
    private TypingPanelView.Layer layer = TypingPanelView.Layer.LETTERS;
    private final ShiftState shift = new ShiftState();
    /** Bumped on every new field, so a slow read cannot render into a later field. */
    private int session;

    @Override
    public void onCreate() {
        super.onCreate();
        store = new KeyboardDataStore(this);
    }

    @Override
    public void onDestroy() {
        if (store != null) store.shutdown();
        data = null;
        super.onDestroy();
    }

    @Override
    public View onCreateInputView() {
        root = (KeyboardRootView) LayoutInflater.from(this).inflate(R.layout.kb_root, null);
        return root;
    }

    /** No extract mode: the field of a mini program must stay visible, and extract mode reads the field's text. */
    @Override
    public boolean onEvaluateFullscreenMode() {
        return false;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        session++;
        String hint = info.hintText == null ? null : info.hintText.toString();
        String label = info.label == null ? null : info.label.toString();
        Field next = FieldClassifier.classify(info.inputType, info.imeOptions, hint, label);
        boolean newField = FieldChange.isNew(restarting, inputType, field, info.inputType, next);
        inputType = info.inputType;
        field = next;
        enter = EnterAction.of(info.imeOptions, info.inputType);
        reveal.onStartInputView();
        if (newField) {
            typingChosen = false;
            selectedGroup = null;
            pickerOpen = false;
            layer = field.startLayer == Field.Layer.SYMBOLS ? TypingPanelView.Layer.SYMBOLS : TypingPanelView.Layer.LETTERS;
            shift.reset();
            autoCaps();
        }
        locked = isLocked();
        if (locked) {
            // Locked means typing only, and the resume leaves memory.
            store.forget();
            data = null;
            currentResume = null;
            if (dataState == KeyboardGate.DataState.READY) dataState = KeyboardGate.DataState.ABSENT;
            render();
            return;
        }
        render();
        final int started = session;
        store.loadAsync(result -> {
            if (started != session || root == null) return;
            apply(result);
            render();
        });
    }

    @Override
    public void onFinishInputView(boolean finishingInput) {
        super.onFinishInputView(finishingInput);
        pickerOpen = false;
        reveal.onFinishInput();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && pickerOpen && isInputViewShown()) {
            backConsumed = true;
            closePicker();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && backConsumed) {
            backConsumed = false;
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    // ------------------------------------------------------------ state

    private boolean isLocked() {
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        UserManager users = getSystemService(UserManager.class);
        return (keyguard != null && keyguard.isKeyguardLocked()) || (users != null && !users.isUserUnlocked());
    }

    private void apply(KeyboardDataStore.Result result) {
        switch (result.state) {
            case READY:
                data = result.data;
                dataState = KeyboardGate.DataState.READY;
                currentResume = currentResume == null ? ResumeChoice.initial(data) : ResumeChoice.reconcile(data, currentResume);
                break;
            case ABSENT:
                data = null;
                currentResume = null;
                dataState = KeyboardGate.DataState.ABSENT;
                break;
            default:
                data = null;
                currentResume = null;
                dataState = KeyboardGate.DataState.ERROR;
                break;
        }
    }

    /** The app's UI language when the data is readable, otherwise the system's. */
    private Context localized() {
        if (data == null) return this;
        Configuration c = new Configuration(getResources().getConfiguration());
        c.setLocale(Locale.forLanguageTag("zh".equals(data.ui) ? "zh-CN" : "en"));
        return createConfigurationContext(c);
    }

    private boolean compact() {
        Configuration c = getResources().getConfiguration();
        return c.orientation == Configuration.ORIENTATION_LANDSCAPE || c.screenHeightDp < 480;
    }

    /** Content height of the resume area: min(kb_panel_height, share of the window), never below bar + 4 rows. */
    private int resumeAreaHeight() {
        int window = getResources().getDisplayMetrics().heightPixels;
        float share = getResources().getConfiguration().orientation == Configuration.ORIENTATION_PORTRAIT ? 0.5f : 0.62f;
        int panel = Math.min(theme.panelHeight, Math.round(window * share));
        panel = Math.max(panel, theme.barHeight + 4 * theme.rowMinHeight);
        return panel - theme.barHeight;
    }

    // ------------------------------------------------------------ rendering

    private void render() {
        if (root == null) return;
        Context c = localized();
        theme = new KbTheme(c);
        root.applyTheme(theme);
        KeyboardGate.Mode mode = KeyboardGate.decide(locked, field, dataState, reveal.revealed());
        boolean typing = !mode.resumeArea() || typingChosen;
        TopBarView bar = root.topBar;
        bar.reset(theme);
        renderBanner(mode, typing);

        if (!typing && pickerOpen && data != null) {
            barResume(c, mode, null);
            PickerPanelView picker = new PickerPanelView(c, theme);
            picker.show(data, currentResume, this);
            root.tip.setVisibility(View.GONE);
            root.setContent(picker, resumeAreaHeight());
            return;
        }
        pickerOpen = false;
        if (typing) {
            barTyping(c, mode);
            renderTip(c);
            TypingPanelView panel = new TypingPanelView(c, theme);
            panel.show(layer, shift, enter, this);
            root.setContent(panel, ViewGroup.LayoutParams.WRAP_CONTENT);
            return;
        }
        root.tip.setVisibility(View.GONE);
        ResumePanelView panel = new ResumePanelView(c, theme);
        KeyboardData.Resume resume = data == null ? null : data.resume(currentResume);
        if (mode.kind == KeyboardGate.Kind.RESUME && resume != null) {
            EntryOrder.Panel p = EntryOrder.build(resume, field, selectedGroup, theme.string(R.string.kb_suggested));
            selectedGroup = p.selected;
            boolean merged = compact();
            barResume(c, mode, merged ? ResumePanelView.strip(c, theme, p, this) : null);
            panel.showEntries(p, this, !merged);
        } else {
            barResume(c, mode, null);
            if (mode.kind == KeyboardGate.Kind.LOADING) panel.showLoading();
            else if (mode.kind == KeyboardGate.Kind.ERROR) panel.showError(this);
            else panel.showEmpty(this);
        }
        root.setContent(panel, resumeAreaHeight());
    }

    /** [resume chip] [中|EN] (strip in compact) [⌨] [⌫] [⇄]; the empty, loading and error states keep only the last three. */
    private void barResume(Context c, KeyboardGate.Mode mode, View strip) {
        TopBarView bar = root.topBar;
        KeyboardData.Resume resume = data == null ? null : data.resume(currentResume);
        if (mode.kind == KeyboardGate.Kind.RESUME && resume != null) {
            if (data.resumes.size() > 1) bar.addStart(TopBarView.resumeChip(c, theme, resume.title, this::openPicker));
            bar.addStart(TopBarView.languageToggle(c, theme, resume.lang,
                !ResumeChoice.toggleLanguage(data, currentResume).equals(currentResume), this::toggleLanguage));
        }
        if (strip != null) bar.setMiddle(strip);
        bar.addEnd(TopBarView.iconButton(c, theme, R.drawable.kb_ic_keyboard, theme.string(R.string.kb_typing), this::showTyping));
        bar.addEnd(deleteButton(c));
        bar.addEnd(switchButton(c));
    }

    /** [▣ 简历] or [显示简历] … [⇄] [⌄]. */
    private void barTyping(Context c, KeyboardGate.Mode mode) {
        TopBarView bar = root.topBar;
        if (mode.kind == KeyboardGate.Kind.HIDDEN_CAN_REVEAL) {
            bar.addStart(TopBarView.wordButton(c, theme, R.drawable.kb_ic_person_vcard, theme.string(R.string.kb_reveal), this::reveal));
        } else if (mode.resumeArea()) {
            bar.addStart(TopBarView.wordButton(c, theme, R.drawable.kb_ic_person_vcard, theme.string(R.string.kb_resume), this::showResume));
        }
        bar.addEnd(switchButton(c));
        bar.addEnd(TopBarView.iconButton(c, theme, R.drawable.kb_ic_chevron_down, theme.string(R.string.kb_hide), this::hide));
    }

    private KeyView deleteButton(Context c) {
        KeyView k = TopBarView.iconButton(c, theme, R.drawable.kb_ic_backspace, theme.string(R.string.kb_delete), null);
        k.repeatWhileHeld(this::deleteOne);
        return k;
    }

    private KeyView switchButton(Context c) {
        KeyView k = TopBarView.iconButton(c, theme, R.drawable.kb_ic_arrow_left_right, theme.string(R.string.kb_switch_ime), this::switchIme);
        k.setOnLongClickListener(v -> {
            showImePicker();
            return true;
        });
        return k;
    }

    private void renderBanner(KeyboardGate.Mode mode, boolean typing) {
        TextView banner = root.banner;
        int text = 0;
        int icon = R.drawable.kb_ic_eye_slash;
        if (typing && mode.reason != null) {
            switch (mode.reason) {
                case LOCKED: text = R.string.kb_locked; icon = R.drawable.kb_ic_lock; break;
                case PASSWORD: text = R.string.kb_password; break;
                case SECRET: text = R.string.kb_secret; break;
                case NO_LEARNING: text = R.string.kb_no_learning; break;
                default: break;
            }
        }
        if (text == 0) {
            banner.setVisibility(View.GONE);
            return;
        }
        banner.setText(theme.string(text));
        banner.setCompoundDrawablesRelative(theme.icon(icon, theme.textMuted), null, null, null);
        banner.setVisibility(View.VISIBLE);
    }

    /** The first time the typing panel shows: 「这里打不了中文，点切换键用你的输入法」 with 「知道了」. */
    private void renderTip(Context c) {
        root.tip.removeAllViews();
        if (prefs().getBoolean(PREF_TIP, false)) {
            root.tip.setVisibility(View.GONE);
            return;
        }
        TextView text = new TextView(c);
        theme.body(text, 13, false, theme.textMuted);
        text.setText(theme.string(R.string.kb_no_chinese));
        root.tip.addView(text, new android.widget.LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView ok = TopBarView.wordButton(c, theme, R.drawable.kb_ic_check_lg, theme.string(R.string.kb_tip_dismiss), this::dismissTip);
        root.tip.addView(ok);
        root.tip.setVisibility(View.VISIBLE);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void autoCaps() {
        InputConnection ic = getCurrentInputConnection();
        // Flags only (never the text): a non-zero mode means a capital is expected here.
        if (ic != null && (inputType & FieldClassifier.TYPE_MASK_CLASS) == FieldClassifier.TYPE_CLASS_TEXT) {
            shift.autoCaps(ic.getCursorCapsMode(inputType) != 0);
        }
    }

    // ------------------------------------------------------------ actions

    @Override
    public void insert(EntryRowView row) {
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return;
        String text = InsertText.forField(row.row.item.value, field);
        if (text.isEmpty()) return;
        ic.commitText(text, 1);
        row.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
        row.showInserted();
        root.announceForAccessibility(theme.string(R.string.kb_inserted, row.row.item.label));
    }

    @Override
    public void selectGroup(String id) {
        selectedGroup = id;
        render();
    }

    @Override
    public void openPicker() {
        pickerOpen = true;
        render();
    }

    @Override
    public void closePicker() {
        pickerOpen = false;
        render();
    }

    @Override
    public void pickResume(String id) {
        currentResume = id;
        selectedGroup = null;
        pickerOpen = false;
        render();
    }

    @Override
    public void toggleLanguage() {
        if (data == null) return;
        currentResume = ResumeChoice.toggleLanguage(data, currentResume);
        selectedGroup = null;
        render();
    }

    @Override
    public void showTyping() {
        typingChosen = true;
        render();
    }

    @Override
    public void showResume() {
        typingChosen = false;
        render();
    }

    @Override
    public void deleteOne() {
        sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL);
    }

    /**
     * Back to the previous keyboard; the next enabled one when the system has no previous entry; the system picker when
     * neither works. On the API 36 emulator the history lists the current keyboard first after a switch,
     * so switchToPreviousInputMethod returns false there and the next keyboard is the way back.
     */
    @Override
    public void switchIme() {
        if (switchToPreviousInputMethod()) return;
        if (switchToNextInputMethod(false)) return;
        showImePicker();
    }

    @Override
    public void showImePicker() {
        InputMethodManager imm = getSystemService(InputMethodManager.class);
        if (imm != null) imm.showInputMethodPicker();
    }

    @Override
    public void hide() {
        requestHideSelf(0);
    }

    @Override
    public void openApp() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                startActivity(launch);
            } catch (RuntimeException e) {
                // nothing to report: the keyboard stays as it is
            }
        }
        requestHideSelf(0);
    }

    @Override
    public void reveal() {
        reveal.reveal();
        typingChosen = false;
        render();
    }

    @Override
    public void dismissTip() {
        prefs().edit().putBoolean(PREF_TIP, true).apply();
        render();
    }

    @Override
    public void key(KeyboardLayouts.Key key) {
        InputConnection ic = getCurrentInputConnection();
        switch (key.type) {
            case CHAR:
            case COMMA:
            case PERIOD: {
                if (ic == null) return;
                boolean letter = key.text.length() == 1 && Character.isLetter(key.text.charAt(0)) && key.text.charAt(0) < 0x80;
                String text = letter && shift.upper() ? key.text.toUpperCase(Locale.ROOT) : key.text;
                ic.commitText(text, 1);
                if (letter && shift.state() == ShiftState.State.ONCE) {
                    shift.afterLetter();
                    render();
                }
                return;
            }
            case SPACE:
                if (ic == null) return;
                ic.commitText(" ", 1);
                if (shift.state() == ShiftState.State.OFF) {
                    autoCaps();
                    if (shift.state() != ShiftState.State.OFF) render();
                }
                return;
            case SHIFT:
                shift.tap(SystemClock.uptimeMillis());
                render();
                return;
            case DELETE:
                deleteOne();
                return;
            case SYMBOLS:
                layer = TypingPanelView.Layer.SYMBOLS;
                render();
                return;
            case MORE:
                layer = TypingPanelView.Layer.MORE;
                render();
                return;
            case LETTERS:
                layer = TypingPanelView.Layer.LETTERS;
                render();
                return;
            case ENTER:
                if (ic == null) return;
                if (enter.kind == EnterAction.Kind.ACTION) ic.performEditorAction(enter.actionId);
                else if (enter.commitNewline) ic.commitText("\n", 1);
                else sendDownUpKeyEvents(KeyEvent.KEYCODE_ENTER);
                return;
            default:
                return;
        }
    }
}
