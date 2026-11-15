package app.raf.dev.keyboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Build;
import android.util.AttributeSet;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.raf.dev.R;

/**
 * The keyboard's root (res/layout/kb_root.xml): top bar, banner, Chinese tip and the content frame that holds one panel.
 * Background bg with a 1dp border line on the top edge only, no shadow. The bottom padding is the navigation-bar inset,
 * so keys never sit under the gesture bar.
 */
public final class KeyboardRootView extends LinearLayout {
    /** What the views ask the service to do. */
    interface Actions {
        void insert(EntryRowView row);

        void selectGroup(String id);

        void openPicker();

        void closePicker();

        void pickResume(String id);

        void toggleLanguage();

        void showTyping();

        void showResume();

        void deleteOne();

        void switchIme();

        void showImePicker();

        void hide();

        void openApp();

        void reveal();

        void dismissTip();

        void key(KeyboardLayouts.Key key);
    }

    private final Paint linePaint = new Paint();
    private int lineWidth;
    TopBarView topBar;
    TextView banner;
    LinearLayout tip;
    FrameLayout content;

    public KeyboardRootView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setWillNotDraw(false);
        setElevation(0);
        setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom = Build.VERSION.SDK_INT >= 30
                // On gesture navigation the system draws its back and switch buttons in a caption bar at the
                // bottom of the IME window, taller than the navigation-bar inset; keep clear of both.
                ? insets.getInsets(WindowInsets.Type.navigationBars() | WindowInsets.Type.captionBar()).bottom
                : insets.getSystemWindowInsetBottom();
            v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), bottom);
            return insets;
        });
    }

    @Override
    protected void onFinishInflate() {
        super.onFinishInflate();
        topBar = findViewById(R.id.kb_top_bar);
        banner = findViewById(R.id.kb_banner);
        tip = findViewById(R.id.kb_tip);
        content = findViewById(R.id.kb_content);
    }

    /** Colours for the current theme (light or dark follows the system). */
    void applyTheme(KbTheme theme) {
        setBackgroundColor(theme.bg);
        linePaint.setColor(theme.border);
        lineWidth = theme.line;
        banner.setBackgroundColor(theme.bg);
        theme.body(banner, 13, false, theme.textMuted);
        invalidate();
    }

    /** Show one panel in the content frame; {@code height} in px, or WRAP_CONTENT. */
    void setContent(View panel, int height) {
        content.removeAllViews();
        LayoutParams lp = (LayoutParams) content.getLayoutParams();
        lp.height = height;
        content.setLayoutParams(lp);
        content.addView(panel, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            height == LayoutParams.WRAP_CONTENT ? FrameLayout.LayoutParams.WRAP_CONTENT : FrameLayout.LayoutParams.MATCH_PARENT));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (lineWidth > 0) canvas.drawRect(0, 0, getWidth(), lineWidth, linePaint);
    }
}
