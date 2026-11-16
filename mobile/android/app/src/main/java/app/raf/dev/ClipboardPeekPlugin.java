package app.raf.dev;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.view.textclassifier.TextClassifier;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A copied link, offered on Home. hint() looks only at the clip's description (timestamp, types, the system's URL
 * classification on Android 12+, the sensitive flag): that shows no Android 13 "pasted from" notice. readText() reads
 * the text, only while the window has focus (Android 10+ allows nothing else), and the web side calls it only for a new,
 * likely, non-sensitive link after onboarding with the switch on. Nothing is kept: no field, no saved state, no log.
 */
@CapacitorPlugin(name = "ClipboardPeek")
public class ClipboardPeekPlugin extends Plugin {
    static final int MAX_TEXT = 4096;
    private static final String EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    private final Handler main = new Handler(Looper.getMainLooper());

    /** MainActivity.onWindowFocusChanged(true). The event has no data; the web side asks hint() itself. */
    void notifyFocus() {
        notifyListeners("focus", new JSObject(), false);
    }

    @PluginMethod
    public void hint(PluginCall call) {
        main.post(() -> {
            Activity activity = getActivity();
            ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipDescription description = clipboard == null ? null : clipboard.getPrimaryClipDescription();
            JSObject result = new JSObject();
            result.put("focused", activity != null && activity.hasWindowFocus());
            result.put("hasText", hasText(description));
            result.put("stamp", description == null ? JSObject.NULL : (Object) description.getTimestamp());
            result.put("likelyUrl", likelyUrl(description));
            result.put("sensitive", sensitive(description));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void readText(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            result.put("text", JSObject.NULL);
            Activity activity = getActivity();
            if (activity == null || !activity.hasWindowFocus()) {
                call.resolve(result);
                return;
            }
            ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0 || !hasText(clip.getDescription()) || sensitive(clip.getDescription())) {
                call.resolve(result);
                return;
            }
            // Only text the clip itself holds: coerceToText could open a content URI from another app.
            CharSequence text = clip.getItemAt(0).getText();
            if (text != null) result.put("text", cut(text.toString()));
            call.resolve(result);
        });
    }

    private static boolean hasText(ClipDescription d) {
        return d != null && (d.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)
            || d.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML)
            || d.hasMimeType(ClipDescription.MIMETYPE_TEXT_URILIST));
    }

    private static String likelyUrl(ClipDescription d) {
        if (d == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "unknown";
        try {
            if (d.getClassificationStatus() != ClipDescription.CLASSIFICATION_COMPLETE) return "unknown";
            return d.getConfidenceScore(TextClassifier.TYPE_URL) >= 0.5f ? "yes" : "no";
        } catch (RuntimeException e) {
            return "unknown";
        }
    }

    private static boolean sensitive(ClipDescription d) {
        if (d == null) return false;
        PersistableBundle extras = d.getExtras();
        return extras != null && extras.getBoolean(EXTRA_IS_SENSITIVE, false);
    }

    /** At most MAX_TEXT UTF-16 units, never ending on half a surrogate pair. */
    private static String cut(String text) {
        if (text.length() <= MAX_TEXT) return text;
        int end = Character.isHighSurrogate(text.charAt(MAX_TEXT - 1)) ? MAX_TEXT - 1 : MAX_TEXT;
        return text.substring(0, end);
    }
}
