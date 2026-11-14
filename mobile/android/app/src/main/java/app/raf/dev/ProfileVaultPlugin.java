package app.raf.dev;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.TreeSet;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

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
 * File layout: [1 byte format version = 1][1 byte IV length][IV][ciphertext + GCM tag].
 */
@CapacitorPlugin(name = "ProfileVault")
public class ProfileVaultPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "raf.profile.v1";
    private static final String FILE_NAME = "profile.enc";
    private static final String ATTACHMENT_DIR = "attachments";
    private static final String META = ".meta";
    private static final String DATA = ".data";
    /** Ids come from the page; keep them to plain names so none can point outside the folder. */
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9-]{1,64}");
    /** AtomicFile's own side files while writing ("x.new") or before it commits ("x.bak"). */
    private static final Pattern ATOMIC_SIDE = Pattern.compile("\\.(new|bak)$");
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte FORMAT_VERSION = 1;
    private static final int TAG_BITS = 128;

    private final Object lock = new Object();
    private final Object fileLock = new Object();

    @PluginMethod
    public void read(PluginCall call) {
        synchronized (lock) {
            try {
                JSObject result = new JSObject();
                File file = profileFile();
                if (!file.exists()) {
                    result.put("data", JSObject.NULL);
                } else {
                    result.put("data", new String(decrypt(new AtomicFile(file).readFully()), StandardCharsets.UTF_8));
                }
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
                writeSealed(profileFile(), encrypt(data.getBytes(StandardCharsets.UTF_8)));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save the profile: " + e.getClass().getSimpleName(), e);
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
                writeSealed(new File(dir, id + DATA), encrypt(Base64.decode(data, Base64.NO_WRAP)));
                writeSealed(new File(dir, id + META), encrypt(meta.getBytes(StandardCharsets.UTF_8)));
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

    private static void writeSealed(File target, byte[] sealed) throws IOException {
        AtomicFile file = new AtomicFile(target);
        FileOutputStream out = file.startWrite();
        try {
            out.write(sealed);
            file.finishWrite(out);
        } catch (IOException e) {
            file.failWrite(out);
            throw e;
        }
    }

    /** The decrypted contents of a file, or null when it does not exist (AtomicFile also restores a ".bak"). */
    private byte[] readSealed(File target) throws GeneralSecurityException, IOException {
        if (!target.exists() && !new File(target.getPath() + ".bak").exists()) return null;
        return decrypt(new AtomicFile(target).readFully());
    }

    private SecretKey key() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private byte[] encrypt(byte[] plain) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key()); // the Keystore picks a fresh random IV
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain);
        return ByteBuffer.allocate(2 + iv.length + body.length)
            .put(FORMAT_VERSION)
            .put((byte) iv.length)
            .put(iv)
            .put(body)
            .array();
    }

    private byte[] decrypt(byte[] sealed) throws GeneralSecurityException, IOException {
        ByteBuffer buffer = ByteBuffer.wrap(sealed);
        if (sealed.length < 2 || buffer.get() != FORMAT_VERSION) throw new GeneralSecurityException("Unknown format");
        int ivLength = buffer.get() & 0xff;
        if (ivLength == 0 || ivLength > buffer.remaining()) throw new GeneralSecurityException("Bad IV");
        byte[] iv = new byte[ivLength];
        buffer.get(iv);
        byte[] body = new byte[buffer.remaining()];
        buffer.get(body);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(body);
    }
}
