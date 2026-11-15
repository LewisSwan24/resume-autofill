package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;

public class KeyboardLayoutsTest {
    private static Set<String> stringNames() throws Exception {
        File xml = new File(KeyboardDataFixtureTest.repoRoot(), "mobile/android/app/src/main/res/values/strings.xml");
        String text = new String(Files.readAllBytes(xml.toPath()), StandardCharsets.UTF_8);
        Set<String> names = new HashSet<>();
        Matcher m = Pattern.compile("<string\\s+name=\"([^\"]+)\"").matcher(text);
        while (m.find()) names.add(m.group(1));
        return names;
    }

    private static List<List<List<KeyboardLayouts.Key>>> all() {
        return Arrays.asList(KeyboardLayouts.letters(), KeyboardLayouts.symbols(), KeyboardLayouts.moreSymbols());
    }

    private static int keys(List<KeyboardLayouts.Key> row) {
        int n = 0;
        for (KeyboardLayouts.Key k : row) if (k.type != KeyboardLayouts.KeyType.SPACER) n++;
        return n;
    }

    private static String chars(List<KeyboardLayouts.Key> row) {
        StringBuilder s = new StringBuilder();
        for (KeyboardLayouts.Key k : row) if (k.type == KeyboardLayouts.KeyType.CHAR) s.append(k.text);
        return s.toString();
    }

    @Test
    public void letterRows() {
        List<List<KeyboardLayouts.Key>> rows = KeyboardLayouts.letters();
        assertEquals(4, rows.size());
        assertEquals(10, keys(rows.get(0)));
        assertEquals("qwertyuiop", chars(rows.get(0)));
        assertEquals(9, keys(rows.get(1)));
        assertEquals("asdfghjkl", chars(rows.get(1)));
        assertEquals(KeyboardLayouts.KeyType.SPACER, rows.get(1).get(0).type);
        assertEquals(0.5f, rows.get(1).get(0).weight, 0.0001f);
        assertEquals(9, keys(rows.get(2)));
        assertEquals(KeyboardLayouts.KeyType.SHIFT, rows.get(2).get(0).type);
        assertEquals(KeyboardLayouts.KeyType.DELETE, rows.get(2).get(8).type);
        assertEquals("zxcvbnm", chars(rows.get(2)));
        List<KeyboardLayouts.KeyType> bottom = new ArrayList<>();
        for (KeyboardLayouts.Key k : rows.get(3)) bottom.add(k.type);
        assertEquals(Arrays.asList(KeyboardLayouts.KeyType.SYMBOLS, KeyboardLayouts.KeyType.COMMA, KeyboardLayouts.KeyType.SPACE,
            KeyboardLayouts.KeyType.PERIOD, KeyboardLayouts.KeyType.ENTER), bottom);
    }

    @Test
    public void everyRowWeighsTen() {
        for (List<List<KeyboardLayouts.Key>> layer : all()) {
            assertEquals(4, layer.size());
            for (List<KeyboardLayouts.Key> row : layer) {
                float sum = 0;
                for (KeyboardLayouts.Key k : row) sum += k.weight;
                assertEquals(10f, sum, 0.0001f);
            }
        }
    }

    @Test
    public void everyKeyHasAnAccessibleName() throws Exception {
        Set<String> names = stringNames();
        for (List<List<KeyboardLayouts.Key>> layer : all()) {
            for (List<KeyboardLayouts.Key> row : layer) {
                for (KeyboardLayouts.Key k : row) {
                    if (k.type == KeyboardLayouts.KeyType.SPACER) continue;
                    if (k.type == KeyboardLayouts.KeyType.CHAR && k.a11yKey == null) {
                        // A character key is named by its character.
                        assertNotNull(k.text);
                        assertFalse(k.text.isEmpty());
                        continue;
                    }
                    assertNotNull(k.type + " " + k.text, k.a11yKey);
                    assertTrue(k.a11yKey + " missing from strings.xml", names.contains(k.a11yKey));
                }
            }
        }
    }

    @Test
    public void namedCharacters() {
        KeyboardLayouts.Key hyphen = null;
        for (KeyboardLayouts.Key k : KeyboardLayouts.symbols().get(1)) if ("-".equals(k.text)) hyphen = k;
        assertNotNull(hyphen);
        assertEquals("kb_hyphen", hyphen.a11yKey);
        List<KeyboardLayouts.Key> bottom = KeyboardLayouts.letters().get(3);
        assertEquals("kb_comma", bottom.get(1).a11yKey);
        assertEquals(",", bottom.get(1).text);
        assertEquals("kb_space", bottom.get(2).a11yKey);
        assertEquals("kb_period", bottom.get(3).a11yKey);
        assertEquals(".", bottom.get(3).text);
        assertEquals("kb_shift", KeyboardLayouts.letters().get(2).get(0).a11yKey);
        assertEquals("kb_delete", KeyboardLayouts.letters().get(2).get(8).a11yKey);
        assertEquals("kb_symbols", bottom.get(0).a11yKey);
        assertEquals("kb_more_symbols", KeyboardLayouts.symbols().get(2).get(0).a11yKey);
        assertEquals("kb_letters", KeyboardLayouts.symbols().get(3).get(0).a11yKey);
    }

    @Test
    public void symbolLayers() {
        assertEquals("1234567890", chars(KeyboardLayouts.symbols().get(0)));
        assertEquals("@#$%&-+()/", chars(KeyboardLayouts.symbols().get(1)));
        StringBuilder more = new StringBuilder();
        for (List<KeyboardLayouts.Key> row : KeyboardLayouts.moreSymbols()) more.append(chars(row));
        for (String p : new String[] {"，", "。", "？", "！", "：", "；", "、", "“", "”", "（", "）", "《", "》", "…", "—"}) {
            assertTrue(p, more.indexOf(p) >= 0);
        }
        assertEquals(KeyboardLayouts.KeyType.SYMBOLS, KeyboardLayouts.moreSymbols().get(2).get(0).type);
    }
}
