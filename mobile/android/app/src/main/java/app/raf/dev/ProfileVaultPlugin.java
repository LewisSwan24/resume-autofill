package app.raf.dev;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

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
 * File layout: [1 byte format version = 1][1 byte IV length][IV][ciphertext + GCM tag].
 */
@CapacitorPlugin(name = "ProfileVault")
public class ProfileVaultPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "raf.profile.v1";
    private static final String FILE_NAME = "profile.enc";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte FORMAT_VERSION = 1;
    private static final int TAG_BITS = 128;

    private final Object lock = new Object();

    @PluginMethod
    public void read(PluginCall call) {
        synchronized (lock) {
            try {
                JSObject result = new JSObject();
                File file = profileFile();
                if (!file.exists()) {
                    result.put("data", JSObject.NULL);
                } else {
                    result.put("data", decrypt(new AtomicFile(file).readFully()));
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
            AtomicFile file = new AtomicFile(profileFile());
            FileOutputStream out = null;
            try {
                byte[] sealed = encrypt(data);
                out = file.startWrite();
                out.write(sealed);
                file.finishWrite(out);
                call.resolve();
            } catch (Exception e) {
                if (out != null) file.failWrite(out);
                call.reject("Could not save the profile: " + e.getClass().getSimpleName(), e);
            }
        }
    }

    private File profileFile() {
        return new File(getContext().getFilesDir(), FILE_NAME);
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

    private byte[] encrypt(String plain) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key()); // the Keystore picks a fresh random IV
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return ByteBuffer.allocate(2 + iv.length + body.length)
            .put(FORMAT_VERSION)
            .put((byte) iv.length)
            .put(iv)
            .put(body)
            .array();
    }

    private String decrypt(byte[] sealed) throws GeneralSecurityException, IOException {
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
        return new String(cipher.doFinal(body), StandardCharsets.UTF_8);
    }
}
