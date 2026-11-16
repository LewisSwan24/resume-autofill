package app.raf.dev.keyboard;

import static app.raf.dev.keyboard.KeyboardDataTest.doc;
import static app.raf.dev.keyboard.KeyboardDataTest.enResume;
import static app.raf.dev.keyboard.KeyboardDataTest.parsed;
import static app.raf.dev.keyboard.KeyboardDataTest.sample;
import static app.raf.dev.keyboard.KeyboardDataTest.zhResume;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ResumeChoiceTest {
    private static final KeyboardData TWO = parsed(sample());

    @Test
    public void initialIsTheDefaultResume() {
        assertEquals("r0", ResumeChoice.initial(TWO));
        assertEquals("r1", ResumeChoice.initial(parsed(doc("en", "r1", zhResume("r0", "r1"), enResume("r1", "r0")))));
    }

    @Test
    public void toggleGoesToTheCounterpartOrStays() {
        assertEquals("r1", ResumeChoice.toggleLanguage(TWO, "r0"));
        assertEquals("r0", ResumeChoice.toggleLanguage(TWO, "r1"));
        KeyboardData lone = parsed(doc("zh", "r0", zhResume("r0", null), enResume("r1", null)));
        assertEquals("r0", ResumeChoice.toggleLanguage(lone, "r0"));
    }

    @Test
    public void reconcileKeepsAPresentIdAndFallsBackWhenGone() {
        assertEquals("r1", ResumeChoice.reconcile(TWO, "r1"));
        assertEquals("r0", ResumeChoice.reconcile(TWO, "r4"));
        assertEquals("r0", ResumeChoice.reconcile(TWO, null));
    }
}
