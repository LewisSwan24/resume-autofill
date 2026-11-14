package app.raf.dev;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Answers a page's file input with a file from the app's own (encrypted) attachments. The decrypted bytes stay in
 * memory under a random token until the browser closes or its page crashes (at most MAX_ENTRIES files and MAX_BYTES,
 * oldest first out), and each open streams them to the WebView through a pipe. Nothing is ever written to disk. Not
 * exported: only this app's WebView, which runs in this process, can read it.
 *
 * A token is not single-use: measured on the emulator, Chromium opens a chosen content:// file once
 * when it is picked and again whenever the page reads or submits it, which can be minutes later.
 */
public class ChooserStreamProvider extends ContentProvider {
    static final String AUTHORITY_SUFFIX = ".chooser";
    static final Tokens TOKENS = new Tokens();

    /** One file held for the chooser. */
    static final class Entry {
        final byte[] bytes;
        final String name;
        final String mimeType;

        Entry(byte[] bytes, String name, String mimeType) {
            this.bytes = bytes;
            this.name = name;
            this.mimeType = mimeType;
        }

        int size() {
            return bytes.length;
        }
    }

    /** The token table. Free of Android types so it unit-tests on the JVM (ChooserTokensTest). */
    static final class Tokens {
        static final int MAX_ENTRIES = 16;
        static final int MAX_BYTES = 64 * 1024 * 1024;
        /** Insertion order, so the oldest file goes first when the caps are reached. */
        private final Map<String, Entry> entries = new LinkedHashMap<>();
        private final SecureRandom random = new SecureRandom();
        private long bytesHeld;

        synchronized String put(byte[] bytes, String name, String mimeType) {
            byte[] raw = new byte[16];
            String token;
            do {
                random.nextBytes(raw);
                StringBuilder hex = new StringBuilder(32);
                for (byte b : raw) hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
                token = hex.toString();
            } while (entries.containsKey(token));
            entries.put(token, new Entry(bytes, name, mimeType));
            bytesHeld += bytes.length;
            Iterator<Entry> oldest = entries.values().iterator();
            while ((entries.size() > MAX_ENTRIES || bytesHeld > MAX_BYTES) && entries.size() > 1) {
                bytesHeld -= oldest.next().size();
                oldest.remove();
            }
            return token;
        }

        /** The entry, for name, size and type. */
        synchronized Entry peek(String token) {
            return token == null ? null : entries.get(token);
        }

        /** The entry, for reading its bytes; it stays for the next open. */
        synchronized Entry open(String token) {
            return peek(token);
        }

        synchronized void clear() {
            entries.clear();
            bytesHeld = 0;
        }

        synchronized int size() {
            return entries.size();
        }
    }

    /** Holds the bytes and returns the content URI the WebView reads them from. */
    static Uri register(String packageName, byte[] bytes, String name, String mimeType) {
        String token = TOKENS.put(bytes, name, mimeType);
        return new Uri.Builder().scheme("content").authority(packageName + AUTHORITY_SUFFIX).appendPath(token).build();
    }

    static void clearAll() {
        TOKENS.clear();
    }

    private static String token(Uri uri) {
        List<String> segments = uri.getPathSegments();
        return segments.size() == 1 ? segments.get(0) : null;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        Entry entry = TOKENS.peek(token(uri));
        if (entry == null) return null;
        String[] columns = projection == null ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = entry.name;
            else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = (long) entry.size();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        Entry entry = TOKENS.peek(token(uri));
        return entry == null ? null : entry.mimeType;
    }

    @Override
    public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        Entry entry = open(uri, mode);
        return new AssetFileDescriptor(pipe(entry), 0, entry.size());
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return pipe(open(uri, mode));
    }

    private static Entry open(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("read_only");
        Entry entry = TOKENS.open(token(uri));
        if (entry == null) throw new FileNotFoundException("not_found");
        return entry;
    }

    private static ParcelFileDescriptor pipe(Entry entry) throws FileNotFoundException {
        final ParcelFileDescriptor[] pair;
        try {
            pair = ParcelFileDescriptor.createReliablePipe();
        } catch (IOException e) {
            throw new FileNotFoundException("pipe_failed");
        }
        final ParcelFileDescriptor writeSide = pair[1];
        Thread writer = new Thread(() -> {
            OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(writeSide);
            try {
                out.write(entry.bytes);
                out.close();
            } catch (IOException | RuntimeException e) {
                try {
                    writeSide.closeWithError("write_failed");
                } catch (IOException | RuntimeException ignored) {
                    // The reader has gone; nothing left to tell it.
                }
            }
        }, "raf-chooser-pipe");
        writer.setDaemon(true);
        writer.start();
        return pair[0];
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
