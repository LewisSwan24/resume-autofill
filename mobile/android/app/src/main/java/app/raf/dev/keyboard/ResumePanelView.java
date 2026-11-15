package app.raf.dev.keyboard;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * The resume panel: the module strip, then a scrolling list of section headers and entry rows with 1dp
 * dividers. The same area shows the empty, loading and error states. No RecyclerView: at most 600 rows per resume.
 */
final class ResumePanelView extends LinearLayout {
    private final KbTheme theme;

    ResumePanelView(Context context, KbTheme theme) {
        super(context);
        this.theme = theme;
        setOrientation(VERTICAL);
        setBackgroundColor(theme.bg);
        setElevation(0);
    }

    /** The horizontally scrolling strip of chips (推荐 first when there are suggestions). */
    static HorizontalScrollView strip(Context c, KbTheme theme, EntryOrder.Panel panel, KeyboardRootView.Actions actions) {
        HorizontalScrollView scroll = new HorizontalScrollView(c);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setFillViewport(false);
        LinearLayout chips = new LinearLayout(c);
        chips.setOrientation(HORIZONTAL);
        chips.setGravity(Gravity.CENTER_VERTICAL);
        chips.setPadding(theme.sidePadding, 0, theme.sidePadding, 0);
        View chosen = null;
        for (EntryOrder.Chip chip : panel.strip) {
            ChipView v = new ChipView(c, theme, chip.id, chip.label);
            boolean on = chip.id.equals(panel.selected);
            v.setChosen(on, theme);
            v.setOnClickListener(x -> actions.selectGroup(chip.id));
            LayoutParams lp = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(theme.dp(8));
            chips.addView(v, lp);
            if (on) chosen = v;
        }
        scroll.addView(chips);
        if (chosen != null) {
            final View target = chosen;
            scroll.post(() -> scroll.scrollTo(Math.max(0, target.getLeft() - theme.dp(16)), 0));
        }
        return scroll;
    }

    void showEntries(EntryOrder.Panel panel, KeyboardRootView.Actions actions, boolean withStrip) {
        removeAllViews();
        Context c = getContext();
        if (withStrip) {
            HorizontalScrollView strip = strip(c, theme, panel, actions);
            addView(strip, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
            strip.setMinimumHeight(theme.target);
            addView(divider(), new LayoutParams(LayoutParams.MATCH_PARENT, theme.line));
        }
        ScrollView scroll = new ScrollView(c);
        scroll.setFillViewport(true);
        LinearLayout list = new LinearLayout(c);
        list.setOrientation(VERTICAL);
        list.setBackgroundColor(theme.surface);
        boolean first = true;
        for (EntryOrder.Row row : panel.rows) {
            if (row.isHeader()) {
                list.addView(header(row.text));
                first = true;
                continue;
            }
            if (!first) list.addView(divider(), new LayoutParams(LayoutParams.MATCH_PARENT, theme.line));
            first = false;
            EntryRowView v = new EntryRowView(c, theme, row);
            v.setOnClickListener(x -> actions.insert(v));
            list.addView(v, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        scroll.addView(list);
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
    }

    private TextView header(String text) {
        TextView t = new TextView(getContext());
        theme.body(t, 13, true, theme.textMuted);
        t.setText(text);
        t.setMinHeight(theme.dp(32));
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setPadding(theme.dp(16), theme.dp(8), theme.dp(16), theme.dp(4));
        t.setBackgroundColor(theme.bg);
        t.setAccessibilityHeading(true);
        t.setFocusable(false);
        return t;
    }

    private View divider() {
        View d = new View(getContext());
        d.setBackgroundColor(theme.border);
        d.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        return d;
    }

    /** EMPTY: 「输入法里还没有简历」, how to turn it on, and 「打开 App」. */
    void showEmpty(KeyboardRootView.Actions actions) {
        removeAllViews();
        LinearLayout box = stateBox();
        TextView title = new TextView(getContext());
        theme.body(title, 15, true, theme.text);
        title.setText(theme.string(R.string.kb_empty_title));
        title.setAccessibilityHeading(true);
        box.addView(title);
        TextView text = new TextView(getContext());
        theme.body(text, 13, false, theme.textMuted);
        text.setText(theme.string(R.string.kb_empty_text));
        text.setPadding(0, theme.dp(8), 0, theme.dp(12));
        box.addView(text);
        box.addView(openApp(actions));
        addScrolling(box);
    }

    void showLoading() {
        removeAllViews();
        LinearLayout box = stateBox();
        TextView t = new TextView(getContext());
        theme.body(t, 15, false, theme.textMuted);
        t.setText(theme.string(R.string.kb_loading));
        box.addView(t);
        addScrolling(box);
    }

    /** ERROR: exclamation-triangle, 「读不出简历。打开 App 一次再试。」 and 「打开 App」. */
    void showError(KeyboardRootView.Actions actions) {
        removeAllViews();
        LinearLayout box = stateBox();
        TextView t = new TextView(getContext());
        theme.body(t, 15, false, theme.text);
        t.setText(theme.string(R.string.kb_error));
        t.setCompoundDrawablePadding(theme.dp(8));
        t.setCompoundDrawablesRelative(theme.icon(R.drawable.kb_ic_exclamation_triangle, theme.text), null, null, null);
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setPadding(0, 0, 0, theme.dp(12));
        box.addView(t);
        box.addView(openApp(actions));
        addScrolling(box);
    }

    private LinearLayout stateBox() {
        LinearLayout box = new LinearLayout(getContext());
        box.setOrientation(VERTICAL);
        box.setPadding(theme.dp(16), theme.dp(16), theme.dp(16), theme.dp(16));
        return box;
    }

    private View openApp(KeyboardRootView.Actions actions) {
        TextView b = TopBarView.wordButton(getContext(), theme, R.drawable.kb_ic_box_arrow_up_right,
            theme.string(R.string.kb_open_app), actions::openApp);
        LinearLayout.LayoutParams lp = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        b.setLayoutParams(lp);
        return b;
    }

    private void addScrolling(View box) {
        ScrollView scroll = new ScrollView(getContext());
        scroll.addView(box);
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
    }
}
