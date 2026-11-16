package app.raf.dev.keyboard;

/**
 * Shift: one tap gives one capital, a second tap within 300 ms locks, a tap while locked turns it off.
 * Auto-capitalisation only lifts OFF to ONCE; it uses the field's caps-mode flags, never its text.
 */
final class ShiftState {
    enum State { OFF, ONCE, LOCKED }

    static final long DOUBLE_TAP_MS = 300;

    private State state = State.OFF;
    /** When the tap that made ONCE happened; -1 when ONCE came from auto-caps (a later tap then turns it off). */
    private long onceTapAt = -1;

    State state() {
        return state;
    }

    boolean upper() {
        return state != State.OFF;
    }

    void tap(long nowMs) {
        switch (state) {
            case OFF:
                state = State.ONCE;
                onceTapAt = nowMs;
                break;
            case ONCE:
                state = onceTapAt >= 0 && nowMs - onceTapAt <= DOUBLE_TAP_MS ? State.LOCKED : State.OFF;
                onceTapAt = -1;
                break;
            default:
                state = State.OFF;
                onceTapAt = -1;
                break;
        }
    }

    void afterLetter() {
        if (state == State.ONCE) {
            state = State.OFF;
            onceTapAt = -1;
        }
    }

    void autoCaps(boolean capsMode) {
        if (capsMode && state == State.OFF) {
            state = State.ONCE;
            onceTapAt = -1;
        }
    }

    void reset() {
        state = State.OFF;
        onceTapAt = -1;
    }
}
