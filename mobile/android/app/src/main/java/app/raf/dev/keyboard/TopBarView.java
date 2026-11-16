package app.raf.dev.keyboard;

import android.content.Context;
import android.os.Build;
import android.text.TextUtils;
import android.util.AttributeSet;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * The 48dp bar above the panels: controls at the start, a middle slot (empty, or the module strip in the
 * compact landscape layout of 4.7) and icon buttons at the end. Every control is at least 48 x 48dp.
 */
public final class TopBarView extends LinearLayout {
    static final String LANG_ZH = "中";
    static final String LANG_EN = "EN";
    static final int TITLE_MAX = 14;

    private LinearLayout start;
    private FrameLayout middle;
    private LinearLayout end;

    public TopBarView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER_VERTICAL);
        setElevation(0);
    }

    void reset(KbTheme theme) {
        removeAllViews();
        setPadding(theme.sidePadding, 0, theme.sidePadding, 0);
        setMinimumHeight(theme.barHeight);
        start = row();
        middle = new FrameLayout(getContext());
        end = row();
        addView(start, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        addView(middle, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        addView(end, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
    }

    private LinearLayout row() {
        LinearLayout l = new LinearLayout(getContext());
        l.setOrientation(HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    void addStart(View v) {
        start.addView(v);
    }

    void setMiddle(View v) {
        middle.removeAllViews();
        middle.addView(v, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));
    }

    void addEnd(View v) {
        end.addView(v);
    }

    /** A 48 x 48dp icon button with a content description. */
    static KeyView iconButton(Context c, KbTheme theme, int drawable, String description, Runnable action) {
        KeyView k = new KeyView(c);
        k.setBackground(theme.iconButton());
        k.showIcon(theme.icon(drawable, theme.text));
        k.setContentDescription(description);
        k.setMinimumWidth(theme.target);
        k.setMinimumHeight(theme.target);
        k.setLayoutParams(new LayoutParams(theme.target, theme.target));
        if (action != null) k.onTap(action);
        return k;
    }

    /** An icon + word button (「简历」, 「显示简历」), pill shaped, at least 48dp tall. */
    static TextView wordButton(Context c, KbTheme theme, int drawable, String word, Runnable action) {
        TextView t = new TextView(c);
        theme.body(t, 15, true, theme.text);
        t.setText(word);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setBackground(theme.chip());
        t.setMinHeight(theme.target);
        t.setMinWidth(theme.target);
        t.setPadding(theme.dp(12), 0, theme.dp(14), 0);
        t.setCompoundDrawablePadding(theme.dp(6));
        t.setCompoundDrawablesRelative(theme.icon(drawable, theme.text), null, null, null);
        t.setClickable(true);
        t.setFocusable(true);
        t.setSoundEffectsEnabled(false);
        t.setAccessibilityDelegate(new ButtonRole());
        t.setOnClickListener(v -> action.run());
        return t;
    }

    /** The resume chip: person-vcard, the title cut at 14 characters, chevron-down; opens the picker. */
    static TextView resumeChip(Context c, KbTheme theme, String title, Runnable action) {
        String shown = title.codePointCount(0, title.length()) > TITLE_MAX
            ? title.substring(0, title.offsetByCodePoints(0, TITLE_MAX)) + "…"
            : title;
        TextView t = wordButton(c, theme, R.drawable.kb_ic_person_vcard, shown, action);
        t.setCompoundDrawablesRelative(theme.icon(R.drawable.kb_ic_person_vcard, theme.text), null,
            theme.icon(R.drawable.kb_ic_chevron_down, theme.text), null);
        t.setContentDescription(theme.string(R.string.kb_switch_resume, title));
        return t;
    }

    /** The 中|EN toggle: the current resume's language is selected; the other goes to its counterpart. */
    static LinearLayout languageToggle(Context c, KbTheme theme, String lang, boolean hasCounterpart, Runnable toggle) {
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(HORIZONTAL);
        box.setPadding(theme.dp(4), 0, theme.dp(4), 0);
        for (String side : new String[] {"zh", "en"}) {
            TextView seg = new TextView(c);
            theme.body(seg, 15, true, theme.text);
            seg.setText(side.equals("zh") ? LANG_ZH : LANG_EN);
            seg.setGravity(Gravity.CENTER);
            seg.setBackground(theme.segment());
            seg.setMinWidth(theme.target);
            seg.setMinHeight(theme.target);
            seg.setPadding(theme.dp(8), 0, theme.dp(8), 0);
            seg.setSoundEffectsEnabled(false);
            seg.setAccessibilityDelegate(new ButtonRole());
            boolean current = side.equals(lang);
            seg.setSelected(current);
            if (current) {
                seg.setTextColor(theme.onSelected);
                if (Build.VERSION.SDK_INT >= 30) seg.setStateDescription(theme.string(R.string.kb_selected));
            } else if (hasCounterpart) {
                seg.setContentDescription(theme.string(side.equals("en") ? R.string.kb_lang_to_en : R.string.kb_lang_to_zh));
                seg.setClickable(true);
                seg.setFocusable(true);
                seg.setOnClickListener(v -> toggle.run());
            } else {
                seg.setEnabled(false);
                seg.setTextColor(theme.textMuted);
                seg.setContentDescription(theme.string(R.string.kb_lang_none));
            }
            box.addView(seg, new LayoutParams(LayoutParams.WRAP_CONTENT, theme.target));
        }
        return box;
    }

    /** Gives a TextView the Button role for TalkBack and the device tests. */
    static final class ButtonRole extends View.AccessibilityDelegate {
        @Override
        public void onInitializeAccessibilityNodeInfo(View host, android.view.accessibility.AccessibilityNodeInfo info) {
            super.onInitializeAccessibilityNodeInfo(host, info);
            info.setClassName(android.widget.Button.class.getName());
        }
    }
}
