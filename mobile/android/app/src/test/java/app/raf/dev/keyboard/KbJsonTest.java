package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

public class KbJsonTest {
    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) {
        assertTrue(o instanceof LinkedHashMap);
        return (Map<String, Object>) o;
    }

    private static void rejects(String json) {
        try {
            KbJson.parse(json);
            fail("accepted: " + (json.length() > 40 ? json.substring(0, 40) + "…" : json));
        } catch (KbJson.Error expected) {
            // a constant message, never the input
        }
    }

    @Test
    public void parsesNestedObjectsAndArraysInOrder() throws Exception {
        Map<String, Object> m = obj(KbJson.parse(" {\"b\": [1, {\"c\": []}], \"a\": {} } "));
        assertEquals(Arrays.asList("b", "a"), Arrays.asList(m.keySet().toArray()));
        List<?> b = (List<?>) m.get("b");
        assertEquals(1.0, b.get(0));
        assertEquals(0, ((List<?>) obj(b.get(1)).get("c")).size());
        assertEquals(0, obj(m.get("a")).size());
    }

    @Test
    public void decodesStringEscapesAndSurrogatePairs() throws Exception {
        Object s = KbJson.parse("\"q\\\" b\\\\ s\\/ \\b\\f\\n\\r\\t \\u4e2d \\ud83d\\ude00\"");
        assertEquals("q\" b\\ s/ \b\f\n\r\t 中 \uD83D\uDE00", s);
        assertEquals("中😀", KbJson.parse("\"中😀\""));
    }

    @Test
    public void parsesNumbers() throws Exception {
        assertEquals(42.0, KbJson.parse("42"));
        assertEquals(-7.0, KbJson.parse("-7"));
        assertEquals(3.25, KbJson.parse("3.25"));
        assertEquals(1.5e3, KbJson.parse("1.5e3"));
        assertEquals(-2e-2, KbJson.parse("-2E-2"));
        rejects("01");
        rejects("1.");
        rejects("-");
        rejects("+1");
    }

    @Test
    public void parsesLiterals() throws Exception {
        assertEquals(Boolean.TRUE, KbJson.parse("true"));
        assertEquals(Boolean.FALSE, KbJson.parse("false"));
        assertNull(KbJson.parse("null"));
        Map<String, Object> m = obj(KbJson.parse("{\"x\":null}"));
        assertTrue(m.containsKey("x"));
    }

    @Test
    public void rejectsBadInput() {
        rejects("{} x");
        rejects("[1,]");
        rejects("{\"a\":1,}");
        rejects("\"open");
        rejects("\"bad \\x escape\"");
        rejects("\"\\u12\"");
        rejects("\"raw\ncontrol\"");
        rejects("{\"a\" 1}");
        rejects("{a:1}");
        rejects("");
        rejects("tru");
    }

    @Test
    public void rejectsDepthOver32() throws Exception {
        StringBuilder ok = new StringBuilder();
        for (int i = 0; i < 32; i++) ok.append('[');
        for (int i = 0; i < 32; i++) ok.append(']');
        KbJson.parse(ok.toString());
        rejects("[" + ok + "]");
    }

    @Test
    public void rejectsOverLongInput() throws Exception {
        StringBuilder s = new StringBuilder("\"");
        while (s.length() < 1_048_575) s.append('a');
        s.append('"');
        assertEquals(1_048_576, s.length());
        KbJson.parse(s.toString());
        rejects(s.toString() + " ");
    }
}
