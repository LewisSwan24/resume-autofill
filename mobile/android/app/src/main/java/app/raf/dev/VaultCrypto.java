package app.raf.dev;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The one place that seals and opens files on the phone: AES-256-GCM under a key that lives in the Android Keystore
 * and never leaves it, written atomically with AtomicFile. Moved out of ProfileVaultPlugin unchanged (same alias, same
 * format byte, same GCM parameters), so files written before still open. Used by ProfileVaultPlugin (profile, app
 * state, attachments) and ReminderStore (reminders.enc).
 *
 * File layout: [1 byte format version = 1][1 byte IV length][IV][ciphertext + GCM tag].
 */
final class VaultCrypto {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "raf.profile.v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte FORMAT_VERSION = 1;
    private static final int TAG_BITS = 128;
    /** Two threads must never both create the key: the loser's files would be sealed under a key that is gone. */
    private static final Object KEY_LOCK = new Object();

    private VaultCrypto() {}

    static byte[] seal(byte[] plain) throws GeneralSecurityException, IOException {
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

    static byte[] open(byte[] sealed) throws GeneralSecurityException, IOException {
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

    /** The decrypted contents of a file, or null when it does not exist (AtomicFile also restores a ".bak"). */
    static byte[] readSealed(File target) throws GeneralSecurityException, IOException {
        if (!target.exists() && !new File(target.getPath() + ".bak").exists()) return null;
        return open(new AtomicFile(target).readFully());
    }

    /** Seal {@code plain} and write it atomically. */
    static void writeSealed(File target, byte[] plain) throws GeneralSecurityException, IOException {
        byte[] sealed = seal(plain);
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

    /** Delete a sealed file with AtomicFile's side files ("x.new", "x.bak"). */
    static void deleteSealed(File target) {
        new AtomicFile(target).delete();
        new File(target.getPath() + ".new").delete();
        new File(target.getPath() + ".bak").delete();
    }

    static boolean sealedExists(File target) {
        return target.exists()
            || new File(target.getPath() + ".new").exists()
            || new File(target.getPath() + ".bak").exists();
    }

    /** Delete the Keystore key; true when it is gone afterwards. The next seal creates a fresh one. */
    static boolean deleteKey() {
        synchronized (KEY_LOCK) {
            try {
                KeyStore store = KeyStore.getInstance(KEYSTORE);
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
                return !store.containsAlias(KEY_ALIAS);
            } catch (Exception e) {
                return false;
            }
        }
    }

    private static SecretKey key() throws GeneralSecurityException, IOException {
        synchronized (KEY_LOCK) {
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
    }
}
