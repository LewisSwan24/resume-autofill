package app.raf.dev.keyboard;

import android.content.Context;
import android.content.res.Resources;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.InsetDrawable;
import android.graphics.drawable.StateListDrawable;
import android.util.TypedValue;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * Lively Icons on the keyboard: every colour comes from the generated raf_color_* resources (light
 * in values, dark in values-night, which follows the system), the type is the generated Lexend family, and lines are
 * 1dp with no shadows. Built from the (possibly localised) context the keyboard renders with.
 */
final class KbTheme {
    static final float GLYPH_SCALE_MAX = 1.3f;
    private static final int[] PRESSED = {android.R.attr.state_pressed};
    private static final int[] FOCUSED = {android.R.attr.state_focused};
    private static final int[] SELECTED = {android.R.attr.state_selected};
    private static final int[] DISABLED = {-android.R.attr.state_enabled};
    private static final int[] DEFAULT = {};

    final Context context;
    final int bg;
    final int surface;
    final int surfaceHover;
    final int text;
    final int textMuted;
    final int primary;
    final int primaryText;
    final int border;
    final int focus;
    final int selected;
    final int onSelected;
    final int placeholder;
    final Typeface regular;
    final Typeface semibold;
    final int line;
    final int focusLine;
    final int radius;
    final int keyGap;
    final int keyMinHeight;
    final int rowMinHeight;
    final int barHeight;
    final int panelHeight;
    final int sidePadding;
    final int icon;
    final int target;
    final float density;
    final float fontScale;

    KbTheme(Context context) {
        this.context = context;
        Resources r = context.getResources();
        bg = context.getColor(R.color.raf_color_bg);
        surface = context.getColor(R.color.raf_color_surface);
        surfaceHover = context.getColor(R.color.raf_color_surface_hover);
        text = context.getColor(R.color.raf_color_text);
        textMuted = context.getColor(R.color.raf_color_text_muted);
        primary = context.getColor(R.color.raf_color_primary);
        primaryText = context.getColor(R.color.raf_color_primary_text);
        border = context.getColor(R.color.raf_color_border);
        focus = context.getColor(R.color.raf_color_focus);
        selected = context.getColor(R.color.raf_color_selected);
        onSelected = context.getColor(R.color.raf_color_on_selected);
        placeholder = context.getColor(R.color.raf_color_placeholder);
        Typeface family;
        try {
            family = r.getFont(R.font.raf_lexend);
        } catch (Resources.NotFoundException e) {
            family = Typeface.DEFAULT;
        }
        regular = Typeface.create(family, 400, false);
        semibold = Typeface.create(family, 600, false);
        line = r.getDimensionPixelSize(R.dimen.kb_line);
        focusLine = r.getDimensionPixelSize(R.dimen.kb_focus_line);
        radius = r.getDimensionPixelSize(R.dimen.kb_radius);
        keyGap = r.getDimensionPixelSize(R.dimen.kb_key_gap);
        keyMinHeight = r.getDimensionPixelSize(R.dimen.kb_key_min_height);
        rowMinHeight = r.getDimensionPixelSize(R.dimen.kb_row_min_height);
        barHeight = r.getDimensionPixelSize(R.dimen.kb_bar_height);
        panelHeight = r.getDimensionPixelSize(R.dimen.kb_panel_height);
        sidePadding = r.getDimensionPixelSize(R.dimen.kb_side_padding);
        icon = r.getDimensionPixelSize(R.dimen.kb_icon);
        target = r.getDimensionPixelSize(R.dimen.kb_target);
        density = r.getDisplayMetrics().density;
        fontScale = r.getConfiguration().fontScale;
    }

    int dp(float v) {
        return Math.round(v * density);
    }

    String string(int id) {
        return context.getString(id);
    }

    String string(int id, String arg) {
        return context.getString(id, arg);
    }

    /** Text that follows the font scale fully (labels, values, chips, banners). */
    void body(TextView v, float sp, boolean strong, int color) {
        v.setTypeface(strong ? semibold : regular);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTextColor(color);
        v.setIncludeFontPadding(false);
    }

    /** Key glyphs and key words grow with the font scale only up to 1.3x, so they still fit in a key. */
    void glyph(TextView v, float dpSize, boolean strong, int color) {
        v.setTypeface(strong ? semibold : regular);
        v.setTextSize(TypedValue.COMPLEX_UNIT_PX, dpSize * density * Math.min(fontScale, GLYPH_SCALE_MAX));
        v.setTextColor(color);
        v.setIncludeFontPadding(false);
    }

    private GradientDrawable shape(int fill, int strokeWidth, int strokeColor, float cornerRadius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        if (strokeWidth > 0) d.setStroke(strokeWidth, strokeColor);
        d.setCornerRadius(cornerRadius);
        return d;
    }

    private Drawable inset(Drawable d) {
        int half = keyGap / 2;
        return new InsetDrawable(d, half, half, half, half);
    }

    /** A letter or symbol key (surface) or a function key (bg); pressed deepens the line, focus draws a 2dp outline. */
    Drawable key(boolean function) {
        int fill = function ? bg : surface;
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, inset(shape(surfaceHover, line, text, radius)));
        s.addState(FOCUSED, inset(shape(fill, focusLine, focus, radius)));
        s.addState(DEFAULT, inset(shape(fill, line, border, radius)));
        return s;
    }

    /** The action key: primary fill at full opacity, no line. */
    Drawable actionKey() {
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, inset(shape(primary, line, text, radius)));
        s.addState(FOCUSED, inset(shape(primary, focusLine, focus, radius)));
        s.addState(DEFAULT, inset(shape(primary, 0, 0, radius)));
        return s;
    }

    /** A pill chip; selected = selected fill with an on_selected line. */
    Drawable chip() {
        float pill = dp(100);
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, shape(surfaceHover, line, text, pill));
        s.addState(FOCUSED, shape(surface, focusLine, focus, pill));
        s.addState(SELECTED, shape(selected, line, onSelected, pill));
        s.addState(DEFAULT, shape(surface, line, border, pill));
        return s;
    }

    /** One segment of the 中|EN toggle (like m-segmented). */
    Drawable segment() {
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, shape(surfaceHover, line, text, radius));
        s.addState(FOCUSED, shape(surface, focusLine, focus, radius));
        s.addState(SELECTED, shape(selected, line, onSelected, radius));
        s.addState(DISABLED, shape(bg, line, border, radius));
        s.addState(DEFAULT, shape(surface, line, border, radius));
        return s;
    }

    /** An entry row or a picker row: surface, pressed surface_hover, focus outline. */
    Drawable row() {
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, shape(surfaceHover, 0, 0, 0));
        s.addState(FOCUSED, shape(surface, focusLine, focus, 0));
        s.addState(DEFAULT, shape(surface, 0, 0, 0));
        return s;
    }

    /** A borderless 48dp icon button in the top bar. */
    Drawable iconButton() {
        StateListDrawable s = new StateListDrawable();
        s.addState(PRESSED, shape(surfaceHover, 0, 0, radius));
        s.addState(FOCUSED, shape(bg, focusLine, focus, radius));
        s.addState(SELECTED, shape(selected, line, onSelected, radius));
        s.addState(DEFAULT, shape(bg, 0, 0, radius));
        return s;
    }

    /** A generated kb_ic_* icon tinted with {@code color}. */
    Drawable icon(int resId, int color) {
        Drawable d = context.getDrawable(resId);
        if (d == null) return null;
        d = d.mutate();
        d.setTint(color);
        d.setBounds(0, 0, icon, icon);
        return d;
    }
}
