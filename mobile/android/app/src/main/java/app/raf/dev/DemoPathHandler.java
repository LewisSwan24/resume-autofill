package app.raf.dev;

import android.content.Context;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.util.regex.Pattern;

/**
 * Serves the sample application form from assets/raf/demo/ at https://appassets.androidplatform.net/demo/*.
 * Only plain file names of the listed types; anything else is null, which the page client turns into a 404.
 */
final class DemoPathHandler implements WebViewAssetLoader.PathHandler {
    static final String HOST = "appassets.androidplatform.net";
    static final String PREFIX = "/demo/";
    private static final String ASSET_DIR = "raf/demo/";
    private static final Pattern NAME = Pattern.compile("[a-z0-9-]+\\.(html|css|svg|png|pdf)");

    private final Context context;

    DemoPathHandler(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse handle(String path) {
        if (path == null || !NAME.matcher(path).matches()) return null;
        try {
            InputStream in = context.getAssets().open(ASSET_DIR + path);
            String ext = path.substring(path.lastIndexOf('.') + 1);
            boolean text = ext.equals("html") || ext.equals("css") || ext.equals("svg");
            return new WebResourceResponse(mimeType(ext), text ? "utf-8" : null, in);
        } catch (IOException e) {
            return null;
        }
    }

    static String mimeType(String ext) {
        switch (ext) {
            case "html":
                return "text/html";
            case "css":
                return "text/css";
            case "svg":
                return "image/svg+xml";
            case "png":
                return "image/png";
            case "pdf":
                return "application/pdf";
            default:
                return "application/octet-stream";
        }
    }
}
