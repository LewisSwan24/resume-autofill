package app.raf.dev;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Saves an export file where the person chooses, through the system "create document" picker. The app gets access
 * to the chosen file only, so no storage permission is needed. Nothing here logs, and no error message carries the
 * file's name or content.
 */
@CapacitorPlugin(name = "DocumentSaver")
public class DocumentSaverPlugin extends Plugin {
    private static final String MIME_JSON = "application/json";
    private static final int MAX_NAME_LENGTH = 128;
    private static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final String BAD_INPUT = "BAD_INPUT";
    private static final String NO_PICKER = "NO_PICKER";
    private static final String WRITE_FAILED = "WRITE_FAILED";

    private final ExecutorService writer = Executors.newSingleThreadExecutor();

    /**
     * The bytes waiting for the picker's answer. Kept here, not in the call: Capacitor writes the data of a call started
     * with startActivityForResult into the activity's saved state, a Bundle that leaves the app (and its size limit can
     * crash it) each time the app goes to the background. Only touched on the main thread.
     */
    private byte[] pending;

    /** {@code save({ name, mimeType, data })}, data base64. Resolves {@code { saved: true | false }}. */
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name");
        String mimeType = call.getString("mimeType");
        byte[] bytes = validName(name) && MIME_JSON.equals(mimeType) ? decode(call.getString("data")) : null;
        if (bytes == null) {
            call.reject("Bad file name, type or data", BAD_INPUT);
            return;
        }
        // The export leaves the call before the picker opens, so the saved state never holds it.
        call.getData().remove("data");
        pending = bytes;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(call, intent, "saveResult");
        } catch (ActivityNotFoundException e) {
            pending = null;
            bridge.releaseCall(call);
            call.reject("No app can save files", NO_PICKER);
        }
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        byte[] bytes = pending;
        pending = null;
        if (call == null) return;
        // Done with the call either way: released, it is no longer written into the saved state.
        bridge.releaseCall(call);
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            resolveSaved(call, false);
            return;
        }
        if (bytes == null) {
            // The app was stopped while the picker was open, so the bytes are gone; the empty file is not kept.
            try {
                DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
            } catch (Exception ignored) {
                // Nothing more can be done from here.
            }
            call.reject("Could not write the file", WRITE_FAILED);
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        writer.execute(() -> {
            try (OutputStream out = resolver.openOutputStream(uri, "wt")) {
                if (out == null) throw new IOException();
                out.write(bytes);
                out.flush();
            } catch (Exception e) {
                try {
                    DocumentsContract.deleteDocument(resolver, uri);
                } catch (Exception ignored) {
                    // The half-written document may stay; nothing more can be done from here.
                }
                call.reject("Could not write the file", WRITE_FAILED);
                return;
            }
            resolveSaved(call, true);
        });
    }

    @Override
    protected void handleOnDestroy() {
        writer.shutdown();
        super.handleOnDestroy();
    }

    private static void resolveSaved(PluginCall call, boolean saved) {
        JSObject result = new JSObject();
        result.put("saved", saved);
        call.resolve(result);
    }

    private static boolean validName(String name) {
        return name != null && !name.isEmpty() && name.length() <= MAX_NAME_LENGTH && name.indexOf('/') < 0
            && name.indexOf('\u0000') < 0;
    }

    /** The decoded bytes, or null when missing, not base64 or over the size limit. */
    private static byte[] decode(String data) {
        if (data == null || data.length() / 4L * 3L > MAX_BYTES + 3L) return null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            return bytes.length <= MAX_BYTES ? bytes : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
