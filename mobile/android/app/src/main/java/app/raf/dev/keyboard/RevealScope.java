package app.raf.dev.keyboard;

/**
 * Whether the person tapped 显示简历 in a field that asks for no personalised learning (incognito tabs and the like).
 * The answer is for that one field: every start of the input view ends it, because a WebView moves to its next input
 * with restartInput and the same input type, so nothing in EditorInfo tells two such fields apart. Showing the keyboard
 * again on the same field asks again, which errs on the private side.
 */
final class RevealScope {
    private boolean revealed;

    boolean revealed() {
        return revealed;
    }

    void reveal() {
        revealed = true;
    }

    void onStartInputView() {
        revealed = false;
    }

    void onFinishInput() {
        revealed = false;
    }
}
