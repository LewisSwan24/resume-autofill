package app.raf.dev.keyboard;

import android.content.Context;
import android.os.Build;
import android.text.TextUtils;
import android.view.Gravity;
import android.widget.Button;
import android.widget.TextView;

/** A pill chip of the module strip: at least 48dp tall, selected state exposed to TalkBack. */
final class ChipView extends TextView {
    final String chipId;

    ChipView(Context context, KbTheme theme, String chipId, String label) {
        super(context);
        this.chipId = chipId;
        setText(label);
        // Named for TalkBack and for selectors that look views up by description (device tests).
        setContentDescription(label);
        theme.body(this, 15, true, theme.text);
        setBackground(theme.chip());
        setGravity(Gravity.CENTER);
        setSingleLine(true);
        setEllipsize(TextUtils.TruncateAt.END);
        setMinHeight(theme.target);
        setMinWidth(theme.target);
        setPadding(theme.dp(16), theme.dp(4), theme.dp(16), theme.dp(4));
        setClickable(true);
        setFocusable(true);
        setElevation(0);
        setSoundEffectsEnabled(false);
    }

    void setChosen(boolean chosen, KbTheme theme) {
        setSelected(chosen);
        setTextColor(chosen ? theme.onSelected : theme.text);
        if (Build.VERSION.SDK_INT >= 30) setStateDescription(chosen ? theme.string(app.raf.dev.R.string.kb_selected) : null);
    }

    @Override
    public CharSequence getAccessibilityClassName() {
        return Button.class.getName();
    }
}
