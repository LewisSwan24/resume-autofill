package app.raf.dev.keyboard;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * One key or one icon button: a FrameLayout holding a TextView or an ImageView. It is one accessibility
 * node with a content description and the Button role. Repeating keys (delete) repeat while held; with TalkBack a
 * double tap is a click and deletes once.
 */
final class KeyView extends FrameLayout {
    private static final long REPEAT_START_MS = 400;
    private static final long REPEAT_EVERY_MS = 60;

    final TextView label;
    final ImageView image;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable repeater;

    KeyView(Context context) {
        super(context);
        label = new TextView(context);
        label.setGravity(Gravity.CENTER);
        label.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        image = new ImageView(context);
        image.setScaleType(ImageView.ScaleType.CENTER);
        image.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        addView(label, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        addView(image, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        image.setVisibility(GONE);
        setClickable(true);
        setFocusable(true);
        setElevation(0);
        setSoundEffectsEnabled(false);
    }

    void showText(CharSequence text) {
        label.setText(text);
        label.setVisibility(VISIBLE);
        image.setVisibility(GONE);
    }

    void showIcon(android.graphics.drawable.Drawable icon) {
        image.setImageDrawable(icon);
        image.setVisibility(VISIBLE);
        label.setVisibility(GONE);
    }

    /** Selected state, spoken as 「已选中」 or a custom state such as 「大写锁定」. */
    void setState(boolean on, String stateWords) {
        setSelected(on);
        if (Build.VERSION.SDK_INT >= 30) setStateDescription(on ? stateWords : null);
    }

    /** Repeat {@code action} while the key is held: once at once, then every 60 ms after 400 ms. */
    @SuppressLint("ClickableViewAccessibility")
    void repeatWhileHeld(Runnable action) {
        setOnClickListener(v -> {
            tap();
            action.run();
        });
        setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    setPressed(true);
                    tap();
                    action.run();
                    repeater = new Runnable() {
                        @Override
                        public void run() {
                            action.run();
                            handler.postDelayed(this, REPEAT_EVERY_MS);
                        }
                    };
                    handler.postDelayed(repeater, REPEAT_START_MS);
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    setPressed(false);
                    stopRepeat();
                    return true;
                default:
                    return true;
            }
        });
    }

    void onTap(Runnable action) {
        setOnClickListener(v -> {
            tap();
            action.run();
        });
    }

    void tap() {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
    }

    void stopRepeat() {
        if (repeater != null) handler.removeCallbacks(repeater);
        repeater = null;
    }

    @Override
    protected void onDetachedFromWindow() {
        stopRepeat();
        super.onDetachedFromWindow();
    }

    @Override
    public CharSequence getAccessibilityClassName() {
        return Button.class.getName();
    }
}
