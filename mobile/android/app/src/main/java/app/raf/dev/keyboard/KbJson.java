package app.raf.dev.keyboard;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A minimal, strict JSON reader for the keyboard's own data (RFC 8259). Objects become LinkedHashMap (key order kept),
 * arrays ArrayList, numbers Double. Not org.json: that is a stub in local unit tests, and a library would be a new
 * dependency. Errors carry a constant message, never the input.
 */
final class KbJson {
    static final int MAX_DEPTH = 32;
    static final int MAX_LENGTH = 1_048_576;

    static final class Error extends Exception {
        Error() {
            super("Bad JSON");
        }
    }

    private final String s;
    private int i;

    private KbJson(String s) {
        this.s = s;
    }

    static Object parse(String json) throws Error {
        if (json == null || json.length() > MAX_LENGTH) throw new Error();
        KbJson p = new KbJson(json);
        p.space();
        Object value = p.value(0);
        p.space();
        if (p.i != json.length()) throw new Error();
        return value;
    }

    private void space() {
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') return;
            i++;
        }
    }

    private char peek() throws Error {
        if (i >= s.length()) throw new Error();
        return s.charAt(i);
    }

    private Object value(int depth) throws Error {
        char c = peek();
        switch (c) {
            case '{': return object(depth + 1);
            case '[': return array(depth + 1);
            case '"': return string();
            case 't': return literal("true", Boolean.TRUE);
            case 'f': return literal("false", Boolean.FALSE);
            case 'n': return literal("null", null);
            default:
                if (c == '-' || (c >= '0' && c <= '9')) return number();
                throw new Error();
        }
    }

    private Object literal(String word, Object result) throws Error {
        if (!s.startsWith(word, i)) throw new Error();
        i += word.length();
        return result;
    }

    private Map<String, Object> object(int depth) throws Error {
        if (depth > MAX_DEPTH) throw new Error();
        Map<String, Object> out = new LinkedHashMap<>();
        i++; // {
        space();
        if (peek() == '}') {
            i++;
            return out;
        }
        while (true) {
            space();
            if (peek() != '"') throw new Error();
            String key = string();
            space();
            if (peek() != ':') throw new Error();
            i++;
            space();
            if (out.containsKey(key)) throw new Error();
            out.put(key, value(depth));
            space();
            char c = peek();
            i++;
            if (c == '}') return out;
            if (c != ',') throw new Error();
        }
    }

    private List<Object> array(int depth) throws Error {
        if (depth > MAX_DEPTH) throw new Error();
        List<Object> out = new ArrayList<>();
        i++; // [
        space();
        if (peek() == ']') {
            i++;
            return out;
        }
        while (true) {
            space();
            out.add(value(depth));
            space();
            char c = peek();
            i++;
            if (c == ']') return out;
            if (c != ',') throw new Error();
        }
    }

    private String string() throws Error {
        i++; // opening quote
        StringBuilder out = new StringBuilder();
        while (true) {
            char c = peek();
            i++;
            if (c == '"') return out.toString();
            if (c < 0x20) throw new Error();
            if (c != '\\') {
                out.append(c);
                continue;
            }
            char e = peek();
            i++;
            switch (e) {
                case '"': out.append('"'); break;
                case '\\': out.append('\\'); break;
                case '/': out.append('/'); break;
                case 'b': out.append('\b'); break;
                case 'f': out.append('\f'); break;
                case 'n': out.append('\n'); break;
                case 'r': out.append('\r'); break;
                case 't': out.append('\t'); break;
                case 'u': out.append(hex4()); break;
                default: throw new Error();
            }
        }
    }

    private char hex4() throws Error {
        if (i + 4 > s.length()) throw new Error();
        int v = 0;
        for (int k = 0; k < 4; k++) {
            int d = Character.digit(s.charAt(i + k), 16);
            if (d < 0) throw new Error();
            v = v * 16 + d;
        }
        i += 4;
        return (char) v; // surrogate pairs arrive as two escapes and join in the StringBuilder
    }

    private Double number() throws Error {
        int start = i;
        if (peek() == '-') i++;
        char c = peek();
        if (c == '0') {
            i++;
        } else if (c >= '1' && c <= '9') {
            digits();
        } else {
            throw new Error();
        }
        if (i < s.length() && s.charAt(i) == '.') {
            i++;
            if (i >= s.length() || !isDigit(s.charAt(i))) throw new Error();
            digits();
        }
        if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
            i++;
            if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
            if (i >= s.length() || !isDigit(s.charAt(i))) throw new Error();
            digits();
        }
        try {
            return Double.valueOf(s.substring(start, i));
        } catch (NumberFormatException e) {
            throw new Error();
        }
    }

    private void digits() {
        while (i < s.length() && isDigit(s.charAt(i))) i++;
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }
}
