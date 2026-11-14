package app.raf.dev;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProfileVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
