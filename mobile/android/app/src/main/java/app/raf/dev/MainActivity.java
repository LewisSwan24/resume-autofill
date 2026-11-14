package app.raf.dev;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String KEY_INCOMING_HANDLED = "raf.incoming.handled";

    /**
     * Set by IncomingFilePlugin once it has accepted a file. After process death Android delivers the launch intent
     * again; this keeps the same file from being imported twice. Only this boolean goes into the saved state, never
     * the file, its name or its URI.
     */
    boolean incomingHandled;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProfileVaultPlugin.class);
        registerPlugin(DocumentSaverPlugin.class);
        registerPlugin(IncomingFilePlugin.class);
        registerPlugin(FillBrowserPlugin.class);
        // The app survives the shared WebView renderer dying (see FillBrowserPlugin.crashListener).
        bridgeBuilder.addWebViewListener(FillBrowserPlugin.crashListener(this));
        incomingHandled = savedInstanceState != null && savedInstanceState.getBoolean(KEY_INCOMING_HANDLED);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(KEY_INCOMING_HANDLED, incomingHandled);
    }
}
