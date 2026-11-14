package app.raf.dev;

import android.net.Uri;
import android.os.Message;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/**
 * Progress, title, file inputs and permission prompts of the page WebView. Every permission is denied; popups load
 * in the same view (multiple windows are off); the page's console never reaches logcat.
 */
final class PageChromeClient extends WebChromeClient {
    private final FillBrowserPlugin plugin;
    private final FillBrowserHost host;

    PageChromeClient(FillBrowserPlugin plugin, FillBrowserHost host) {
        this.plugin = plugin;
        this.host = host;
    }

    @Override
    public void onProgressChanged(WebView view, int newProgress) {
        if (host.isPage(view)) plugin.emitProgress(newProgress);
    }

    @Override
    public void onReceivedTitle(WebView view, String title) {
        if (host.isPage(view)) plugin.emitTitle(title, host.generation());
    }

    @Override
    public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (!host.isPage(view)) {
            callback.onReceiveValue(null);
            return true;
        }
        return plugin.showFileChooser(callback, params);
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        request.deny();
        String kind = "other";
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                kind = "camera";
                break;
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) kind = "microphone";
        }
        plugin.emitPermission(kind);
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, false, false);
        plugin.emitPermission("location");
    }

    @Override
    public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
        return false;
    }

    /** Swallowed: page console output could carry form contents, and must never reach logcat. */
    @Override
    public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
        return true;
    }
}
