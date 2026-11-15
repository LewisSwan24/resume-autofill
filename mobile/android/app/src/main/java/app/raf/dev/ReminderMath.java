package app.raf.dev;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.regex.Pattern;

/**
 * Pure arithmetic of deadline reminders. Times arrive as local wall-clock strings ("2026-11-20T09:00") and become
 * instants only here, on the device, at schedule time, so a time-zone change or a reboot re-schedules them right.
 * tracker/model/dates.ts (wallToEpoch) must give the same instants; both test the same fixtures.
 */
final class ReminderMath {
    enum Decision { SCHEDULE, POST_NOW, DROP }

    /** A reminder whose time passed while the phone was off still posts within this, if the deadline is ahead. */
    static final long LATE_POST_MS = 6L * 60 * 60 * 1000;

    private static final Pattern WALL = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}");
    private static final Pattern ENTRY_ID = Pattern.compile("[A-Za-z0-9-]{1,64}:(d0|d1)");
    private static final DateTimeFormatter STRICT =
        DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm").withResolverStyle(ResolverStyle.STRICT);

    private ReminderMath() {}

    /** Epoch milliseconds of a wall time in a zone; a gap shifts later, an overlap takes the earlier offset. */
    static long toEpoch(String wall, ZoneId zone) {
        if (!validWall(wall)) throw new IllegalArgumentException("bad wall time");
        return LocalDateTime.parse(wall, STRICT).atZone(zone).toInstant().toEpochMilli();
    }

    static Decision decide(long at, long end, long now) {
        if (at > now) return Decision.SCHEDULE;
        if (now - at <= LATE_POST_MS && now < end) return Decision.POST_NOW;
        return Decision.DROP;
    }

    /**
     * The decision for an entry in a sync from the app. The app keeps a due entry in its payload for up to six hours,
     * so a sync between the alarm time and a late (inexact, Doze-delayed) alarm does not cancel it. Such an entry posts
     * now only while it is still stored, that is while its alarm has not fired; otherwise it was delivered already, or
     * it was never scheduled (set after its time), and posting it would show it twice or out of nowhere.
     */
    static Decision onSync(long at, long end, long now, boolean stillStored) {
        Decision d = decide(at, end, now);
        return d == Decision.POST_NOW && !stillStored ? Decision.DROP : d;
    }

    static int requestCode(String entryId) {
        return entryId.hashCode() & 0x7fffffff;
    }

    static boolean validWall(String wall) {
        if (wall == null || !WALL.matcher(wall).matches()) return false;
        try {
            LocalDateTime.parse(wall, STRICT);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    static boolean validId(String id) {
        return id != null && ENTRY_ID.matcher(id).matches();
    }
}
