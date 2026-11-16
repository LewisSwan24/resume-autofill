package app.raf.dev.keyboard;

/** Picks what the keyboard shows in a field. The first rule that matches wins. */
final class KeyboardGate {
    enum DataState { LOADING, ABSENT, READY, ERROR }

    enum Kind { RESUME, TYPING_ONLY, HIDDEN_CAN_REVEAL, EMPTY, ERROR, LOADING }

    enum Reason { LOCKED, PASSWORD, SECRET, NO_LEARNING, RAW }

    static final class Mode {
        final Kind kind;
        final Reason reason;

        Mode(Kind kind, Reason reason) {
            this.kind = kind;
            this.reason = reason;
        }

        /** Whether the resume panel area (entries, empty, loading or error) is what this mode shows. */
        boolean resumeArea() {
            return kind == Kind.RESUME || kind == Kind.EMPTY || kind == Kind.ERROR || kind == Kind.LOADING;
        }
    }

    private KeyboardGate() {}

    static Mode decide(boolean locked, Field field, DataState data, boolean revealed) {
        if (locked) return new Mode(Kind.TYPING_ONLY, Reason.LOCKED);
        if (field.raw) return new Mode(Kind.TYPING_ONLY, Reason.RAW);
        if (field.sensitivity == Field.Sensitivity.PASSWORD) return new Mode(Kind.TYPING_ONLY, Reason.PASSWORD);
        if (field.sensitivity == Field.Sensitivity.SECRET) return new Mode(Kind.TYPING_ONLY, Reason.SECRET);
        if (field.sensitivity == Field.Sensitivity.NO_LEARNING && !revealed) return new Mode(Kind.HIDDEN_CAN_REVEAL, Reason.NO_LEARNING);
        switch (data) {
            case LOADING: return new Mode(Kind.LOADING, null);
            case ABSENT: return new Mode(Kind.EMPTY, null);
            case ERROR: return new Mode(Kind.ERROR, null);
            default: return new Mode(Kind.RESUME, null);
        }
    }
}
