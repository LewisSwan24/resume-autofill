package app.raf.dev.keyboard;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** 显示简历 answers for one field only. */
public class RevealScopeTest {
    @Test
    public void startsHidden() {
        assertFalse(new RevealScope().revealed());
    }

    @Test
    public void revealHoldsUntilTheNextStart() {
        RevealScope scope = new RevealScope();
        scope.reveal();
        assertTrue(scope.revealed());
        scope.onStartInputView();
        assertFalse(scope.revealed());
    }

    @Test
    public void aWebViewFieldWithTheSameTypeDoesNotInheritIt() {
        // A WebView moves to its next input with restartInput: same inputType, same kinds, restarting == true. The
        // service still calls onStartInputView, and that alone must end the reveal.
        RevealScope scope = new RevealScope();
        scope.reveal();
        scope.onStartInputView();
        assertFalse(scope.revealed());
    }

    @Test
    public void finishingInputEndsItToo() {
        RevealScope scope = new RevealScope();
        scope.reveal();
        scope.onFinishInput();
        assertFalse(scope.revealed());
    }
}
