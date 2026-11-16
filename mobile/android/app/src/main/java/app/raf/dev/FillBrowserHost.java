package app.raf.dev;

import android.graphics.Color;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebSettings;
import android.webkit.WebBackForwardList;
import android.webkit.WebHistoryItem;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptExecutionWorld;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;

/**
 * The layer the fill browser lives in: a FrameLayout laid exactly over the Capacitor UI WebView, holding the page
 * WebView (inside the React "hole", given as top and bottom insets in dp), a touch blocker, a scrim and the FAB.
 * Touches outside those children fall through to the UI WebView underneath. UI thread only.
 */
@SuppressLint("ViewConstructor")
final class FillBrowserHost extends FrameLayout {
    static final String BRIDGE_NAME = "rafBridge";
    static final String ENGINE_ASSET = "raf/engine.js";
    private static final String BYE_PREFIX = "{\"v\":1,\"kind\":\"bye\"";
    private static final Set<String> ALL_ORIGINS = Collections.singleton("*");
    private static String engineScript;
    private static boolean engineRead;

    private final Activity activity;
    private final FillBrowserPlugin plugin;
    private final WebView uiView;
    private final float density;
    private final FrameRegistry registry = new FrameRegistry();
    private final WebViewAssetLoader assetLoader;
    private final View blocker;
    private final View scrim;
    private final FabView fab;
    private WebView page;
    /** A page has painted: from then on its base background is white, as in a browser (the page keeps its own look). */
    private boolean committed;
    private int[] theme;
    private boolean isolated;
    private boolean destroyed;

    private float insetTopDp;
    private float insetBottomDp;
    private int imeOverlapPx;
    private boolean keyboardVisible;
    private int keyboardHeightDp = -1;
    private int areaWidthDp = -1;
    private int areaHeightDp = -1;
    private boolean shown = true;
    private boolean started;
    private boolean fabShown;
    private Float fabX;
    private Float fabY;
    private String lastRequestedUrl;

    private final View.OnLayoutChangeListener uiLayoutListener =
            (v, l, t, r, b, ol, ot, or, ob) -> post(this::syncBounds);
    private final ViewTreeObserver.OnGlobalLayoutListener globalLayoutListener = this::updateIme;

    FillBrowserHost(Activity activity, FillBrowserPlugin plugin, WebView uiView, int[] theme) {
        super(activity);
        this.activity = activity;
        this.plugin = plugin;
        this.uiView = uiView;
        this.theme = theme;
        this.density = activity.getResources().getDisplayMetrics().density;
        setElevation(0f);
        setClipChildren(true);
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(DemoPathHandler.HOST)
                .addPathHandler(DemoPathHandler.PREFIX, new DemoPathHandler(activity))
                .build();

        page = createPage();
        addView(page, areaParams());

        blocker = new View(activity);
        blocker.setClickable(true);
        blocker.setOnTouchListener((v, event) -> true);
        blocker.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        blocker.setVisibility(GONE);
        addView(blocker, areaParams());

        scrim = new View(activity);
        scrim.setClickable(true);
        scrim.setOnClickListener(v -> plugin.emitScrimTap());
        scrim.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        scrim.setVisibility(GONE);
        addView(scrim, areaParams());

        fab = new FabView(activity);
        fab.setVisibility(GONE);
        fab.setListener(new FabView.Listener() {
            @Override
            public void onTap() {
                plugin.emitFabTap();
            }

            @Override
            public void onMoved(float xDp, float yDp) {
                fabX = xDp;
                fabY = yDp;
                plugin.emitFabMoved(xDp, yDp);
            }

            @Override
            public void onSwitchSide() {
                plugin.emitFabSwitchSide();
            }
        });
        addView(fab, new FrameLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));

        applyTheme();
        ViewCompat.setOnApplyWindowInsetsListener(this, (v, insets) -> {
            post(this::updateIme);
            return insets;
        });
    }

    // ---------------------------------------------------------------- setup

    void attach() {
        ViewGroup parent = (ViewGroup) uiView.getParent();
        ViewGroup.MarginLayoutParams lp = new ViewGroup.MarginLayoutParams(
                Math.max(uiView.getWidth(), 1), Math.max(uiView.getHeight(), 1));
        parent.addView(this, lp);
        uiView.addOnLayoutChangeListener(uiLayoutListener);
        getViewTreeObserver().addOnGlobalLayoutListener(globalLayoutListener);
        syncBounds();
        applyMargins();
    }

    private WebView createPage() {
        WebView view = new WebView(activity);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false);
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);
        view.setElevation(0f);
        view.setVisibility(INVISIBLE);
        view.setWebViewClient(new PageWebViewClient(plugin, this, assetLoader));
        view.setWebChromeClient(new PageChromeClient(plugin, this));
        view.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                plugin.emitDownload(url, mimeType, URLUtil.guessFileName(url, contentDisposition, mimeType), contentLength));
        isolated = installBridge(view);
        return view;
    }

    /** Engine at document start in every frame, and the rafBridge listener. Returns whether both are isolated. */
    private boolean installBridge(WebView view) {
        boolean listener = WebViewSupport.messageListener();
        boolean startScript = WebViewSupport.documentStartScript();
        boolean worlds = WebViewSupport.isolatedWorld();
        String script = engine();
        WebViewCompat.WebMessageListener onMessage = (v, message, origin, isMainFrame, proxy) ->
                onPageMessage(v, message, origin, isMainFrame, proxy);
        if (worlds && listener && startScript) {
            JavaScriptExecutionWorld world = WebViewCompat.getExecutionWorld(view, "raf");
            WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, ALL_ORIGINS, world, onMessage);
            if (script != null) {
                WebViewCompat.addJavaScriptOnEvent(view, script, WebViewCompat.INJECTION_EVENT_DOCUMENT_START,
                        ALL_ORIGINS, world);
            }
            return true;
        }
        if (listener) WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, ALL_ORIGINS, onMessage);
        if (listener && startScript && script != null) WebViewCompat.addDocumentStartJavaScript(view, script, ALL_ORIGINS);
        return false;
    }

    private String engine() {
        synchronized (FillBrowserHost.class) {
            if (!engineRead) {
                engineRead = true;
                try (InputStream in = activity.getAssets().open(ENGINE_ASSET)) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    engineScript = out.toString(StandardCharsets.UTF_8.name());
                } catch (IOException e) {
                    engineScript = null;
                }
            }
            return engineScript;
        }
    }

    // ---------------------------------------------------------------- bridge

    private void onPageMessage(WebView view, WebMessageCompat message, Uri origin, boolean main, JavaScriptReplyProxy proxy) {
        if (destroyed || view != page || message == null || proxy == null) return;
        if (message.getType() != WebMessageCompat.TYPE_STRING) return;
        String data = message.getData();
        if (data == null || data.length() > FillBrowserPlugin.MAX_PAGE_MESSAGE_CHARS) return;
        ProxySink sink = new ProxySink(proxy);
        int generation = registry.generation();
        if (data.startsWith(BYE_PREFIX)) {
            int key = registry.remove(sink);
            if (key > 0) plugin.emitFrameGone(key, generation);
            return;
        }
        int key = registry.keyFor(sink);
        if (key < 0) return;
        plugin.emitMessage(key, generation, origin == null ? "null" : origin.toString(), main, data);
    }

    boolean post(int generation, int frame, String data) {
        return !destroyed && registry.post(generation, frame, data);
    }

    boolean isolated() {
        return isolated;
    }

    int generation() {
        return registry.generation();
    }

    /** Same frame = same reply proxy object. */
    private static final class ProxySink implements FrameRegistry.Sink {
        private final JavaScriptReplyProxy proxy;

        ProxySink(JavaScriptReplyProxy proxy) {
            this.proxy = proxy;
        }

        @Override
        public void post(String data) {
            proxy.postMessage(data);
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof ProxySink && ((ProxySink) other).proxy == proxy;
        }

        @Override
        public int hashCode() {
            return System.identityHashCode(proxy);
        }
    }

    // ---------------------------------------------------------------- page events (from PageWebViewClient)

    void onMainStarted(WebView view, String url) {
        if (view != page || destroyed) return;
        pendingMainUrl = url;
        int generation = registry.newGeneration();
        if (!started) {
            started = true;
            page.setVisibility(VISIBLE);
        }
        plugin.emitNavigation("started", url, generation, view.canGoBack(), view.canGoForward());
    }

    void onMainFinished(WebView view, String url) {
        if (view != page || destroyed) return;
        plugin.emitNavigation("finished", url, registry.generation(), view.canGoBack(), view.canGoForward());
    }

    void onHistory(WebView view, String url) {
        if (view != page || destroyed) return;
        plugin.emitNavigation("history", url, registry.generation(), view.canGoBack(), view.canGoForward());
    }

    /** The first visible commit of the page WebView: drop the app's bg colour that covered the blank view. */
    void onCommitVisible(WebView view) {
        if (view != page || destroyed || committed) return;
        committed = true;
        applyTheme();
    }

    boolean isPage(WebView view) {
        return !destroyed && view == page;
    }

    /** The renderer died: the old view cannot be used again. A fresh one takes its place; the app offers to reopen. */
    void onRenderGone(WebView view) {
        if (view != page || destroyed) return;
        int index = indexOfChild(page);
        removeView(page);
        page.destroy();
        registry.newGeneration();
        started = false;
        committed = false;
        page = createPage();
        addView(page, index, areaParams());
        applyTheme();
        applyMargins();
        plugin.onPageCrashed();
    }

    // ---------------------------------------------------------------- commands

    void load(String url) {
        lastRequestedUrl = url;
        pendingMainUrl = url;
        page.loadUrl(url);
    }

    /** The main document being loaded or shown: its origin is the only one whose SSL error is the page's. */
    private String pendingMainUrl;

    void onMainRequest(WebView view, String url) {
        if (view == page && !destroyed) pendingMainUrl = url;
    }

    String pendingMainUrl() {
        return pendingMainUrl;
    }

    String lastRequestedUrl() {
        return lastRequestedUrl;
    }

    void navigate(String action) {
        switch (action) {
            case "back":
                if (page.canGoBack()) {
                    pendingMainUrl = historyUrl(-1);
                    page.goBack();
                }
                break;
            case "forward":
                if (page.canGoForward()) {
                    pendingMainUrl = historyUrl(1);
                    page.goForward();
                }
                break;
            case "reload":
                if (page.getUrl() != null) pendingMainUrl = page.getUrl();
                page.reload();
                break;
            default:
                page.stopLoading();
        }
    }

    /** URL of the history entry `step` away from the current one, or the current pending URL when there is none. */
    private String historyUrl(int step) {
        WebBackForwardList list = page.copyBackForwardList();
        WebHistoryItem item = list.getItemAtIndex(list.getCurrentIndex() + step);
        return item == null ? pendingMainUrl : item.getUrl();
    }

    void setShown(boolean visible) {
        shown = visible;
        setVisibility(visible ? VISIBLE : INVISIBLE);
    }

    void setInsets(float topDp, float bottomDp) {
        insetTopDp = topDp;
        insetBottomDp = bottomDp;
        applyMargins();
    }

    void setTheme(int[] colors) {
        theme = colors;
        applyTheme();
    }

    void setCover(boolean block, boolean showScrim) {
        blocker.setVisibility(block || showScrim ? VISIBLE : GONE);
        scrim.setVisibility(showScrim ? VISIBLE : GONE);
    }

    float[] showFab(String icon, String text, String subtext, String a11y, String switchSideLabel, int[] colors,
                    Float xDp, Float yDp) {
        // theme order: bg, surface, text, line, accent, scrim
        fab.bind(icon, text, subtext, a11y, switchSideLabel, colors[1], colors[3], colors[2], colors[4]);
        fab.setArea(0, Math.round(insetTopDp * density), getWidth(), areaHeightPx());
        float[] size = fab.measureDp();
        if (xDp != null && yDp != null) {
            fabX = xDp;
            fabY = yDp;
        } else if (fabX == null || fabY == null) {
            fabX = Math.max(0f, getWidth() / density - size[0] - 16f);
            fabY = Math.max(0f, areaHeightPx() / density - size[1] - 16f);
        }
        fab.setVisibility(VISIBLE);
        fabShown = true;
        fab.placeAt(fabX, fabY);
        return size;
    }

    void hideFab() {
        fabShown = false;
        fab.setVisibility(GONE);
    }

    void clearCache() {
        page.clearCache(true);
    }

    void destroy() {
        if (destroyed) return;
        destroyed = true;
        uiView.removeOnLayoutChangeListener(uiLayoutListener);
        if (getViewTreeObserver().isAlive()) getViewTreeObserver().removeOnGlobalLayoutListener(globalLayoutListener);
        ViewCompat.setOnApplyWindowInsetsListener(this, null);
        registry.clear();
        ViewGroup parent = (ViewGroup) getParent();
        if (parent != null) parent.removeView(this);
        page.stopLoading();
        page.setWebChromeClient(null);
        page.destroy();
    }

    // ---------------------------------------------------------------- layout

    private FrameLayout.LayoutParams areaParams() {
        return new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
    }

    /** Match the UI WebView's rect inside the shared parent. */
    private void syncBounds() {
        if (destroyed || getParent() == null) return;
        ViewGroup parent = (ViewGroup) getParent();
        ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) getLayoutParams();
        int width = Math.max(uiView.getWidth(), 1);
        int height = Math.max(uiView.getHeight(), 1);
        int left = uiView.getLeft() - parent.getPaddingLeft();
        int top = uiView.getTop() - parent.getPaddingTop();
        if (lp.width != width || lp.height != height || lp.leftMargin != left || lp.topMargin != top) {
            lp.width = width;
            lp.height = height;
            lp.leftMargin = left;
            lp.topMargin = top;
            setLayoutParams(lp);
        }
    }

    private int topPx() {
        return Math.round(insetTopDp * density);
    }

    private int bottomPx() {
        return Math.max(Math.round(insetBottomDp * density), imeOverlapPx);
    }

    private int areaHeightPx() {
        return Math.max(0, getHeight() - topPx() - bottomPx());
    }

    private void applyMargins() {
        int top = topPx();
        int bottom = bottomPx();
        for (View child : new View[] {page, blocker, scrim}) {
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) child.getLayoutParams();
            if (lp.topMargin != top || lp.bottomMargin != bottom) {
                lp.topMargin = top;
                lp.bottomMargin = bottom;
                child.setLayoutParams(lp);
            }
        }
    }

    @Override
    protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        super.onLayout(changed, left, top, right, bottom);
        int areaHeight = areaHeightPx();
        fab.setArea(0, topPx(), getWidth(), areaHeight);
        if (fabShown && fabX != null && fabY != null) fab.placeAt(fabX, fabY);
        int widthDp = Math.round(getWidth() / density);
        int heightDp = Math.round(areaHeight / density);
        if (widthDp != areaWidthDp || heightDp != areaHeightDp) {
            areaWidthDp = widthDp;
            areaHeightDp = heightDp;
            plugin.emitPageArea(widthDp, heightDp);
        }
    }

    /** The keyboard: the page's bottom edge rises to the keyboard's top, and the app hears about it. */
    private void updateIme() {
        if (destroyed) return;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(this);
        boolean visible = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
        int ime = insets == null ? 0 : insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        int overlap = 0;
        if (visible && ime > 0) {
            int[] location = new int[2];
            getLocationInWindow(location);
            int bottom = location[1] + getHeight();
            int windowHeight = getRootView().getHeight();
            overlap = Math.max(0, ime - (windowHeight - bottom));
        }
        if (overlap != imeOverlapPx) {
            imeOverlapPx = overlap;
            applyMargins();
        }
        int heightDp = visible ? Math.round(ime / density) : 0;
        if (visible != keyboardVisible || heightDp != keyboardHeightDp) {
            keyboardVisible = visible;
            keyboardHeightDp = heightDp;
            plugin.emitKeyboard(visible, heightDp);
        }
    }

    private void applyTheme() {
        page.setBackgroundColor(committed ? Color.WHITE : theme[0]);
        scrim.setBackgroundColor(theme[5]);
    }

    boolean shown() {
        return shown;
    }
}
