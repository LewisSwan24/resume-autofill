package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class EnterActionTest {
    private static final int TEXT = 0x1;
    private static final int MULTI = 0x1 | 0x20000;

    private static void action(int ime, int id, String key) {
        EnterAction.Enter e = EnterAction.of(ime, TEXT);
        assertEquals(EnterAction.Kind.ACTION, e.kind);
        assertEquals(id, e.actionId);
        assertEquals(key, e.labelKey);
    }

    @Test
    public void eachAction() {
        action(2, 2, "kb_action_go");
        action(3, 3, "kb_action_search");
        action(4, 4, "kb_action_send");
        action(5, 5, "kb_action_next");
        action(6, 6, "kb_action_done");
        action(7, 7, "kb_action_previous");
        // Flags in the upper bits do not change the action.
        action(0x02000000 | 5, 5, "kb_action_next");
    }

    @Test
    public void noEnterActionMeansNewline() {
        EnterAction.Enter e = EnterAction.of(0x40000000 | 6, TEXT);
        assertEquals(EnterAction.Kind.NEWLINE, e.kind);
        assertEquals("kb_enter", e.labelKey);
        assertFalse(e.commitNewline);
    }

    @Test
    public void multiLineCommitsANewline() {
        EnterAction.Enter e = EnterAction.of(6, MULTI);
        assertEquals(EnterAction.Kind.NEWLINE, e.kind);
        assertTrue(e.commitNewline);
    }

    @Test
    public void unspecifiedAndNoneSendEnter() {
        for (int ime : new int[] {0, 1}) {
            EnterAction.Enter e = EnterAction.of(ime, TEXT);
            assertEquals(EnterAction.Kind.NEWLINE, e.kind);
            assertFalse(e.commitNewline);
            assertEquals("kb_enter", e.labelKey);
        }
    }
}
