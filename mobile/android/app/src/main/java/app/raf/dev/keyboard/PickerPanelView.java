package app.raf.dev.keyboard;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * 「选简历」: replaces the strip and the entries until it closes. One row per resume (title, 中 / EN tag,
 * check-lg on the current one), each at least 48dp. The choice stays in the keyboard process's memory.
 */
final class PickerPanelView extends LinearLayout {
    private final KbTheme theme;

    PickerPanelView(Context context, KbTheme theme) {
        super(context);
        this.theme = theme;
        setOrientation(VERTICAL);
        setBackgroundColor(theme.bg);
        setElevation(0);
    }

    void show(KeyboardData data, String current, KeyboardRootView.Actions actions) {
        removeAllViews();
        Context c = getContext();
        LinearLayout head = new LinearLayout(c);
        head.setOrientation(HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setPadding(theme.dp(16), 0, theme.sidePadding, 0);
        TextView title = new TextView(c);
        theme.body(title, 15, true, theme.text);
        title.setText(theme.string(R.string.kb_pick_resume));
        title.setAccessibilityHeading(true);
        head.addView(title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        head.addView(TopBarView.iconButton(c, theme, R.drawable.kb_ic_x_lg, theme.string(R.string.kb_close), actions::closePicker));
        addView(head, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(c);
        LinearLayout list = new LinearLayout(c);
        list.setOrientation(VERTICAL);
        list.setBackgroundColor(theme.surface);
        for (KeyboardData.Resume r : data.resumes) {
            if (list.getChildCount() > 0) {
                View d = new View(c);
                d.setBackgroundColor(theme.border);
                list.addView(d, new LayoutParams(LayoutParams.MATCH_PARENT, theme.line));
            }
            list.addView(row(r, r.id.equals(current), actions), new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        }
        scroll.addView(list);
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
    }

    private View row(KeyboardData.Resume r, boolean current, KeyboardRootView.Actions actions) {
        Context c = getContext();
        LinearLayout row = new LinearLayout(c);
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(theme.row());
        row.setMinimumHeight(theme.target);
        row.setPadding(theme.dp(16), theme.dp(8), theme.dp(12), theme.dp(8));
        row.setClickable(true);
        row.setFocusable(true);
        row.setSoundEffectsEnabled(false);
        row.setAccessibilityDelegate(new TopBarView.ButtonRole());
        TextView name = new TextView(c);
        theme.body(name, 15, true, theme.text);
        name.setText(r.title);
        row.addView(name, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        TextView tag = new TextView(c);
        theme.body(tag, 13, true, theme.textMuted);
        String lang = r.lang.equals("zh") ? TopBarView.LANG_ZH : TopBarView.LANG_EN;
        tag.setText(lang);
        tag.setPadding(theme.dp(8), 0, theme.dp(8), 0);
        row.addView(tag);
        ImageView check = new ImageView(c);
        check.setImageDrawable(theme.icon(R.drawable.kb_ic_check_lg, theme.text));
        check.setVisibility(current ? VISIBLE : INVISIBLE);
        row.addView(check, new LayoutParams(theme.icon, theme.icon));
        row.setContentDescription(r.title + " " + lang);
        row.setSelected(current);
        if (current && android.os.Build.VERSION.SDK_INT >= 30) row.setStateDescription(theme.string(R.string.kb_selected));
        for (int k = 0; k < row.getChildCount(); k++) row.getChildAt(k).setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.setOnClickListener(v -> actions.pickResume(r.id));
        return row;
    }
}
