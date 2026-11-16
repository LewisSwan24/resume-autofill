package app.raf.dev;

import android.content.Context;
import android.content.pm.PackageInfo;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSObject;

/** What the system WebView on this phone can do for the fill browser. */
final class WebViewSupport {
    private WebViewSupport() {}

    static boolean documentStartScript() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
    }

    static boolean messageListener() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
    }

    static boolean isolatedWorld() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD);
    }

    static JSObject capabilities(Context context) {
        JSObject out = new JSObject();
        out.put("documentStartScript", documentStartScript());
        out.put("messageListener", messageListener());
        out.put("isolatedWorld", isolatedWorld());
        String name = null;
        String version = null;
        try {
            PackageInfo info = WebViewCompat.getCurrentWebViewPackage(context);
            if (info != null) {
                name = info.packageName;
                version = info.versionName;
            }
        } catch (RuntimeException e) {
            // Unknown package: the app says so instead of a version.
        }
        out.put("webViewPackage", name == null ? JSObject.NULL : name);
        out.put("webViewVersion", version == null ? JSObject.NULL : version);
        return out;
    }
}
