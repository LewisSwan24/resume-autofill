package app.raf.dev;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Everything other apps and the launcher hand to the app that is not a file: a web link (VIEW), shared text (SEND
 * text/plain), the launcher shortcuts, a refused link. IncomingIntents decides the kind; files stay with
 * IncomingFilePlugin. One item at a time (the newest wins), in memory only, touched only on the main thread; the web side
 * takes it with take(). Same rules as IncomingFilePlugin for the handled flag and Recents. Nothing here logs, nothing
 * goes into saved state, and rejects carry constant messages only.
 */
@CapacitorPlugin(name = "IncomingIntent")
public class IncomingIntentPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());

    /** The pending item, ready to resolve. Main thread only. */
    private JSObject slot;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity instanceof MainActivity && ((MainActivity) activity).incomingHandled) return;
        Intent intent = activity.getIntent();
        // Reopened from Recents: Android hands over the original intent again. It was handled the first time.
        if (intent != null && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        accept(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        // BridgeActivity.load() passes the launch intent here too, right after load(), which has already decided on it.
        if (intent == getActivity().getIntent()) return;
        accept(intent);
    }

    @Override
    protected void handleOnDestroy() {
        slot = null;
        super.handleOnDestroy();
    }

    /** {@code take()}: the pending item, or {state:'none'}. The slot is empty before the call resolves. */
    @PluginMethod
    public void take(PluginCall call) {
        main.post(() -> {
            JSObject result = slot;
            slot = null;
            if (result == null) {
                result = new JSObject();
                result.put("state", "none");
            }
            call.resolve(result);
        });
    }

    private void accept(Intent intent) {
        IncomingIntents.Result r = IncomingIntents.classify(intent);
        JSObject payload = payloadOf(r);
        if (payload == null) return;
        Activity activity = getActivity();
        if (activity instanceof MainActivity) ((MainActivity) activity).incomingHandled = true;
        slot = payload;
        notifyListeners("incomingIntent", new JSObject(), false);
    }

    /** The take() payload of a non-file kind; null for NONE and FILE. */
    private static JSObject payloadOf(IncomingIntents.Result r) {
        JSObject o = new JSObject();
        o.put("state", "ready");
        switch (r.kind) {
            case VIEW:
                o.put("kind", "view");
                o.put("url", r.url);
                return o;
            case TEXT:
                o.put("kind", "text");
                o.put("text", r.text);
                if (r.subject != null) o.put("subject", r.subject);
                o.put("cut", r.cut);
                return o;
            case PASTE:
                o.put("kind", "paste");
                return o;
            case DEMO:
                o.put("kind", "demo");
                return o;
            case APPLICATION:
                o.put("kind", "application");
                o.put("recordId", r.recordId);
                o.put("open", r.open);
                if (r.from != null) o.put("from", r.from);
                return o;
            case REFUSED:
                o.put("kind", "refused");
                o.put("reason", r.reason);
                return o;
            default:
                return null;
        }
    }
}
