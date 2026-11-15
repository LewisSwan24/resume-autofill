package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class KeyboardGateTest {
    private static final Field PLAIN = FieldClassifier.classify(0x1, 0, null, null);
    private static final Field RAW = FieldClassifier.classify(0, 0, null, null);
    private static final Field PASSWORD = FieldClassifier.classify(0x81, 0, null, null);
    private static final Field SECRET = FieldClassifier.classify(0x1, 0, "验证码", null);
    private static final Field NO_LEARNING = FieldClassifier.classify(0x1, 0x1000000, null, null);

    private static void is(KeyboardGate.Kind kind, KeyboardGate.Reason reason, KeyboardGate.Mode m) {
        assertEquals(kind, m.kind);
        assertEquals(reason, m.reason);
    }

    @Test
    public void lockedComesFirstEvenBeforePasswordAndRaw() {
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.LOCKED,
            KeyboardGate.decide(true, PLAIN, KeyboardGate.DataState.READY, false));
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.LOCKED,
            KeyboardGate.decide(true, PASSWORD, KeyboardGate.DataState.READY, true));
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.LOCKED,
            KeyboardGate.decide(true, RAW, KeyboardGate.DataState.ABSENT, false));
    }

    @Test
    public void rawBeforePassword() {
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.RAW,
            KeyboardGate.decide(false, RAW, KeyboardGate.DataState.READY, false));
    }

    @Test
    public void passwordAndSecretAreTypingOnlyEvenWhenRevealed() {
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.PASSWORD,
            KeyboardGate.decide(false, PASSWORD, KeyboardGate.DataState.READY, true));
        is(KeyboardGate.Kind.TYPING_ONLY, KeyboardGate.Reason.SECRET,
            KeyboardGate.decide(false, SECRET, KeyboardGate.DataState.READY, true));
    }

    @Test
    public void noLearningHidesUntilRevealed() {
        is(KeyboardGate.Kind.HIDDEN_CAN_REVEAL, KeyboardGate.Reason.NO_LEARNING,
            KeyboardGate.decide(false, NO_LEARNING, KeyboardGate.DataState.READY, false));
        is(KeyboardGate.Kind.RESUME, null, KeyboardGate.decide(false, NO_LEARNING, KeyboardGate.DataState.READY, true));
        // Hidden comes before the data state: nothing about the file is shown either.
        is(KeyboardGate.Kind.HIDDEN_CAN_REVEAL, KeyboardGate.Reason.NO_LEARNING,
            KeyboardGate.decide(false, NO_LEARNING, KeyboardGate.DataState.ABSENT, false));
    }

    @Test
    public void dataStates() {
        is(KeyboardGate.Kind.LOADING, null, KeyboardGate.decide(false, PLAIN, KeyboardGate.DataState.LOADING, false));
        is(KeyboardGate.Kind.EMPTY, null, KeyboardGate.decide(false, PLAIN, KeyboardGate.DataState.ABSENT, false));
        is(KeyboardGate.Kind.ERROR, null, KeyboardGate.decide(false, PLAIN, KeyboardGate.DataState.ERROR, false));
        KeyboardGate.Mode ok = KeyboardGate.decide(false, PLAIN, KeyboardGate.DataState.READY, false);
        is(KeyboardGate.Kind.RESUME, null, ok);
        assertNull(ok.reason);
    }
}
