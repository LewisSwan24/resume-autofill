package app.raf.dev.keyboard;

import android.content.Context;
import android.widget.LinearLayout;

import java.util.List;
import java.util.Locale;

import app.raf.dev.R;

/**
 * The typing panel: four rows of keys weighted to the window width, one KeyView per key. Letter
 * keys are at least 48dp tall but may be narrower than 48dp; their hit area includes the gaps.
 */
final class TypingPanelView extends LinearLayout {
    enum Layer { LETTERS, SYMBOLS, MORE }

    private final KbTheme theme;

    TypingPanelView(Context context, KbTheme theme) {
        super(context);
        this.theme = theme;
        setOrientation(VERTICAL);
        setBackgroundColor(theme.bg);
        setPadding(theme.sidePadding, theme.dp(2), theme.sidePadding, theme.dp(2));
        setElevation(0);
    }

    void show(Layer layer, ShiftState shift, EnterAction.Enter enter, KeyboardRootView.Actions actions) {
        removeAllViews();
        List<List<KeyboardLayouts.Key>> rows = layer == Layer.LETTERS ? KeyboardLayouts.letters()
            : layer == Layer.SYMBOLS ? KeyboardLayouts.symbols() : KeyboardLayouts.moreSymbols();
        for (List<KeyboardLayouts.Key> keys : rows) {
            LinearLayout row = new LinearLayout(getContext());
            row.setOrientation(HORIZONTAL);
            row.setMinimumHeight(theme.keyMinHeight);
            for (KeyboardLayouts.Key k : keys) {
                LayoutParams lp = new LayoutParams(0, theme.keyMinHeight, k.weight);
                if (k.type == KeyboardLayouts.KeyType.SPACER) {
                    android.view.View spacer = new android.view.View(getContext());
                    spacer.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
                    row.addView(spacer, lp);
                    continue;
                }
                row.addView(key(k, shift, enter, actions), lp);
            }
            addView(row, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
    }

    private KeyView key(KeyboardLayouts.Key k, ShiftState shift, EnterAction.Enter enter, KeyboardRootView.Actions actions) {
        KeyView v = new KeyView(getContext());
        boolean function = k.type != KeyboardLayouts.KeyType.CHAR && k.type != KeyboardLayouts.KeyType.SPACE
            && k.type != KeyboardLayouts.KeyType.COMMA && k.type != KeyboardLayouts.KeyType.PERIOD;
        v.setBackground(k.type == KeyboardLayouts.KeyType.ENTER ? theme.actionKey() : theme.key(function));
        String description = k.a11yKey == null ? null : string(k.a11yKey);
        switch (k.type) {
            case CHAR: {
                boolean letter = k.text.length() == 1 && Character.isLetter(k.text.charAt(0)) && k.text.charAt(0) < 0x80;
                String shown = letter && shift.upper() ? k.text.toUpperCase(Locale.ROOT) : k.text;
                v.showText(shown);
                theme.glyph(v.label, 20, false, theme.text);
                v.setContentDescription(description != null ? description : shown);
                v.onTap(() -> actions.key(k));
                break;
            }
            case SHIFT: {
                ShiftState.State s = shift.state();
                int icon = s == ShiftState.State.LOCKED ? R.drawable.kb_ic_capslock_fill
                    : s == ShiftState.State.ONCE ? R.drawable.kb_ic_shift_fill : R.drawable.kb_ic_shift;
                v.showIcon(theme.icon(icon, theme.text));
                v.setContentDescription(theme.string(R.string.kb_shift));
                v.setState(s != ShiftState.State.OFF,
                    theme.string(s == ShiftState.State.LOCKED ? R.string.kb_caps_lock : R.string.kb_shift_on));
                v.onTap(() -> actions.key(k));
                break;
            }
            case DELETE:
                v.showIcon(theme.icon(R.drawable.kb_ic_backspace, theme.text));
                v.setContentDescription(description);
                v.repeatWhileHeld(actions::deleteOne);
                break;
            case SPACE:
                v.showText(theme.string(R.string.kb_space_caption));
                theme.glyph(v.label, 13, false, theme.textMuted);
                v.setContentDescription(description);
                v.onTap(() -> actions.key(k));
                break;
            case ENTER:
                if (enter.kind == EnterAction.Kind.ACTION) {
                    String word = string(enter.labelKey);
                    v.showText(word);
                    theme.glyph(v.label, 15, true, theme.primaryText);
                    v.setContentDescription(word);
                } else {
                    v.showIcon(theme.icon(R.drawable.kb_ic_arrow_return_left, theme.primaryText));
                    v.setContentDescription(description);
                }
                v.onTap(() -> actions.key(k));
                break;
            default:
                // 123, #+=, ABC, comma and period.
                v.showText(k.text);
                theme.glyph(v.label, k.type == KeyboardLayouts.KeyType.COMMA || k.type == KeyboardLayouts.KeyType.PERIOD ? 20 : 15,
                    k.type != KeyboardLayouts.KeyType.COMMA && k.type != KeyboardLayouts.KeyType.PERIOD, theme.text);
                v.setContentDescription(description);
                v.onTap(() -> actions.key(k));
                break;
        }
        return v;
    }

    /** A kb_* string by resource name; the names come from KeyboardLayouts and EnterAction. */
    private String string(String name) {
        switch (name) {
            case "kb_shift": return theme.string(R.string.kb_shift);
            case "kb_delete": return theme.string(R.string.kb_delete);
            case "kb_symbols": return theme.string(R.string.kb_symbols);
            case "kb_more_symbols": return theme.string(R.string.kb_more_symbols);
            case "kb_letters": return theme.string(R.string.kb_letters);
            case "kb_space": return theme.string(R.string.kb_space);
            case "kb_comma": return theme.string(R.string.kb_comma);
            case "kb_period": return theme.string(R.string.kb_period);
            case "kb_hyphen": return theme.string(R.string.kb_hyphen);
            case "kb_enter": return theme.string(R.string.kb_enter);
            case "kb_action_go": return theme.string(R.string.kb_action_go);
            case "kb_action_search": return theme.string(R.string.kb_action_search);
            case "kb_action_send": return theme.string(R.string.kb_action_send);
            case "kb_action_next": return theme.string(R.string.kb_action_next);
            case "kb_action_done": return theme.string(R.string.kb_action_done);
            case "kb_action_previous": return theme.string(R.string.kb_action_previous);
            default: return null;
        }
    }
}
