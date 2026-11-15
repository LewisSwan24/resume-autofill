package app.raf.dev;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.time.Instant;
import java.time.ZoneId;

import org.junit.Test;

public class ReminderMathTest {
    private static final long MIN = 60_000L;
    private static final long HOUR = 60 * MIN;

    private static void fixture(String zone, String wall, String instant) {
        assertEquals(zone + " " + wall, Instant.parse(instant).toEpochMilli(), ReminderMath.toEpoch(wall, ZoneId.of(zone)));
    }

    // The five shared wall-clock fixtures; tracker/model/dates.ts asserts the same.
    @Test
    public void shanghaiIsUtcPlusEight() {
        fixture("Asia/Shanghai", "2026-11-20T09:00", "2026-11-20T01:00:00Z");
    }

    @Test
    public void springForwardGapShiftsLater() {
        fixture("America/New_York", "2026-03-08T02:30", "2026-03-08T07:30:00Z");
    }

    @Test
    public void fallBackOverlapTakesTheEarlierOffset() {
        fixture("America/New_York", "2026-11-01T01:30", "2026-11-01T05:30:00Z");
    }

    @Test
    public void londonSummerTime() {
        fixture("Europe/London", "2026-07-01T00:00", "2026-06-30T23:00:00Z");
    }

    @Test
    public void utcEndOfYear() {
        fixture("UTC", "2026-12-31T23:59", "2026-12-31T23:59:00Z");
    }

    @Test
    public void futureIsScheduled() {
        long now = 1_000_000_000L;
        assertEquals(ReminderMath.Decision.SCHEDULE, ReminderMath.decide(now + 1, now + HOUR, now));
        assertEquals(ReminderMath.Decision.SCHEDULE, ReminderMath.decide(now + 24 * HOUR, now + 30 * HOUR, now));
    }

    @Test
    public void pastWithinSixHoursBeforeEndPostsNow() {
        long now = 1_000_000_000L;
        assertEquals(ReminderMath.Decision.POST_NOW, ReminderMath.decide(now, now + HOUR, now));
        assertEquals(ReminderMath.Decision.POST_NOW, ReminderMath.decide(now - 6 * HOUR, now + 1, now));
    }

    @Test
    public void pastAfterEndIsDropped() {
        long now = 1_000_000_000L;
        assertEquals(ReminderMath.Decision.DROP, ReminderMath.decide(now - HOUR, now, now));
        assertEquals(ReminderMath.Decision.DROP, ReminderMath.decide(now - HOUR, now - MIN, now));
    }

    /** The app keeps a due entry in its sync until it is 6 h old; only the stored one posts. */
    @Test
    public void onSyncPostsADueEntryOnlyWhenItsAlarmHasNotFiredYet() {
        long now = 1_000_000_000L;
        assertEquals(ReminderMath.Decision.POST_NOW, ReminderMath.onSync(now - 3 * MIN, now + HOUR, now, true));
        assertEquals(ReminderMath.Decision.DROP, ReminderMath.onSync(now - 3 * MIN, now + HOUR, now, false));
        assertEquals(ReminderMath.Decision.SCHEDULE, ReminderMath.onSync(now + MIN, now + HOUR, now, false));
        assertEquals(ReminderMath.Decision.SCHEDULE, ReminderMath.onSync(now + MIN, now + HOUR, now, true));
        assertEquals(ReminderMath.Decision.DROP, ReminderMath.onSync(now - 7 * HOUR, now + HOUR, now, true));
    }

    @Test
    public void pastOverSixHoursIsDropped() {
        long now = 1_000_000_000L;
        assertEquals(ReminderMath.Decision.DROP, ReminderMath.decide(now - 6 * HOUR - 1, now + HOUR, now));
    }

    @Test
    public void badWallIsRejected() {
        assertTrue(ReminderMath.validWall("2026-11-20T09:00"));
        for (String bad : new String[] {
                null, "", "2026-11-20", "2026-11-20 09:00", "2026-11-20T9:00", "2026-11-20T09:00:00",
                "2026-13-01T09:00", "2026-02-30T09:00", "2026-11-20T24:00", "x2026-11-20T09:00"}) {
            assertFalse(String.valueOf(bad), ReminderMath.validWall(bad));
        }
        try {
            ReminderMath.toEpoch("2026-11-20 09:00", ZoneId.of("UTC"));
            fail("a bad wall throws");
        } catch (IllegalArgumentException expected) {
            // fine
        }
        assertTrue(ReminderMath.validId("rec-1A:d0"));
        assertTrue(ReminderMath.validId("rec-1A:d1"));
        for (String bad : new String[] {null, "", "rec", "rec:d2", ":d0", "a b:d0", "rec:d0x"}) {
            assertFalse(String.valueOf(bad), ReminderMath.validId(bad));
        }
    }

    @Test
    public void requestCodeIsStableAndDiffersForD0AndD1() {
        assertEquals(ReminderMath.requestCode("rec-1:d0"), ReminderMath.requestCode("rec-1:d0"));
        assertEquals("rec-1:d0".hashCode() & 0x7fffffff, ReminderMath.requestCode("rec-1:d0"));
        assertNotEquals(ReminderMath.requestCode("rec-1:d0"), ReminderMath.requestCode("rec-1:d1"));
        assertTrue(ReminderMath.requestCode("anything-at-all:d1") >= 0);
    }
}
