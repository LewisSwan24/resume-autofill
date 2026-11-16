package app.raf.dev.keyboard;

/**
 * What TalkBack says for an entry row: its label, prefixed with the section's short name inside a repeated
 * section. Never the value: a phone number must not be read aloud on every swipe. The value is offered on demand
 * through the row's 「读出内容」 action instead.
 */
final class A11yText {
    private A11yText() {}

    static String entryDescription(KeyboardData.Section s, KeyboardData.Item i) {
        if (s.a11y == null) return i.label;
        // The prefix is rendered in the UI language, so it tells which separator reads naturally.
        return s.a11y + (hasCjk(s.a11y) ? "，" : ", ") + i.label;
    }

    static boolean hasCjk(String s) {
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x3000 && c <= 0x303f)) return true;
        }
        return false;
    }
}
