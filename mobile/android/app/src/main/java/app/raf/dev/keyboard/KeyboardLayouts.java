package app.raf.dev.keyboard;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The three typing layers. Every row weighs 10, so keys keep their share of any window width. Each key
 * names its spoken description: a string resource for function keys and a few characters, otherwise the character.
 */
final class KeyboardLayouts {
    enum KeyType { CHAR, SHIFT, DELETE, SYMBOLS, MORE, LETTERS, SPACE, ENTER, COMMA, PERIOD, SPACER }

    static final class Key {
        final String text;
        final KeyType type;
        final float weight;
        /** String resource name of the key's description, or null when the character is its own name. */
        final String a11yKey;

        Key(String text, KeyType type, float weight, String a11yKey) {
            this.text = text;
            this.type = type;
            this.weight = weight;
            this.a11yKey = a11yKey;
        }
    }

    private KeyboardLayouts() {}

    private static Key ch(String c) {
        return new Key(c, KeyType.CHAR, 1f, "-".equals(c) ? "kb_hyphen" : null);
    }

    private static List<Key> chars(String... cs) {
        List<Key> row = new ArrayList<>();
        for (String c : cs) row.add(ch(c));
        return row;
    }

    private static List<Key> split(String s) {
        List<Key> row = new ArrayList<>();
        for (int k = 0; k < s.length(); ) {
            int cp = s.codePointAt(k);
            row.add(ch(new String(Character.toChars(cp))));
            k += Character.charCount(cp);
        }
        return row;
    }

    private static Key spacer() {
        return new Key(null, KeyType.SPACER, 0.5f, null);
    }

    private static Key fn(KeyType type, String text, float weight, String a11yKey) {
        return new Key(text, type, weight, a11yKey);
    }

    private static List<Key> bottom(KeyType switchTo, String switchText, String switchKey) {
        return Arrays.asList(
            fn(switchTo, switchText, 1.5f, switchKey),
            fn(KeyType.COMMA, ",", 1f, "kb_comma"),
            fn(KeyType.SPACE, " ", 5f, "kb_space"),
            fn(KeyType.PERIOD, ".", 1f, "kb_period"),
            fn(KeyType.ENTER, null, 1.5f, "kb_enter"));
    }

    private static List<Key> with(Key first, List<Key> middle, Key last) {
        List<Key> row = new ArrayList<>();
        row.add(first);
        row.addAll(middle);
        row.add(last);
        return row;
    }

    private static List<List<Key>> freeze(List<List<Key>> rows) {
        List<List<Key>> out = new ArrayList<>();
        for (List<Key> r : rows) out.add(Collections.unmodifiableList(r));
        return Collections.unmodifiableList(out);
    }

    static List<List<Key>> letters() {
        return freeze(Arrays.asList(
            split("qwertyuiop"),
            with(spacer(), split("asdfghjkl"), spacer()),
            with(fn(KeyType.SHIFT, null, 1.5f, "kb_shift"), split("zxcvbnm"), fn(KeyType.DELETE, null, 1.5f, "kb_delete")),
            bottom(KeyType.SYMBOLS, "123", "kb_symbols")));
    }

    static List<List<Key>> symbols() {
        return freeze(Arrays.asList(
            split("1234567890"),
            chars("@", "#", "$", "%", "&", "-", "+", "(", ")", "/"),
            with(fn(KeyType.MORE, "#+=", 1.5f, "kb_more_symbols"), chars("*", "\"", "'", ":", ";", "!", "?"),
                fn(KeyType.DELETE, null, 1.5f, "kb_delete")),
            bottom(KeyType.LETTERS, "ABC", "kb_letters")));
    }

    static List<List<Key>> moreSymbols() {
        return freeze(Arrays.asList(
            chars("~", "`", "|", "•", "¥", "€", "£", "^", "=", "_"),
            chars("，", "。", "？", "！", "：", "；", "、", "“", "”", "（"),
            with(fn(KeyType.SYMBOLS, "123", 1.5f, "kb_symbols"), chars("）", "《", "》", "…", "—", "[", "]"),
                fn(KeyType.DELETE, null, 1.5f, "kb_delete")),
            bottom(KeyType.LETTERS, "ABC", "kb_letters")));
    }
}
