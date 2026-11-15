package app.raf.dev;

import android.content.Context;
import android.util.AtomicFile;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.app.NotificationManagerCompat;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * The resume profile on the phone: one JSON string, encrypted with AES-256-GCM under a key that lives in the
 * Android Keystore and never leaves it. Written atomically to the app's private files folder (excluded from backup
 * and device transfer by data_extraction_rules.xml). The page validates and migrates the JSON; this class only keeps
 * it secret.
 *
 * Attachment files (resume PDF, photo, transcript) are kept the same way, two files per id under files/attachments/:
 * {@code <id>.meta} (name, type, size, date as JSON) and {@code <id>.data} (the bytes), each encrypted on its own so
 * the details can be read without decrypting a 10 MB file. Data is written before meta, and meta deleted before
 * data, so an id with data but no meta is a half-written or half-deleted file: the page never shows it and its sweep
 * removes it.
 *
 * App state (onboarding, fill language, recent application pages) is one more JSON string in {@code state.enc},
 * sealed the same way under the same key. {@link #wipe} deletes all of it and the key itself, together with the
 * deadline reminders (alarms, reminders.enc, posted notifications) and the launcher shortcuts.
 *
 * The sealing itself lives in {@link VaultCrypto} (file layout described there).
 */
@CapacitorPlugin(name = "ProfileVault")
public class ProfileVaultPlugin extends Plugin {
    private static final String FILE_NAME = "profile.enc";
    private static final String STATE_FILE_NAME = "state.enc";
    private static final String ATTACHMENT_DIR = "attachments";
    private static final String META = ".meta";
    private static final String DATA = ".data";
    /** Ids come from the page; keep them to plain names so none can point outside the folder. */
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9-]{1,64}");
    /** AtomicFile's own side files while writing ("x.new") or before it commits ("x.bak"). */
    private static final Pattern ATOMIC_SIDE = Pattern.compile("\\.(new|bak)$");

    private final Object lock = new Object();
    private final Object fileLock = new Object();

    @PluginMethod
    public void read(PluginCall call) {
        synchronized (lock) {
            try {
                JSObject result = new JSObject();
                byte[] data = readSealed(profileFile());
                result.put("data", data == null ? JSObject.NULL : new String(data, StandardCharsets.UTF_8));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not read the profile: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Missing data");
            return;
        }
        synchronized (lock) {
            try {
                writeSealed(profileFile(), data.getBytes(StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save the profile: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    // ------------------------------------------------------------ app state

    @PluginMethod
    public void readState(PluginCall call) {
        synchronized (lock) {
            try {
                JSObject result = new JSObject();
                byte[] data = readSealed(stateFile());
                result.put("data", data == null ? JSObject.NULL : new String(data, StandardCharsets.UTF_8));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not read the app state: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void writeState(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Missing data");
            return;
        }
        synchronized (lock) {
            try {
                writeSealed(stateFile(), data.getBytes(StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save the app state: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void clearState(PluginCall call) {
        synchronized (lock) {
            deleteSealed(stateFile());
            if (sealedExists(stateFile())) call.reject("Could not delete the app state");
            else call.resolve();
        }
    }

    // ------------------------------------------------------------ delete everything

    /**
     * Delete the profile, the app state, every attachment file and the Keystore key. The next write creates a fresh
     * key through {@link #key()}. Rejects WIPE_FAILED when anything is left afterwards.
     */
    @PluginMethod
    public void wipe(PluginCall call) {
        synchronized (lock) {
            synchronized (fileLock) {
                boolean clean = true;
                Context context = getContext();
                // Reminders first: their alarms are found through reminders.enc, which needs the key.
                try {
                    ReminderScheduler.cancelAll(context);
                } catch (RuntimeException e) {
                    clean = false;
                }
                ReminderStore.delete(context);
                NotificationManagerCompat.from(context).cancelAll();
                try {
                    AppShortcutsPlugin.clearEverything(context);
                } catch (RuntimeException e) {
                    clean = false;
                }
                deleteSealed(profileFile());
                deleteSealed(stateFile());
                File dir = attachmentDir();
                File[] found = dir.listFiles();
                if (found != null) {
                    for (File f : found) f.delete();
                }
                dir.delete();
                clean = VaultCrypto.deleteKey() && clean;
                File[] left = dir.listFiles();
                clean = clean
                    && !ReminderStore.exists(context)
                    && !sealedExists(profileFile())
                    && !sealedExists(stateFile())
                    && !dir.exists()
                    && (left == null || left.length == 0);
                if (clean) call.resolve();
                else call.reject("Could not delete all data", "WIPE_FAILED");
            }
        }
    }

    // ------------------------------------------------------------ attachment files

    @PluginMethod
    public void writeFile(PluginCall call) {
        String id = call.getString("id");
        String meta = call.getString("meta");
        String data = call.getString("data");
        if (!validId(id) || meta == null || data == null) {
            call.reject("Missing or bad id, meta or data");
            return;
        }
        synchronized (fileLock) {
            try {
                File dir = attachmentDir();
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No attachments folder");
                writeSealed(new File(dir, id + DATA), Base64.decode(data, Base64.NO_WRAP));
                writeSealed(new File(dir, id + META), meta.getBytes(StandardCharsets.UTF_8));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save the file: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void readFileMeta(PluginCall call) {
        String id = call.getString("id");
        if (!validId(id)) {
            call.reject("Bad id");
            return;
        }
        synchronized (fileLock) {
            try {
                JSObject result = new JSObject();
                byte[] meta = readSealed(new File(attachmentDir(), id + META));
                result.put("meta", meta == null ? JSObject.NULL : new String(meta, StandardCharsets.UTF_8));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not read the file: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String id = call.getString("id");
        if (!validId(id)) {
            call.reject("Bad id");
            return;
        }
        synchronized (fileLock) {
            try {
                File dir = attachmentDir();
                byte[] meta = readSealed(new File(dir, id + META));
                byte[] data = meta == null ? null : readSealed(new File(dir, id + DATA));
                JSObject result = new JSObject();
                result.put("meta", meta == null ? JSObject.NULL : new String(meta, StandardCharsets.UTF_8));
                result.put("data", data == null ? JSObject.NULL : Base64.encodeToString(data, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not read the file: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String id = call.getString("id");
        if (!validId(id)) {
            call.reject("Bad id");
            return;
        }
        synchronized (fileLock) {
            File dir = attachmentDir();
            new AtomicFile(new File(dir, id + META)).delete();
            new AtomicFile(new File(dir, id + DATA)).delete();
            call.resolve();
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        synchronized (fileLock) {
            TreeSet<String> ids = new TreeSet<>();
            File[] found = attachmentDir().listFiles();
            if (found != null) {
                for (File f : found) {
                    String name = ATOMIC_SIDE.matcher(f.getName()).replaceFirst("");
                    String id = name.endsWith(META) ? name.substring(0, name.length() - META.length())
                        : name.endsWith(DATA) ? name.substring(0, name.length() - DATA.length())
                        : null;
                    if (validId(id)) ids.add(id);
                }
            }
            JSObject result = new JSObject();
            result.put("ids", new JSArray(ids));
            call.resolve(result);
        }
    }

    private static boolean validId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    private File attachmentDir() {
        return new File(getContext().getFilesDir(), ATTACHMENT_DIR);
    }

    // ------------------------------------------------------------ shared

    private File profileFile() {
        return new File(getContext().getFilesDir(), FILE_NAME);
    }

    private File stateFile() {
        return new File(getContext().getFilesDir(), STATE_FILE_NAME);
    }

    private static void deleteSealed(File target) {
        VaultCrypto.deleteSealed(target);
    }

    private static boolean sealedExists(File target) {
        return VaultCrypto.sealedExists(target);
    }

    private static void writeSealed(File target, byte[] plain) throws Exception {
        VaultCrypto.writeSealed(target, plain);
    }

    private static byte[] readSealed(File target) throws Exception {
        return VaultCrypto.readSealed(target);
    }
}
