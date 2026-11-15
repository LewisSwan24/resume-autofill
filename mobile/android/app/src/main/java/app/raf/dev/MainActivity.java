package app.raf.dev;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    static final String KEY_INCOMING_HANDLED = "raf.incoming.handled";

    /**
     * Set by IncomingFilePlugin or IncomingIntentPlugin once it has accepted an intent. After process death Android
     * delivers the launch intent again; this keeps the same file or link from being taken twice. Only this boolean
     * goes into the saved state, never the file, the link, its name or its URI.
     */
    boolean incomingHandled;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProfileVaultPlugin.class);
        registerPlugin(DocumentSaverPlugin.class);
        registerPlugin(IncomingFilePlugin.class);
        registerPlugin(FillBrowserPlugin.class);
        registerPlugin(IncomingIntentPlugin.class);
        registerPlugin(ClipboardPeekPlugin.class);
        registerPlugin(RemindersPlugin.class);
        registerPlugin(AppShortcutsPlugin.class);
        registerPlugin(BrowserRolePlugin.class);
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

    /** Back in front: the clipboard card may look at the clip's description (Android 10+ allows clipboard reads only now). */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus || bridge == null) return;
        PluginHandle handle = bridge.getPlugin("ClipboardPeek");
        if (handle != null && handle.getInstance() instanceof ClipboardPeekPlugin) {
            ((ClipboardPeekPlugin) handle.getInstance()).notifyFocus();
        }
    }
}
