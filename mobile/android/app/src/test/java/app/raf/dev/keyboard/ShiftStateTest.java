package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ShiftStateTest {
    @Test
    public void tapGivesOneCapitalThenOff() {
        ShiftState s = new ShiftState();
        assertEquals(ShiftState.State.OFF, s.state());
        assertFalse(s.upper());
        s.tap(1000);
        assertEquals(ShiftState.State.ONCE, s.state());
        assertTrue(s.upper());
        s.afterLetter();
        assertEquals(ShiftState.State.OFF, s.state());
    }

    @Test
    public void doubleTapWithin300msLocks() {
        ShiftState s = new ShiftState();
        s.tap(1000);
        s.tap(1299);
        assertEquals(ShiftState.State.LOCKED, s.state());
        s.afterLetter();
        assertEquals(ShiftState.State.LOCKED, s.state());
        s.tap(5000);
        assertEquals(ShiftState.State.OFF, s.state());
    }

    @Test
    public void aSlowSecondTapTurnsShiftOff() {
        ShiftState s = new ShiftState();
        s.tap(1000);
        s.tap(1301);
        assertEquals(ShiftState.State.OFF, s.state());
    }

    @Test
    public void autoCapsOnlyLiftsOff() {
        ShiftState s = new ShiftState();
        s.autoCaps(false);
        assertEquals(ShiftState.State.OFF, s.state());
        s.autoCaps(true);
        assertEquals(ShiftState.State.ONCE, s.state());
        // A tap on an auto-capital turns it off, not into caps lock.
        s.tap(10_000);
        assertEquals(ShiftState.State.OFF, s.state());
        s.tap(20_000);
        s.tap(20_100);
        assertEquals(ShiftState.State.LOCKED, s.state());
        s.autoCaps(true);
        assertEquals(ShiftState.State.LOCKED, s.state());
    }
}
