package app.raf.dev;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Files other apps hand to this one with "open with" (ACTION_VIEW) or "share" (ACTION_SEND): a PDF or a .docx, read
 * off the main thread with a 10 MiB cap and kept in one pending slot until the web side takes it. The slot holds at
 * most one file, lives in memory only and is touched only on the main thread. Nothing here logs, nothing goes into
 * the activity's saved state, and no file name, URI or content ever reaches an error message.
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {
    static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final int MAX_NAME = 128;
    private static final String EVENT = "incomingFile";
    private static final String MIME_PDF = "application/pdf";
    private static final String MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String MIME_OCTET = "application/octet-stream";

    private enum State { NONE, READING, READY, ERROR }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    // The pending slot. Main thread only.
    private State state = State.NONE;
    private String source;
    private String name = "";
    private String mimeType;
    private byte[] bytes;
    private String reason;
    /** Bumped for every accepted intent, so a read that was overtaken by a newer file never delivers. */
    private int generation;

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity instanceof MainActivity && ((MainActivity) activity).incomingHandled) return;
        Intent intent = activity.getIntent();
        // Reopened from Recents after leaving with back: Android hands over the original "open with" or "share" intent
        // again, with this flag. That file was handled the first time.
        if (intent != null && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        accept(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        // BridgeActivity.load() hands the launch intent over here too, right after load(), which has already decided on
        // it (taken, or skipped as handled before or redelivered from Recents). A real new intent is another object.
        if (intent == getActivity().getIntent()) return;
        accept(intent);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        generation++;
        clear();
        super.handleOnDestroy();
    }

    /** {@code take()}: the pending item. A ready file or an error leaves the slot before the call resolves. */
    @PluginMethod
    public void take(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            switch (state) {
                case READING:
                    result.put("state", "reading");
                    result.put("name", name);
                    break;
                case ERROR:
                    result.put("state", "error");
                    result.put("reason", reason);
                    clear();
                    break;
                case READY:
                    result.put("state", "ready");
                    result.put("source", source);
                    result.put("name", name);
                    result.put("mimeType", mimeType);
                    result.put("size", bytes.length);
                    result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    clear();
                    break;
                default:
                    result.put("state", "none");
            }
            call.resolve(result);
        });
    }

    private void accept(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri;
        String from;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
            from = "view";
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = streamOf(intent);
            from = "send";
        } else {
            return;
        }
        if (uri == null || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) return;

        Activity activity = getActivity();
        if (activity instanceof MainActivity) ((MainActivity) activity).incomingHandled = true;
        generation++;
        clear();
        state = State.READING;
        source = from;
        notifyListeners(EVENT, stateEvent("reading"), false);

        final int job = generation;
        final String intentType = intent.getType();
        final ContentResolver resolver = getContext().getContentResolver();
        try {
            executor.execute(() -> read(job, resolver, uri, intentType));
        } catch (RejectedExecutionException e) {
            finish(job, null, null, null, "unreadable");
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri streamOf(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    /** Background thread: everything that talks to the sender's provider. */
    private void read(int job, ContentResolver resolver, Uri uri, String intentType) {
        String displayName = "";
        try {
            long size = -1;
            try (Cursor cursor = resolver.query(
                    uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE);
                    if (nameAt >= 0 && !cursor.isNull(nameAt)) displayName = cleanName(cursor.getString(nameAt));
                    if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt);
                }
            }
            if (displayName.isEmpty()) displayName = cleanName(uri.getLastPathSegment());
            showName(job, displayName);
            if (size > MAX_BYTES) {
                finish(job, null, null, null, "too_large");
                return;
            }
            String type = typeOf(resolver.getType(uri), intentType, displayName);
            if (type == null) {
                finish(job, null, null, null, "wrong_type");
                return;
            }
            try (InputStream in = resolver.openInputStream(uri)) {
                if (in == null) {
                    finish(job, null, null, null, "unreadable");
                    return;
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(chunk)) != -1) {
                    total += n;
                    if (total > MAX_BYTES) {
                        finish(job, null, null, null, "too_large");
                        return;
                    }
                    out.write(chunk, 0, n);
                    if (Thread.currentThread().isInterrupted()) return;
                }
                if (total == 0) {
                    finish(job, null, null, null, "empty");
                    return;
                }
                finish(job, displayName, type, out.toByteArray(), null);
            }
        } catch (SecurityException | IOException e) {
            finish(job, null, null, null, "unreadable");
        } catch (RuntimeException e) {
            finish(job, null, null, null, "unreadable");
        }
    }

    /** What the sender says, then the intent's type; a name ending .pdf / .docx decides only when neither is useful. */
    private static String typeOf(String resolverType, String intentType, String displayName) {
        String type = normaliseType(resolverType);
        if (type == null) type = normaliseType(intentType);
        if (MIME_PDF.equals(type) || MIME_DOCX.equals(type)) return type;
        if (type != null && !MIME_OCTET.equals(type)) return null;
        String lower = displayName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".pdf")) return MIME_PDF;
        if (lower.endsWith(".docx")) return MIME_DOCX;
        return null;
    }

    private static String normaliseType(String type) {
        if (type == null) return null;
        int semi = type.indexOf(';');
        String bare = (semi >= 0 ? type.substring(0, semi) : type).trim().toLowerCase(Locale.ROOT);
        return bare.isEmpty() ? null : bare;
    }

    /** Last path segment, no control or format (bidi) characters, trimmed, at most 128 characters. */
    static String cleanName(String raw) {
        if (raw == null) return "";
        String[] parts = raw.split("[/\\\\]", -1);
        String last = parts[parts.length - 1];
        String visible = last.replaceAll("[\\p{Cc}\\p{Cf}]", "").trim();
        if (visible.codePointCount(0, visible.length()) > MAX_NAME) {
            visible = visible.substring(0, visible.offsetByCodePoints(0, MAX_NAME)).trim();
        }
        return visible;
    }

    private void showName(int job, String displayName) {
        main.post(() -> {
            if (job == generation && state == State.READING) name = displayName;
        });
    }

    private void finish(int job, String displayName, String type, byte[] data, String failure) {
        main.post(() -> {
            if (job != generation) return;
            if (data != null) {
                state = State.READY;
                name = displayName;
                mimeType = type;
                bytes = data;
                reason = null;
                notifyListeners(EVENT, stateEvent("ready"), false);
            } else {
                state = State.ERROR;
                bytes = null;
                reason = failure;
                notifyListeners(EVENT, stateEvent("error"), false);
            }
        });
    }

    private static JSObject stateEvent(String value) {
        JSObject event = new JSObject();
        event.put("state", value);
        return event;
    }

    private void clear() {
        state = State.NONE;
        source = null;
        name = "";
        mimeType = null;
        bytes = null;
        reason = null;
    }
}
