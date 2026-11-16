package app.raf.dev;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewDatabase;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The fill browser: a second, native WebView laid exactly over the Capacitor UI WebView. React draws
 * every piece of chrome around a hole; this plugin draws only the page, a touch blocker, a scrim and the FAB pill.
 * The method and event names are the contract in mobile/app/src/browser/native.ts.
 *
 * Privacy: nothing here logs. Reject messages are fixed codes and never carry call data. Files for a page's file
 * input are served from memory (ChooserStreamProvider) and never touch the disk.
 */
@CapacitorPlugin(name = "FillBrowser")
public class FillBrowserPlugin extends Plugin {
    static final int MAX_PAGE_MESSAGE_CHARS = 512_000;
    static final int MAX_FILE_BYTES = 10 * 1024 * 1024;
    private static final int MAX_URL_CHARS = 8192;
    private static final String NO_BROWSER = "no_browser";
    private static final String BAD_ARGS = "bad_args";
    private static final String NOT_FOUND = "not_found";

    private FillBrowserHost host;

    /** The one pending file chooser: answered exactly once (files, system picker result, or cancel). */
    private ValueCallback<Uri[]> chooserCallback;
    private WebChromeClient.FileChooserParams chooserParams;
    private int chooserId;
    private int nextChooserId = 1;

    // ---------------------------------------------------------------- methods

    @PluginMethod
    public void capabilities(PluginCall call) {
        call.resolve(WebViewSupport.capabilities(getContext()));
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        JSObject insets = call.getObject("insets");
        JSObject theme = call.getObject("theme");
        if (!isWebUrl(url) || insets == null || theme == null) {
            call.reject(BAD_ARGS);
            return;
        }
        float top = (float) insets.optDouble("top", 0);
        float bottom = (float) insets.optDouble("bottom", 0);
        int[] colors = theme(theme);
        ui(() -> {
            destroyHost();
            Activity activity = getActivity();
            WebView uiView = getBridge().getWebView();
            if (activity == null || uiView == null || uiView.getParent() == null) {
                call.reject(NO_BROWSER);
                return;
            }
            host = new FillBrowserHost(activity, this, uiView, colors);
            host.setInsets(top, bottom);
            host.attach();
            host.load(url);
            JSObject out = new JSObject();
            out.put("isolated", host.isolated());
            call.resolve(out);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        ui(() -> {
            destroyHost();
            call.resolve();
        });
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        Boolean visible = call.getBoolean("visible");
        if (visible == null) {
            call.reject(BAD_ARGS);
            return;
        }
        withHost(call, h -> {
            h.setShown(visible);
            call.resolve();
        });
    }

    @PluginMethod
    public void setInsets(PluginCall call) {
        Double top = call.getDouble("top");
        Double bottom = call.getDouble("bottom");
        if (top == null || bottom == null || top < 0 || bottom < 0) {
            call.reject(BAD_ARGS);
            return;
        }
        withHost(call, h -> {
            h.setInsets(top.floatValue(), bottom.floatValue());
            call.resolve();
        });
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        int[] colors = theme(call.getData());
        withHost(call, h -> {
            h.setTheme(colors);
            call.resolve();
        });
    }

    @PluginMethod
    public void loadUrl(PluginCall call) {
        String url = call.getString("url");
        if (!isWebUrl(url)) {
            call.reject(BAD_ARGS);
            return;
        }
        withHost(call, h -> {
            h.load(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void navigate(PluginCall call) {
        String action = call.getString("action");
        if (!"back".equals(action) && !"forward".equals(action) && !"reload".equals(action) && !"stop".equals(action)) {
            call.reject(BAD_ARGS);
            return;
        }
        withHost(call, h -> {
            h.navigate(action);
            call.resolve();
        });
    }

    @PluginMethod
    public void post(PluginCall call) {
        Integer frame = call.getInt("frame");
        Integer generation = call.getInt("generation");
        String data = call.getString("data");
        if (frame == null || generation == null || data == null) {
            call.reject(BAD_ARGS);
            return;
        }
        ui(() -> {
            boolean delivered = host != null && host.post(generation, frame, data);
            JSObject out = new JSObject();
            out.put("delivered", delivered);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void setPageCover(PluginCall call) {
        Boolean block = call.getBoolean("block");
        Boolean scrim = call.getBoolean("scrim");
        if (block == null || scrim == null) {
            call.reject(BAD_ARGS);
            return;
        }
        withHost(call, h -> {
            h.setCover(block, scrim);
            call.resolve();
        });
    }

    @PluginMethod
    public void setFab(PluginCall call) {
        Boolean visible = call.getBoolean("visible");
        if (visible == null) {
            call.reject(BAD_ARGS);
            return;
        }
        if (!visible) {
            withHost(call, h -> {
                h.hideFab();
                JSObject out = new JSObject();
                out.put("width", 0);
                out.put("height", 0);
                call.resolve(out);
            });
            return;
        }
        String icon = call.getString("icon");
        String text = call.getString("text");
        String subtext = call.getString("subtext");
        String a11y = call.getString("a11y");
        String switchSide = call.getString("switchSideLabel");
        JSObject theme = call.getObject("theme");
        Double x = call.getDouble("x");
        Double y = call.getDouble("y");
        boolean knownIcon = "magic".equals(icon) || "busy".equals(icon) || "report".equals(icon) || "warning".equals(icon);
        if (!knownIcon || text == null || a11y == null || switchSide == null || theme == null) {
            call.reject(BAD_ARGS);
            return;
        }
        int[] colors = theme(theme);
        withHost(call, h -> {
            float[] size = h.showFab(icon, text, subtext, a11y, switchSide, colors,
                    x == null ? null : x.floatValue(), y == null ? null : y.floatValue());
            JSObject out = new JSObject();
            out.put("width", size[0]);
            out.put("height", size[1]);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void answerFileChooser(PluginCall call) {
        Integer id = call.getInt("id");
        String kind = call.getString("kind");
        if (id == null || kind == null) {
            call.reject(BAD_ARGS);
            return;
        }
        switch (kind) {
            case "cancel":
                ui(() -> {
                    if (id != chooserId || chooserCallback == null) {
                        call.reject(NOT_FOUND);
                        return;
                    }
                    answerChooser(null);
                    call.resolve();
                });
                return;
            case "files":
                answerWithFiles(call, id);
                return;
            case "system":
                ui(() -> {
                    if (id != chooserId || chooserCallback == null) {
                        call.reject(NOT_FOUND);
                        return;
                    }
                    Intent intent;
                    try {
                        intent = chooserParams.createIntent();
                        if (chooserParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        }
                        startActivityForResult(call, intent, "systemChooserResult");
                    } catch (ActivityNotFoundException | IllegalStateException e) {
                        answerChooser(null);
                        call.resolve();
                    }
                });
                return;
            default:
                call.reject(BAD_ARGS);
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.length() > MAX_URL_CHARS) {
            call.reject(BAD_ARGS);
            return;
        }
        if (!NavigationPolicy.externalAllowed(url)) {
            JSObject out = new JSObject();
            out.put("opened", false);
            call.resolve(out);
            return;
        }
        ui(() -> {
            JSObject out = new JSObject();
            out.put("opened", startExternal(url));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void clearSiteData(PluginCall call) {
        ui(() -> {
            WebStorage.getInstance().deleteAllData();
            WebViewDatabase database = WebViewDatabase.getInstance(getContext());
            database.clearFormData();
            database.clearHttpAuthUsernamePassword();
            if (host != null) {
                host.clearCache();
            } else {
                WebView scratch = new WebView(getActivity());
                scratch.clearCache(true);
                scratch.destroy();
            }
            CookieManager cookies = CookieManager.getInstance();
            cookies.removeAllCookies(removed -> {
                cookies.flush();
                call.resolve();
            });
        });
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * Set when the activity was recreated because the WebView renderer died; read once by the app (takeCrashNotice).
     * Process-wide on purpose: it has to outlive the activity, and the process does survive since the app answers true.
     */
    private static volatile boolean crashNotice;

    /**
     * Every WebView of an app shares one renderer process, so when the page's renderer is killed (a heavy site on a
     * low-memory phone) the app's own UI WebView loses it too. Capacitor answers false for the UI WebView unless a
     * listener says true, and false makes Android kill the whole app. This listener says true and recreates the
     * activity: the UI comes back on a new renderer (the page view goes with the old activity, handleOnDestroy), and
     * the app tells the person what happened. MainActivity adds it through the bridge builder: a listener added from
     * load() is dropped, because Bridge.Builder.create() replaces the list after the plugins have loaded.
     */
    static WebViewListener crashListener(BridgeActivity activity) {
        return new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (activity.getBridge() == null || view != activity.getBridge().getWebView()) return false;
                crashNotice = true;
                activity.runOnUiThread(activity::recreate);
                return true;
            }
        };
    }

    @PluginMethod
    public void takeCrashNotice(PluginCall call) {
        boolean crashed = crashNotice;
        crashNotice = false;
        JSObject out = new JSObject();
        out.put("crashed", crashed);
        call.resolve(out);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void handleOnDestroy() {
        destroyHost();
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- events (literal names: see nativeContract.test.ts)

    void emitMessage(int frame, int generation, String origin, boolean main, String data) {
        JSObject e = new JSObject();
        e.put("frame", frame);
        e.put("generation", generation);
        e.put("origin", origin);
        e.put("main", main);
        e.put("data", data);
        notifyListeners("message", e);
    }

    void emitFrameGone(int frame, int generation) {
        JSObject e = new JSObject();
        e.put("frame", frame);
        e.put("generation", generation);
        notifyListeners("frameGone", e);
    }

    void emitNavigation(String phase, String url, int generation, boolean canGoBack, boolean canGoForward) {
        JSObject e = new JSObject();
        e.put("phase", phase);
        e.put("url", url == null ? "" : url);
        e.put("generation", generation);
        e.put("canGoBack", canGoBack);
        e.put("canGoForward", canGoForward);
        notifyListeners("navigation", e);
    }

    void emitProgress(int value) {
        JSObject e = new JSObject();
        e.put("value", Math.max(0, Math.min(100, value)));
        notifyListeners("progress", e);
    }

    void emitTitle(String title, int generation) {
        JSObject e = new JSObject();
        e.put("title", title == null ? "" : title);
        e.put("generation", generation);
        notifyListeners("title", e);
    }

    void emitLoadError(String kind, String url, int code) {
        JSObject e = new JSObject();
        e.put("kind", kind);
        e.put("url", url == null ? "" : url);
        e.put("code", code);
        notifyListeners("loadError", e);
    }

    void emitCrashed() {
        notifyListeners("crashed", new JSObject());
    }

    void emitExternal(String url, boolean gesture, boolean main) {
        JSObject e = new JSObject();
        e.put("url", url == null ? "" : url);
        e.put("gesture", gesture);
        e.put("main", main);
        notifyListeners("external", e);
    }

    void emitDownload(String url, String mimeType, String fileName, long size) {
        JSObject e = new JSObject();
        e.put("url", url == null ? "" : url);
        e.put("mimeType", mimeType == null ? "" : mimeType);
        e.put("fileName", fileName == null ? "" : fileName);
        e.put("size", size < 0 ? -1 : size);
        notifyListeners("download", e);
    }

    void emitFileChooser(int id, List<String> accept, boolean multiple, boolean capture) {
        JSObject e = new JSObject();
        e.put("id", id);
        e.put("accept", new JSONArray(accept));
        e.put("multiple", multiple);
        e.put("capture", capture);
        notifyListeners("fileChooser", e);
    }

    void emitPermission(String kind) {
        JSObject e = new JSObject();
        e.put("kind", kind);
        notifyListeners("permission", e);
    }

    void emitKeyboard(boolean visible, int height) {
        JSObject e = new JSObject();
        e.put("visible", visible);
        e.put("height", height);
        notifyListeners("keyboard", e);
    }

    void emitPageArea(int width, int height) {
        JSObject e = new JSObject();
        e.put("width", width);
        e.put("height", height);
        notifyListeners("pageArea", e);
    }

    void emitFabTap() {
        notifyListeners("fabTap", new JSObject());
    }

    void emitFabMoved(float x, float y) {
        JSObject e = new JSObject();
        e.put("x", x);
        e.put("y", y);
        notifyListeners("fabMoved", e);
    }

    void emitFabSwitchSide() {
        JSObject e = new JSObject();
        e.put("action", "switchSide");
        notifyListeners("fabAction", e);
    }

    void emitScrimTap() {
        notifyListeners("scrimTap", new JSObject());
    }

    // ---------------------------------------------------------------- file chooser

    /** Called by PageChromeClient. A newer chooser cancels the older one, so each is answered exactly once. */
    boolean showFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        answerChooser(null);
        chooserCallback = callback;
        chooserParams = params;
        chooserId = nextChooserId++;
        Set<String> accept = new LinkedHashSet<>();
        String[] types = params.getAcceptTypes();
        if (types != null) {
            for (String type : types) {
                if (type == null) continue;
                for (String part : type.split(",")) {
                    String t = part.trim().toLowerCase(Locale.ROOT);
                    if (!t.isEmpty()) accept.add(t);
                }
            }
        }
        emitFileChooser(chooserId, new ArrayList<>(accept),
                params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE, params.isCaptureEnabled());
        return true;
    }

    private void answerChooser(Uri[] uris) {
        ValueCallback<Uri[]> callback = chooserCallback;
        chooserCallback = null;
        chooserParams = null;
        if (callback != null) callback.onReceiveValue(uris);
    }

    private void answerWithFiles(PluginCall call, int id) {
        JSArray files = call.getArray("files");
        if (files == null || files.length() == 0) {
            call.reject(BAD_ARGS);
            return;
        }
        List<byte[]> bytes = new ArrayList<>();
        List<String> names = new ArrayList<>();
        List<String> types = new ArrayList<>();
        try {
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                String name = file.getString("name");
                String type = file.getString("mimeType");
                byte[] data = Base64.decode(file.getString("data"), Base64.DEFAULT);
                if (data.length > MAX_FILE_BYTES || name.isEmpty()) {
                    call.reject(BAD_ARGS);
                    return;
                }
                bytes.add(data);
                names.add(name);
                types.add(type.isEmpty() ? "application/octet-stream" : type);
            }
        } catch (JSONException | IllegalArgumentException e) {
            call.reject(BAD_ARGS);
            return;
        }
        ui(() -> {
            if (id != chooserId || chooserCallback == null) {
                call.reject(NOT_FOUND);
                return;
            }
            boolean multiple = chooserParams.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
            int count = multiple ? bytes.size() : 1;
            Uri[] uris = new Uri[count];
            String packageName = getContext().getPackageName();
            for (int i = 0; i < count; i++) {
                uris[i] = ChooserStreamProvider.register(packageName, bytes.get(i), names.get(i), types.get(i));
            }
            answerChooser(uris);
            call.resolve();
        });
    }

    @ActivityCallback
    private void systemChooserResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        int id = call.getInt("id", -1);
        if (id != chooserId || chooserCallback == null) {
            call.resolve();
            return;
        }
        Uri[] uris = null;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                List<Uri> list = new ArrayList<>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri != null) list.add(uri);
                }
                if (!list.isEmpty()) uris = list.toArray(new Uri[0]);
            } else {
                uris = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), data);
            }
        }
        answerChooser(uris);
        call.resolve();
    }

    // ---------------------------------------------------------------- helpers

    private interface HostAction {
        void run(FillBrowserHost host);
    }

    private void withHost(PluginCall call, HostAction action) {
        ui(() -> {
            if (host == null) {
                call.reject(NO_BROWSER);
                return;
            }
            action.run(host);
        });
    }

    private void ui(Runnable runnable) {
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(runnable);
    }

    /** Called by FillBrowserHost after the page renderer died and the page view was recreated. */
    void onPageCrashed() {
        answerChooser(null);
        ChooserStreamProvider.clearAll();
        emitCrashed();
    }

    private void destroyHost() {
        answerChooser(null);
        ChooserStreamProvider.clearAll();
        if (host != null) {
            FillBrowserHost old = host;
            host = null;
            old.destroy();
        }
    }

    private boolean startExternal(String url) {
        String scheme = NavigationPolicy.scheme(url);
        Uri uri = Uri.parse(url);
        Intent intent;
        if ("tel".equals(scheme)) {
            intent = new Intent(Intent.ACTION_DIAL, uri);
        } else if ("mailto".equals(scheme) || "sms".equals(scheme) || "smsto".equals(scheme)) {
            intent = new Intent(Intent.ACTION_SENDTO, uri);
        } else {
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            view.addCategory(Intent.CATEGORY_BROWSABLE);
            intent = Intent.createChooser(view, null);
        }
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private static boolean isWebUrl(String url) {
        if (url == null || url.length() > MAX_URL_CHARS) return false;
        String scheme = NavigationPolicy.scheme(url);
        return "http".equals(scheme) || "https".equals(scheme);
    }

    /** NativeTheme as ARGB ints: bg, surface, text, line, accent, scrim. JS sends them as unsigned numbers. */
    static int[] theme(JSONObject theme) {
        String[] keys = {"bg", "surface", "text", "line", "accent", "scrim"};
        int[] fallback = {0xFFFFFFFF, 0xFFFFFFFF, 0xFF1C1C1F, 0xFFD0D0D6, 0xFF0066CC, 0x66000000};
        int[] out = new int[keys.length];
        for (int i = 0; i < keys.length; i++) {
            out[i] = theme == null || !theme.has(keys[i]) ? fallback[i] : (int) theme.optLong(keys[i], fallback[i]);
        }
        return out;
    }
}
