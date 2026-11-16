package app.raf.dev;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.core.view.ViewCompat;

/**
 * The 「一键填写」 pill over the page. Words, colours, icon and position come from TypeScript (fabModel, fabPlacement);
 * this view only draws them: 1px line, no elevation, 14sp text and 12sp subtext that wrap to two lines each, at
 * least 48dp tall, at most 60% of the page-area width. A drag moves it within the page area, a tap fills, and
 * TalkBack gets a "move to the other side" action instead of the drag.
 */
final class FabView extends LinearLayout {
    interface Listener {
        void onTap();

        void onMoved(float xDp, float yDp);

        void onSwitchSide();
    }

    private final float density;
    private final ImageView icon;
    private final ProgressBar spinner;
    private final TextView text;
    private final TextView subtext;
    private final GradientDrawable background = new GradientDrawable();
    private final int dragSlop;
    private Listener listener;
    private int maxWidthPx;
    private int switchSideActionId = View.NO_ID;

    /** The area the pill may move in, in this view's parent coordinates (px). */
    private int areaLeft;
    private int areaTop;
    private int areaWidth;
    private int areaHeight;

    private float downRawX;
    private float downRawY;
    private float downX;
    private float downY;
    private boolean dragging;

    FabView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        dragSlop = Math.max(ViewConfiguration.get(context).getScaledTouchSlop(), dp(8));
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER_VERTICAL);
        setMinimumHeight(dp(48));
        setPadding(dp(16), dp(12), dp(16), dp(12));
        setElevation(0f);
        setClickable(true);
        setFocusable(true);
        background.setShape(GradientDrawable.RECTANGLE);
        background.setCornerRadius(dp(999));
        setBackground(background);

        FrameLayout iconBox = new FrameLayout(context);
        icon = new ImageView(context);
        spinner = new ProgressBar(context);
        spinner.setIndeterminate(true);
        iconBox.addView(icon, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        iconBox.addView(spinner, new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER));
        iconBox.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        LayoutParams iconLp = new LayoutParams(dp(20), dp(20));
        iconLp.setMarginEnd(dp(8));
        addView(iconBox, iconLp);

        LinearLayout words = new LinearLayout(context);
        words.setOrientation(VERTICAL);
        words.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        text = label(context, 14);
        subtext = label(context, 12);
        words.addView(text);
        words.addView(subtext);
        addView(words, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
    }

    private TextView label(Context context, int sp) {
        TextView view = new TextView(context);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setMaxLines(2);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setIncludeFontPadding(false);
        return view;
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    /** Words, icon and colours. icon: magic | busy | report | warning. */
    void bind(String iconName, String main, String sub, String a11y, String switchSideLabel,
              int surface, int line, int textColor, int accent) {
        text.setText(main);
        text.setTextColor(textColor);
        boolean hasSub = sub != null && !sub.isEmpty();
        subtext.setText(hasSub ? sub : "");
        subtext.setVisibility(hasSub ? VISIBLE : GONE);
        subtext.setTextColor(textColor);
        background.setColor(surface);
        background.setStroke(Math.max(1, Math.round(density)), line);
        boolean busy = "busy".equals(iconName);
        spinner.setVisibility(busy ? VISIBLE : GONE);
        icon.setVisibility(busy ? GONE : VISIBLE);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(accent));
        if (!busy) {
            int res = "report".equals(iconName) ? R.drawable.raf_fab_report
                    : "warning".equals(iconName) ? R.drawable.raf_fab_warning
                    : R.drawable.raf_fab_magic;
            icon.setImageResource(res);
            icon.setImageTintList(ColorStateList.valueOf(accent));
        }
        setContentDescription(a11y);
        if (switchSideActionId != View.NO_ID) ViewCompat.removeAccessibilityAction(this, switchSideActionId);
        switchSideActionId = ViewCompat.addAccessibilityAction(this, switchSideLabel, (view, args) -> {
            if (listener != null) listener.onSwitchSide();
            return true;
        });
        requestLayout();
    }

    /** The page area the pill lives in (parent px). The width cap is 60% of it. */
    void setArea(int left, int top, int width, int height) {
        areaLeft = left;
        areaTop = top;
        areaWidth = width;
        areaHeight = height;
        int cap = Math.max(dp(48), Math.round(width * 0.6f));
        if (cap != maxWidthPx) {
            maxWidthPx = cap;
            requestLayout();
        }
    }

    /** Places the pill at a page-area position (dp, top-left), kept inside the area. */
    void placeAt(float xDp, float yDp) {
        setX(clampX(areaLeft + xDp * density));
        setY(clampY(areaTop + yDp * density));
    }

    float xDp() {
        return (getX() - areaLeft) / density;
    }

    float yDp() {
        return (getY() - areaTop) / density;
    }

    /** Measures for the current area and returns {width, height} in dp. */
    float[] measureDp() {
        measure(MeasureSpec.makeMeasureSpec(Math.max(maxWidthPx, dp(48)), MeasureSpec.AT_MOST),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
        return new float[] {getMeasuredWidth() / density, getMeasuredHeight() / density};
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        if (maxWidthPx > 0) {
            int mode = MeasureSpec.getMode(widthMeasureSpec);
            int size = MeasureSpec.getSize(widthMeasureSpec);
            int capped = mode == MeasureSpec.UNSPECIFIED ? maxWidthPx : Math.min(size, maxWidthPx);
            widthMeasureSpec = MeasureSpec.makeMeasureSpec(capped, MeasureSpec.AT_MOST);
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
    }

    @SuppressLint("ClickableViewAccessibility")
    @Override
    public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downX = getX();
                downY = getY();
                dragging = false;
                setPressed(true);
                return true;
            case MotionEvent.ACTION_MOVE: {
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                if (!dragging && Math.hypot(dx, dy) > dragSlop) {
                    dragging = true;
                    setPressed(false);
                    if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                }
                if (dragging) {
                    setX(clampX(downX + dx));
                    setY(clampY(downY + dy));
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
                setPressed(false);
                if (dragging) {
                    dragging = false;
                    if (listener != null) listener.onMoved(xDp(), yDp());
                } else {
                    performClick();
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                setPressed(false);
                if (dragging) {
                    dragging = false;
                    if (listener != null) listener.onMoved(xDp(), yDp());
                }
                return true;
            default:
                return super.onTouchEvent(event);
        }
    }

    @Override
    public boolean performClick() {
        super.performClick();
        if (listener != null) listener.onTap();
        return true;
    }

    private float clampX(float x) {
        float max = areaLeft + Math.max(0, areaWidth - getWidthOrMeasured());
        return Math.max(areaLeft, Math.min(x, max));
    }

    private float clampY(float y) {
        float max = areaTop + Math.max(0, areaHeight - getHeightOrMeasured());
        return Math.max(areaTop, Math.min(y, max));
    }

    private int getWidthOrMeasured() {
        return getWidth() > 0 ? getWidth() : getMeasuredWidth();
    }

    private int getHeightOrMeasured() {
        return getHeight() > 0 ? getHeight() : getMeasuredHeight();
    }

    private int dp(int value) {
        return Math.round(value * density);
    }
}
