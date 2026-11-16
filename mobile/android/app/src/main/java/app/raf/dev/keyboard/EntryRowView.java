package app.raf.dev.keyboard;

import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * One resume entry in the keyboard: label above a two-line value preview. TalkBack hears the label only
 * (A11yText); the value is offered through the custom action 「读出内容」, never on focus. After an insert the
 * row shows check-lg and 「已输入：{label}」 for 1.2 s.
 */
final class EntryRowView extends LinearLayout {
    static final long INSERTED_MS = 1200;

    final EntryOrder.Row row;
    private final KbTheme theme;
    private final TextView value;
    private final ImageView check;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable restore;

    EntryRowView(Context context, KbTheme theme, EntryOrder.Row row) {
        super(context);
        this.row = row;
        this.theme = theme;
        setOrientation(HORIZONTAL);
        setBackground(theme.row());
        setMinimumHeight(theme.rowMinHeight);
        setPadding(theme.dp(16), theme.dp(8), theme.dp(12), theme.dp(8));
        setGravity(android.view.Gravity.CENTER_VERTICAL);
        setClickable(true);
        setFocusable(true);
        setElevation(0);
        setSoundEffectsEnabled(false);

        LinearLayout texts = new LinearLayout(context);
        texts.setOrientation(VERTICAL);
        TextView label = new TextView(context);
        theme.body(label, 15, true, theme.text);
        label.setText(row.label);
        value = new TextView(context);
        theme.body(value, 13, false, theme.textMuted);
        value.setMaxLines(2);
        value.setEllipsize(TextUtils.TruncateAt.END);
        value.setPadding(0, theme.dp(4), 0, 0);
        texts.addView(label);
        texts.addView(value);
        addView(texts, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        check = new ImageView(context);
        check.setImageDrawable(theme.icon(R.drawable.kb_ic_check_lg, theme.text));
        check.setVisibility(GONE);
        check.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        addView(check, new LayoutParams(theme.icon, theme.icon));
        restore = this::showPreview;
        showPreview();

        // The label (and section prefix) only; the children are not separate nodes.
        setContentDescription(row.a11yLabel);
        texts.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        final String readLabel = theme.string(R.string.kb_read_value);
        setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override
            public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.kb_action_read_value, readLabel));
            }

            @Override
            public boolean performAccessibilityAction(View host, int action, Bundle args) {
                if (action == R.id.kb_action_read_value) {
                    host.announceForAccessibility(row.item.value);
                    return true;
                }
                return super.performAccessibilityAction(host, action, args);
            }
        });
    }

    private void showPreview() {
        // Line breaks show as spaces in the preview only; the inserted text follows InsertText.
        value.setText(row.item.value.replaceAll("\\s*\\r?\\n\\s*", " "));
        check.setVisibility(GONE);
    }

    /** The inserted feedback: check-lg and 「已输入：{label}」 for 1.2 s. */
    void showInserted() {
        handler.removeCallbacks(restore);
        value.setText(theme.string(R.string.kb_inserted, row.item.label));
        check.setVisibility(VISIBLE);
        handler.postDelayed(restore, INSERTED_MS);
    }

    @Override
    protected void onDetachedFromWindow() {
        handler.removeCallbacks(restore);
        super.onDetachedFromWindow();
    }

    @Override
    public CharSequence getAccessibilityClassName() {
        return Button.class.getName();
    }
}
