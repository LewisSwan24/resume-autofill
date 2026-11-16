package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class InsertTextTest {
    private static final Field SINGLE = FieldClassifier.classify(0x1, 0, null, null);
    private static final Field MULTI = FieldClassifier.classify(0x1 | 0x20000, 0, null, null);
    private static final Field DIGITS = FieldClassifier.classify(0x2, 0, null, null);
    private static final Field SIGNED = FieldClassifier.classify(0x2 | 0x1000, 0, null, null);
    private static final Field DECIMAL = FieldClassifier.classify(0x2 | 0x2000, 0, null, null);
    private static final Field SIGNED_DECIMAL = FieldClassifier.classify(0x2 | 0x3000, 0, null, null);
    private static final Field PHONE = FieldClassifier.classify(0x3, 0, null, null);

    @Test
    public void blankInsertsNothing() {
        assertEquals("", InsertText.forField(null, SINGLE));
        assertEquals("", InsertText.forField("  \n ", SINGLE));
    }

    @Test
    public void lineBreaksBecomeSpacesInSingleLineFields() {
        assertEquals("第一行 第二行 第三行", InsertText.forField("第一行\r\n\n第二行\n第三行", SINGLE));
        assertEquals("第一行\r\n\n第二行", InsertText.forField("第一行\r\n\n第二行", MULTI));
    }

    @Test
    public void numberRules() {
        assertEquals("8613800000000", InsertText.forField("+86 138-0000-0000", DIGITS));
        assertEquals("3.840", InsertText.forField("3.8/4.0", DECIMAL));
        assertEquals("-12", InsertText.forField("-12", SIGNED));
        assertEquals("12", InsertText.forField("1-2", SIGNED));
        assertEquals("-1.5", InsertText.forField("-1.5", SIGNED_DECIMAL));
        assertEquals("+86 138-0000-0000", InsertText.forField("+86 138-0000-0000", PHONE));
        assertEquals("(010) 1234", InsertText.forField("电话 (010) 1234", PHONE));
    }

    @Test
    public void textWithNoDigitsInsertsNothingIntoANumberField() {
        assertEquals("", InsertText.forField("本科", DIGITS));
        assertEquals("", InsertText.forField("本科", PHONE));
        assertEquals("", InsertText.forField("-", SIGNED));
    }

    @Test
    public void cutAt2000WithoutSplittingASurrogatePair() {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 1999; i++) s.append('a');
        s.append("😀"); // 2001 UTF-16 units, the pair straddling the cut
        String out = InsertText.forField(s.toString(), SINGLE);
        assertEquals(1999, out.length());
        StringBuilder t = new StringBuilder();
        for (int i = 0; i < 2001; i++) t.append('b');
        assertEquals(2000, InsertText.forField(t.toString(), SINGLE).length());
    }
}
