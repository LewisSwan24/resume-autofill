package app.raf.dev;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.util.List;

import app.raf.dev.keyboard.KeyboardData;
import app.raf.dev.keyboard.KeyboardDataStore;
import app.raf.dev.keyboard.ResumeKeyboardService;

/**
 * The resume keyboard's side in the app (contract: mobile/app/src/native/resumeKeyboard.ts). It reports whether the
 * keyboard is enabled and current, opens the system input-method settings and picker, and seals the slim projection the
 * keyboard reads into files/keyboard.enc. writeData and clearData do their file work synchronously, inside
 * VaultCrypto.FILES_LOCK, so delete-all (ProfileVaultPlugin.wipe) cannot race them. Rejects carry only constant
 * codes; nothing of the data is logged or put into a message.
 */
@CapacitorPlugin(name = "ResumeKeyboard")
public class ResumeKeyboardPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openInputMethodSettings(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Intent intent = new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("opened", true);
        } catch (ActivityNotFoundException e) {
            result.put("opened", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void showPicker(PluginCall call) {
        InputMethodManager imm = getContext().getSystemService(InputMethodManager.class);
        if (imm == null || getActivity() == null) {
            JSObject result = new JSObject();
            result.put("shown", false);
            call.resolve(result);
            return;
        }
        getActivity().runOnUiThread(() -> {
            imm.showInputMethodPicker();
            JSObject result = new JSObject();
            result.put("shown", true);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void writeData(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Keyboard data is missing", "BAD_DATA");
            return;
        }
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > KeyboardDataStore.MAX_BYTES) {
            call.reject("Keyboard data is too large", "TOO_LARGE");
            return;
        }
        try {
            KeyboardData.parse(data);
        } catch (KeyboardData.Invalid e) {
            call.reject("Keyboard data has the wrong shape", "BAD_DATA");
            return;
        }
        boolean written;
        synchronized (VaultCrypto.FILES_LOCK) {
            try {
                VaultCrypto.writeSealed(KeyboardDataStore.file(getContext()), bytes);
                written = true;
            } catch (Exception e) {
                written = false;
            }
        }
        if (written) call.resolve();
        else call.reject("Could not write keyboard data", "WRITE_FAILED");
    }

    @PluginMethod
    public void clearData(PluginCall call) {
        Context context = getContext();
        boolean removed;
        synchronized (VaultCrypto.FILES_LOCK) {
            boolean existed = KeyboardDataStore.exists(context);
            KeyboardDataStore.delete(context);
            removed = existed && !KeyboardDataStore.exists(context);
        }
        JSObject result = new JSObject();
        result.put("removed", removed);
        call.resolve(result);
    }

    /** Called by MainActivity when its window gains focus: back from system settings, the picker, or another app. */
    void notifyStateChange() {
        notifyListeners("stateChange", statusObject(), false);
    }

    private JSObject statusObject() {
        Context context = getContext();
        String id = new ComponentName(context, ResumeKeyboardService.class).flattenToShortString();
        InputMethodManager imm = context.getSystemService(InputMethodManager.class);
        boolean declared;
        try {
            context.getPackageManager().getServiceInfo(new ComponentName(context, ResumeKeyboardService.class), 0);
            declared = true;
        } catch (PackageManager.NameNotFoundException e) {
            declared = false;
        }
        boolean enabled = false;
        if (imm != null) {
            List<InputMethodInfo> list = imm.getEnabledInputMethodList();
            for (InputMethodInfo info : list) if (id.equals(info.getId())) enabled = true;
        }
        String current = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
        JSObject result = new JSObject();
        result.put("available", declared && imm != null);
        result.put("enabled", enabled);
        result.put("current", id.equals(current));
        return result;
    }
}
