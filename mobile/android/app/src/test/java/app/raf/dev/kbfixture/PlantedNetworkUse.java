package app.raf.dev.kbfixture;

import android.view.inputmethod.InputConnection;
import android.webkit.WebView;

import java.net.URL;

import app.raf.dev.MainActivity;

/**
 * TEST-ONLY PLANT. Never runs and is never shipped (src/test only). KeyboardNoNetworkTest must catch every reference
 * here, which shows the constant-pool check works. Each line is one banned kind.
 */
@SuppressWarnings("unused")
final class PlantedNetworkUse {
    private WebView view; // a web type, as a field type only
    private MainActivity other; // an app class outside the allowlist

    private PlantedNetworkUse() {}

    static Object planted(InputConnection ic) throws Exception {
        URL url = new URL("https", "example.com", "/");
        Class<?> socket = Class.forName("java.net.Socket");
        CharSequence before = ic.getTextBeforeCursor(10, 0);
        return new Object[] {url, socket, before};
    }
}
