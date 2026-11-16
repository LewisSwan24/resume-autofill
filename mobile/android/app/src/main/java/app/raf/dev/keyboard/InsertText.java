package app.raf.dev.keyboard;

/** The text an entry puts into a field: line breaks, number rules and a length cap. */
final class InsertText {
    static final int MAX = 2000;

    private InsertText() {}

    static String forField(String value, Field field) {
        if (value == null || value.trim().isEmpty()) return "";
        String text = field.multiLine ? value : value.replaceAll("(\\r?\\n)+", " ");
        switch (field.numberRule) {
            case DIGITS: text = keep(text, false, false); break;
            case SIGNED: text = keep(text, true, false); break;
            case DECIMAL: text = keep(text, false, true); break;
            case SIGNED_DECIMAL: text = keep(text, true, true); break;
            case PHONE: text = phone(text); break;
            default: break;
        }
        if (text.isEmpty()) return "";
        if (text.length() > MAX) {
            int end = Character.isHighSurrogate(text.charAt(MAX - 1)) ? MAX - 1 : MAX;
            text = text.substring(0, end);
        }
        return text;
    }

    /** Digits, with an optional leading minus and the first decimal point. Empty when there is no digit at all. */
    private static String keep(String text, boolean signed, boolean decimal) {
        StringBuilder out = new StringBuilder();
        boolean digit = false;
        boolean point = false;
        for (int k = 0; k < text.length(); k++) {
            char c = text.charAt(k);
            if (c >= '0' && c <= '9') {
                out.append(c);
                digit = true;
            } else if (decimal && c == '.' && !point) {
                out.append(c);
                point = true;
            }
        }
        if (!digit) return "";
        if (signed && text.trim().startsWith("-")) out.insert(0, '-');
        return out.toString();
    }

    private static String phone(String text) {
        StringBuilder out = new StringBuilder();
        boolean digit = false;
        for (int k = 0; k < text.length(); k++) {
            char c = text.charAt(k);
            if (c >= '0' && c <= '9') digit = true;
            if ((c >= '0' && c <= '9') || c == '+' || c == ' ' || c == '-' || c == '(' || c == ')') out.append(c);
        }
        return digit ? out.toString().trim() : "";
    }
}
