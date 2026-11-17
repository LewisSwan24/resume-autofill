package app.raf.dev;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;

/**
 * Offline HTML-to-PDF native print bridge using Android PrintManager and an isolated non-network WebView.
 */
@CapacitorPlugin(name = "PrintBridge")
public class PrintBridgePlugin extends Plugin {
    private static final int MAX_HTML_BYTES = 2 * 1024 * 1024;
    private static final String BAD_INPUT = "BAD_INPUT";
    private static final String UNAVAILABLE = "UNAVAILABLE";

    private WebView activePrintWebView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String jobName = call.getString("jobName", "resume-autofill");
        if (html == null || html.isEmpty() || html.length() > MAX_HTML_BYTES) {
            call.reject("Invalid HTML payload", BAD_INPUT);
            return;
        }
        String safeJob = (jobName == null || jobName.trim().isEmpty()) ? "resume-autofill" : jobName.trim();

        getActivity().runOnUiThread(() -> {
            Context ctx = getContext();
            PrintManager printManager = (PrintManager) ctx.getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
                call.reject("Print service unavailable", UNAVAILABLE);
                return;
            }

            if (activePrintWebView != null) {
                activePrintWebView.destroy();
                activePrintWebView = null;
            }

            WebView wv = new WebView(ctx);
            WebSettings settings = wv.getSettings();
            settings.setJavaScriptEnabled(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setBlockNetworkLoads(true);

            wv.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String scheme = request.getUrl().getScheme();
                    if ("about".equals(scheme) || "data".equals(scheme)) {
                        return super.shouldInterceptRequest(view, request);
                    }
                    return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    printManager.print(
                        safeJob,
                        view.createPrintDocumentAdapter(safeJob),
                        new PrintAttributes.Builder().build()
                    );
                    JSObject res = new JSObject();
                    res.put("started", true);
                    call.resolve(res);
                }
            });

            activePrintWebView = wv;
            wv.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (activePrintWebView != null) {
            activePrintWebView.destroy();
            activePrintWebView = null;
        }
        super.handleOnDestroy();
    }
}
