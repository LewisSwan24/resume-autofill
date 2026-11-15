package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import org.junit.Test;

public class FieldClassifierTest {
    // android.text.InputType / EditorInfo values, restated.
    private static final int TEXT = 0x1;
    private static final int NUMBER = 0x2;
    private static final int PHONE = 0x3;
    private static final int DATETIME = 0x4;
    private static final int NO_LEARNING = 0x1000000;

    private static Field c(int inputType) {
        return FieldClassifier.classify(inputType, 0, null, null);
    }

    private static Field hint(String hint) {
        return FieldClassifier.classify(TEXT, 0, hint, null);
    }

    private static Set<String> kinds(String... k) {
        return new HashSet<>(Arrays.asList(k));
    }

    @Test
    public void typeNullIsRaw() {
        Field f = c(0);
        assertTrue(f.raw);
        assertTrue(f.kinds.isEmpty());
        assertFalse(c(TEXT).raw);
    }

    @Test
    public void plainTextHasNoKinds() {
        Field f = c(TEXT);
        assertTrue(f.kinds.isEmpty());
        assertEquals(Field.Sensitivity.NONE, f.sensitivity);
        assertEquals(Field.Layer.LETTERS, f.startLayer);
        assertEquals(Field.NumberRule.NONE, f.numberRule);
        assertFalse(f.multiLine);
    }

    @Test
    public void textVariations() {
        assertEquals(kinds("email"), c(TEXT | 0x20).kinds);
        assertEquals(kinds("email"), c(0xd1).kinds);
        assertEquals(kinds("url"), c(TEXT | 0x10).kinds);
        assertEquals(kinds("name"), c(TEXT | 0x60).kinds);
        assertEquals(kinds("address", "postcode"), c(TEXT | 0x70).kinds);
    }

    @Test
    public void multiLineFlag() {
        assertTrue(c(TEXT | 0x20000).multiLine);
        assertFalse(c(TEXT).multiLine);
    }

    @Test
    public void numberPhoneAndDatetime() {
        Field n = c(NUMBER);
        assertEquals(kinds("number"), n.kinds);
        assertEquals(Field.Layer.SYMBOLS, n.startLayer);
        assertEquals(Field.NumberRule.DIGITS, n.numberRule);
        assertEquals(Field.NumberRule.SIGNED, c(NUMBER | 0x1000).numberRule);
        assertEquals(Field.NumberRule.DECIMAL, c(NUMBER | 0x2000).numberRule);
        assertEquals(Field.NumberRule.SIGNED_DECIMAL, c(NUMBER | 0x1000 | 0x2000).numberRule);
        Field p = c(PHONE);
        assertEquals(kinds("phone"), p.kinds);
        assertEquals(Field.Layer.SYMBOLS, p.startLayer);
        assertEquals(Field.NumberRule.PHONE, p.numberRule);
        Field d = c(DATETIME);
        assertEquals(kinds("date"), d.kinds);
        assertEquals(Field.Layer.SYMBOLS, d.startLayer);
    }

    @Test
    public void passwordsInEveryForm() {
        for (int t : new int[] {0x81, 0x91, 0xe1, 0x12}) {
            assertEquals(Integer.toHexString(t), Field.Sensitivity.PASSWORD, c(t).sensitivity);
        }
    }

    @Test
    public void noLearningFlag() {
        assertEquals(Field.Sensitivity.NO_LEARNING, FieldClassifier.classify(TEXT, NO_LEARNING, null, null).sensitivity);
        assertEquals(Field.Sensitivity.PASSWORD, FieldClassifier.classify(0x81, NO_LEARNING, null, null).sensitivity);
        assertEquals(Field.Sensitivity.SECRET, FieldClassifier.classify(TEXT, NO_LEARNING, "验证码", null).sensitivity);
    }

    @Test
    public void secretWords() {
        assertEquals(Field.Sensitivity.SECRET, hint("请输入短信验证码").sensitivity);
        assertEquals(Field.Sensitivity.SECRET, hint("PIN").sensitivity);
        assertEquals(Field.Sensitivity.SECRET, hint("Enter your OTP").sensitivity);
        assertEquals(Field.Sensitivity.SECRET, hint("CVV").sensitivity);
        assertEquals(Field.Sensitivity.SECRET, hint("Card number").sensitivity);
        assertEquals(Field.Sensitivity.SECRET, FieldClassifier.classify(TEXT, 0, null, "登录密码").sensitivity);
        assertEquals(Field.Sensitivity.NONE, hint("Spinner").sensitivity);
        assertEquals(Field.Sensitivity.NONE, hint("Hotpot").sensitivity);
    }

    @Test
    public void hintAndLabelWordsAddKinds() {
        assertEquals(kinds("phone"), hint("手机号码").kinds);
        assertEquals(kinds("email"), hint("Email address").kinds);
        assertEquals(kinds("school"), FieldClassifier.classify(TEXT, 0, null, "毕业院校").kinds);
        assertEquals(kinds("major"), hint("所学专业").kinds);
        assertEquals(kinds("company"), hint("Employer").kinds);
        assertEquals(kinds("position"), hint("Job title").kinds);
        assertEquals(kinds("wechat"), hint("微信号").kinds);
        assertEquals(kinds("qq"), hint("QQ").kinds);
        assertEquals(Collections.emptySet(), hint("aqqb").kinds);
        assertEquals(kinds("postcode"), hint("ZIP").kinds);
        assertEquals(kinds("name"), hint("Your name").kinds);
        assertEquals(Collections.emptySet(), hint("Username").kinds);
        assertEquals(kinds("email", "url"), FieldClassifier.classify(TEXT | 0x20, 0, "个人主页", null).kinds);
    }

    @Test
    public void longHintsAreCutTo200() {
        StringBuilder pad = new StringBuilder();
        for (int i = 0; i < 200; i++) pad.append('x');
        assertTrue(hint(pad + "邮箱").kinds.isEmpty());
        assertEquals(kinds("email"), hint(pad.substring(0, 190) + "邮箱").kinds);
    }
}
