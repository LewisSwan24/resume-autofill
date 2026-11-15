package app.raf.dev.keyboard;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.raf.dev.VaultCrypto;

/**
 * files/keyboard.enc: the sealed KeyboardData the app writes for the keyboard. The static methods are used
 * by the app process (ResumeKeyboardPlugin, ProfileVaultPlugin.wipe); an instance is the keyboard process's reader. It
 * reads with VaultCrypto.readSealedIfKeyExists, so it never creates the key, on one background thread, and keeps the
 * parsed data in memory keyed by the file's length and modification time. Nothing is logged; failures carry no data.
 */
public final class KeyboardDataStore {
    public static final String FILE_NAME = "keyboard.enc";
    /** The native size limit, in UTF-8 bytes of the JSON (RESUME_KEYBOARD_MAX_BYTES in the TS contract). */
    public static final int MAX_BYTES = 524288;

    enum State { ABSENT, READY, ERROR }

    static final class Result {
        final State state;
        final KeyboardData data;

        Result(State state, KeyboardData data) {
            this.state = state;
            this.data = data;
        }
    }

    interface Callback {
        void done(Result result);
    }

    public static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    public static boolean exists(Context context) {
        return VaultCrypto.sealedExists(file(context));
    }

    public static void delete(Context context) {
        synchronized (VaultCrypto.FILES_LOCK) {
            VaultCrypto.deleteSealed(file(context));
        }
    }

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object cacheLock = new Object();
    private ByteCacheKey cachedKey;
    private KeyboardData cached;
    /** Bumped by forget(): a read that started before it must not put the data back. */
    private int generation;

    KeyboardDataStore(Context context) {
        this.context = context.getApplicationContext() != null ? context.getApplicationContext() : context;
    }

    /** Check the file and, when it changed, read it on the background thread; the callback runs on the main thread. */
    void loadAsync(Callback callback) {
        final int started;
        synchronized (cacheLock) {
            started = generation;
        }
        executor.execute(() -> {
            Result result = load(started);
            main.post(() -> callback.done(result));
        });
    }

    /** Drop the in-memory copy (locked phone, file gone, keyboard closing). */
    void forget() {
        synchronized (cacheLock) {
            generation++;
            cached = null;
            cachedKey = null;
        }
    }

    void shutdown() {
        forget();
        executor.shutdownNow();
    }

    private Result load(int started) {
        File f = file(context);
        if (!f.isFile()) {
            forget();
            return new Result(State.ABSENT, null);
        }
        ByteCacheKey key = new ByteCacheKey(f.length(), f.lastModified());
        synchronized (cacheLock) {
            if (cached != null && key.equals(cachedKey)) return new Result(State.READY, cached);
        }
        byte[] plain;
        try {
            plain = VaultCrypto.readSealedIfKeyExists(f);
        } catch (Exception e) {
            return new Result(State.ERROR, null);
        }
        if (plain == null) {
            forget();
            return new Result(State.ABSENT, null);
        }
        if (plain.length > MAX_BYTES) return new Result(State.ERROR, null);
        KeyboardData data;
        try {
            data = KeyboardData.parse(new String(plain, StandardCharsets.UTF_8));
        } catch (KeyboardData.Invalid e) {
            return new Result(State.ERROR, null);
        }
        synchronized (cacheLock) {
            if (generation == started) {
                cached = data;
                cachedKey = key;
            }
        }
        return new Result(State.READY, data);
    }
}
