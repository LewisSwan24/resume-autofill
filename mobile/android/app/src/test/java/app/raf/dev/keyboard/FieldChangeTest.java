package app.raf.dev.keyboard;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * A WebView moves focus between its inputs with restartInput, so onStartInputView reports restarting == true for a
 * different field. The strip, typing choice and reveal reset whenever the field is really a new one.
 */
public class FieldChangeTest {
    private static final int TEXT = 0x1;
    private static final int WEB_TEXT = 0x8c0a1;
    private static final int WEB_EMAIL = 0x800d1;
    private static final int PHONE = 0x3;

    private static Field f(int type, String hint) {
        return FieldClassifier.classify(type, 0, hint, null);
    }

    @Test
    public void notRestartingIsAlwaysANewField() {
        assertTrue(FieldChange.isNew(false, WEB_TEXT, f(WEB_TEXT, null), WEB_TEXT, f(WEB_TEXT, null)));
    }

    @Test
    public void theFirstFieldIsNew() {
        assertTrue(FieldChange.isNew(true, 0, null, WEB_TEXT, f(WEB_TEXT, null)));
    }

    @Test
    public void restartingOnTheSameKindOfFieldKeepsTheChoice() {
        assertFalse(FieldChange.isNew(true, WEB_TEXT, f(WEB_TEXT, null), WEB_TEXT, f(WEB_TEXT, null)));
    }

    @Test
    public void restartingOnAnotherInputTypeIsANewField() {
        assertTrue(FieldChange.isNew(true, WEB_TEXT, f(WEB_TEXT, null), PHONE, f(PHONE, null)));
        assertTrue(FieldChange.isNew(true, WEB_TEXT, f(WEB_TEXT, null), WEB_EMAIL, f(WEB_EMAIL, null)));
    }

    @Test
    public void restartingWithOtherKindsOrSensitivityIsANewField() {
        assertTrue(FieldChange.isNew(true, TEXT, f(TEXT, "学校"), TEXT, f(TEXT, "公司")));
        assertTrue(FieldChange.isNew(true, TEXT, f(TEXT, "姓名"), TEXT, f(TEXT, "验证码")));
    }
}
