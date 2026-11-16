package app.raf.dev;

import android.content.Context;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebResourceErrorCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/**
 * Navigation, load state and errors of the page WebView. Only http, https, about:blank and about:srcdoc load; every
 * other navigation is cancelled and handed to the app as "external". SSL errors are always refused.
 */
final class PageWebViewClient extends WebViewClientCompat {
    private final FillBrowserPlugin plugin;
    private final FillBrowserHost host;
    private final WebViewAssetLoader assetLoader;

    PageWebViewClient(FillBrowserPlugin plugin, FillBrowserHost host, WebViewAssetLoader assetLoader) {
        this.plugin = plugin;
        this.host = host;
        this.assetLoader = assetLoader;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl() == null ? null : request.getUrl().toString();
        if (NavigationPolicy.decide(url) == NavigationPolicy.Decision.LOAD) {
            // Links and server redirects of the main document: remember where it is going (SSL errors carry no frame).
            if (request.isForMainFrame()) host.onMainRequest(view, url);
            return false;
        }
        if (host.isPage(view)) plugin.emitExternal(url, request.hasGesture(), request.isForMainFrame());
        return true;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        host.onMainStarted(view, url);
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        host.onCommitVisible(view);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        host.onMainFinished(view, url);
    }

    @Override
    public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
        host.onHistory(view, url);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceErrorCompat error) {
        if (!request.isForMainFrame() || !host.isPage(view)) return;
        int code = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_RESOURCE_ERROR_GET_CODE)
                ? error.getErrorCode() : ERROR_UNKNOWN;
        String description = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_RESOURCE_ERROR_GET_DESCRIPTION)
                ? String.valueOf(error.getDescription()) : "";
        // A stopped load or a navigation turned into a download is not an error the person needs to see.
        if (description.contains("ERR_ABORTED")) return;
        String url = request.getUrl() == null ? "" : request.getUrl().toString();
        plugin.emitLoadError(kind(view.getContext(), code, description), url, code);
    }

    static String kind(Context context, int code, String description) {
        if (description.contains("ERR_INTERNET_DISCONNECTED") || offline(context)) return "offline";
        switch (code) {
            case WebViewClient.ERROR_HOST_LOOKUP:
                return "dns";
            case WebViewClient.ERROR_TIMEOUT:
            case WebViewClient.ERROR_CONNECT:
                return "timeout";
            case WebViewClient.ERROR_FAILED_SSL_HANDSHAKE:
                return "ssl";
            default:
                return "generic";
        }
    }

    /** No active network. Needs ACCESS_NETWORK_STATE, which the app does not ask for; without it this says false. */
    private static boolean offline(Context context) {
        try {
            ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
            return cm != null && cm.getActiveNetwork() == null;
        } catch (SecurityException e) {
            return false;
        }
    }

    /**
     * Never bypassable: no proceed, no "continue anyway". Only an error of the main document shows the app's ssl error
     * view; a third-party image, script or iframe with a bad certificate is just not loaded.
     */
    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        String url = error == null ? null : error.getUrl();
        if (host.isPage(view) && NavigationPolicy.sameOrigin(url, host.pendingMainUrl())) {
            plugin.emitLoadError("ssl", url, ERROR_FAILED_SSL_HANDSHAKE);
        }
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        host.onRenderGone(view);
        return true;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (url == null || !DemoPathHandler.HOST.equals(url.getHost())) return null;
        WebResourceResponse response = assetLoader.shouldInterceptRequest(url);
        if (response != null) return response;
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(),
                new ByteArrayInputStream(new byte[0]));
    }
}
