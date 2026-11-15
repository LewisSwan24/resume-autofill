package app.raf.dev.keyboard;

/** What the action key does and says. Constants restated from EditorInfo and InputType. */
final class EnterAction {
    static final int IME_MASK_ACTION = 0xff;
    static final int IME_ACTION_GO = 2;
    static final int IME_ACTION_SEARCH = 3;
    static final int IME_ACTION_SEND = 4;
    static final int IME_ACTION_NEXT = 5;
    static final int IME_ACTION_DONE = 6;
    static final int IME_ACTION_PREVIOUS = 7;
    static final int IME_FLAG_NO_ENTER_ACTION = 0x40000000;

    enum Kind { ACTION, NEWLINE }

    static final class Enter {
        final Kind kind;
        final int actionId;
        /** A string resource name: kb_action_* for an action, kb_enter for a new line. */
        final String labelKey;
        /** For NEWLINE: commit "\n" (multi-line field) rather than send KEYCODE_ENTER. */
        final boolean commitNewline;

        Enter(Kind kind, int actionId, String labelKey, boolean commitNewline) {
            this.kind = kind;
            this.actionId = actionId;
            this.labelKey = labelKey;
            this.commitNewline = commitNewline;
        }
    }

    private EnterAction() {}

    static Enter of(int imeOptions, int inputType) {
        boolean multiLine = (inputType & FieldClassifier.TYPE_MASK_CLASS) == FieldClassifier.TYPE_CLASS_TEXT
            && (inputType & FieldClassifier.TYPE_TEXT_FLAG_MULTI_LINE) != 0;
        if (multiLine || (imeOptions & IME_FLAG_NO_ENTER_ACTION) != 0) {
            return new Enter(Kind.NEWLINE, 0, "kb_enter", multiLine);
        }
        int action = imeOptions & IME_MASK_ACTION;
        String key;
        switch (action) {
            case IME_ACTION_GO: key = "kb_action_go"; break;
            case IME_ACTION_SEARCH: key = "kb_action_search"; break;
            case IME_ACTION_SEND: key = "kb_action_send"; break;
            case IME_ACTION_NEXT: key = "kb_action_next"; break;
            case IME_ACTION_DONE: key = "kb_action_done"; break;
            case IME_ACTION_PREVIOUS: key = "kb_action_previous"; break;
            default: return new Enter(Kind.NEWLINE, 0, "kb_enter", false);
        }
        return new Enter(Kind.ACTION, action, key, false);
    }
}
