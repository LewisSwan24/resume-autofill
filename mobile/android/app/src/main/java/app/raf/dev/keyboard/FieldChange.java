package app.raf.dev.keyboard;

/**
 * Whether onStartInputView is on a new field (see FieldChangeTest). Android's restarting flag is not enough: a WebView
 * moves focus between its inputs with restartInput, so a different field arrives with restarting == true.
 */
public final class FieldChange {
    private FieldChange() {}

    public static boolean isNew(boolean restarting, int prevInputType, Field prev, int inputType, Field next) {
        if (!restarting || prev == null || next == null) return true;
        return prevInputType != inputType
            || prev.sensitivity != next.sensitivity
            || prev.raw != next.raw
            || !prev.kinds.equals(next.kinds);
    }
}
