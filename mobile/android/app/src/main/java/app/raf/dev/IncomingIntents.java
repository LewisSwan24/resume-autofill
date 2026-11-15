package app.raf.dev;

import android.content.Intent;
import android.net.Uri;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * What an intent handed to MainActivity is: a file, a web link, shared text, one of the launcher shortcuts, a refused
 * link, or nothing for us. Pure (strings and flags in, a result out) so it is unit-tested on the JVM. IncomingFilePlugin
 * takes FILE; IncomingIntentPlugin takes every other kind except NONE. A relaunch from Recents is always NONE: Android
 * hands the original intent over again, and it was handled the first time.
 */
final class IncomingIntents {
    static final String ACTION_PASTE_LINK = "app.raf.dev.action.PASTE_LINK";
    static final String ACTION_OPEN_DEMO = "app.raf.dev.action.OPEN_DEMO";
    static final String ACTION_OPEN_APPLICATION = "app.raf.dev.action.OPEN_APPLICATION";
    static final String EXTRA_RECORD_ID = "recordId";
    static final String EXTRA_OPEN = "open";
    static final String OPEN_DETAIL = "detail";
    static final String OPEN_PAGE = "page";
    /** A deadline notification's 打开网申页面: opens the page like OPEN_PAGE, and its close goes back to 网申. */
    static final String OPEN_REMINDER_PAGE = "reminder-page";
    static final String FROM_REMINDER = "reminder";

    static final int MAX_URL = 4096;
    static final int MAX_TEXT = 8192;
    static final int MAX_SUBJECT = 200;

    private static final Pattern RECORD_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");

    enum Kind { NONE, FILE, VIEW, TEXT, PASTE, DEMO, APPLICATION, REFUSED }

    static final class Result {
        Kind kind = Kind.NONE;
        String url;
        String text;
        String subject;
        boolean cut;
        String recordId;
        String open;
        /** FROM_REMINDER for a notification's page action, else null. */
        String from;
        /** "scheme" or "too_long" for REFUSED. */
        String reason;

        private Result(Kind kind) {
            this.kind = kind;
        }
    }

    private IncomingIntents() {}

    static boolean validRecordId(String id) {
        return id != null && RECORD_ID.matcher(id).matches();
    }

    /**
     * Read what the classifier needs from a real intent. Extras come from another app: a malformed parcel throws when
     * it is unpacked, and that intent is then nothing for us.
     */
    static Result classify(Intent intent) {
        if (intent == null) return new Result(Kind.NONE);
        try {
            Uri data = intent.getData();
            CharSequence title = intent.getCharSequenceExtra(Intent.EXTRA_TITLE);
            return classify(
                intent.getAction(), data == null ? null : data.getScheme(), intent.getDataString(), intent.getType(),
                intent.getCharSequenceExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT),
                title == null ? null : title.toString(), intent.hasExtra(Intent.EXTRA_STREAM),
                intent.getStringExtra(EXTRA_RECORD_ID), intent.getStringExtra(EXTRA_OPEN), intent.getFlags());
        } catch (RuntimeException e) {
            return new Result(Kind.NONE);
        }
    }

    static Result classify(String action, String scheme, String dataString, String type, CharSequence text,
                           String subject, String title, boolean hasStream, String recordId, String open, int flags) {
        if ((flags & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0 || action == null) return new Result(Kind.NONE);
        switch (action) {
            case Intent.ACTION_VIEW:
                return view(scheme, dataString);
            case Intent.ACTION_SEND:
                return send(type, text, subject, title, hasStream);
            case ACTION_PASTE_LINK:
                return new Result(Kind.PASTE);
            case ACTION_OPEN_DEMO:
                return new Result(Kind.DEMO);
            case ACTION_OPEN_APPLICATION: {
                if (!validRecordId(recordId)) return new Result(Kind.NONE);
                Result r = new Result(Kind.APPLICATION);
                r.recordId = recordId;
                r.open = OPEN_DETAIL.equals(open) ? OPEN_DETAIL : OPEN_PAGE;
                if (OPEN_REMINDER_PAGE.equals(open)) r.from = FROM_REMINDER;
                return r;
            }
            default:
                return new Result(Kind.NONE);
        }
    }

    private static Result view(String scheme, String dataString) {
        if (dataString == null || dataString.isEmpty()) return new Result(Kind.NONE);
        String s = scheme == null ? "" : scheme.toLowerCase(Locale.ROOT);
        if ("content".equals(s)) return new Result(Kind.FILE);
        if (!"http".equals(s) && !"https".equals(s)) return refused("scheme");
        if (dataString.length() > MAX_URL) return refused("too_long");
        Result r = new Result(Kind.VIEW);
        r.url = dataString;
        return r;
    }

    private static Result send(String type, CharSequence text, String subject, String title, boolean hasStream) {
        boolean textType = type != null && type.toLowerCase(Locale.ROOT).startsWith("text/");
        String body = text == null ? null : text.toString();
        if (textType && body != null && !body.trim().isEmpty()) {
            Result r = new Result(Kind.TEXT);
            r.cut = body.codePointCount(0, body.length()) > MAX_TEXT;
            r.text = r.cut ? body.substring(0, body.offsetByCodePoints(0, MAX_TEXT)) : body;
            String about = subject != null && !subject.isEmpty() ? subject : title;
            r.subject = about == null || about.isEmpty() ? null : cutCodePoints(about, MAX_SUBJECT);
            return r;
        }
        if (hasStream) return new Result(Kind.FILE);
        return new Result(Kind.NONE);
    }

    static String cutCodePoints(String s, int max) {
        if (s.codePointCount(0, s.length()) <= max) return s;
        return s.substring(0, s.offsetByCodePoints(0, max));
    }

    private static Result refused(String reason) {
        Result r = new Result(Kind.REFUSED);
        r.reason = reason;
        return r;
    }
}
