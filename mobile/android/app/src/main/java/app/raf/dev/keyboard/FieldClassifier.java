package app.raf.dev.keyboard;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Reads the focused field's EditorInfo numbers, hint and label into a {@link Field}. The hint and label are
 * matched in memory only: never stored, never logged. Constants are restated from android.text.InputType and
 * android.view.inputmethod.EditorInfo so this class stays plain Java.
 */
final class FieldClassifier {
    // android.text.InputType
    static final int TYPE_MASK_CLASS = 0x0000000f;
    static final int TYPE_MASK_VARIATION = 0x00000ff0;
    static final int TYPE_NULL = 0;
    static final int TYPE_CLASS_TEXT = 0x1;
    static final int TYPE_CLASS_NUMBER = 0x2;
    static final int TYPE_CLASS_PHONE = 0x3;
    static final int TYPE_CLASS_DATETIME = 0x4;
    static final int TYPE_TEXT_VARIATION_URI = 0x10;
    static final int TYPE_TEXT_VARIATION_EMAIL_ADDRESS = 0x20;
    static final int TYPE_TEXT_VARIATION_PERSON_NAME = 0x60;
    static final int TYPE_TEXT_VARIATION_POSTAL_ADDRESS = 0x70;
    static final int TYPE_TEXT_VARIATION_PASSWORD = 0x80;
    static final int TYPE_TEXT_VARIATION_VISIBLE_PASSWORD = 0x90;
    static final int TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS = 0xd0;
    static final int TYPE_TEXT_VARIATION_WEB_PASSWORD = 0xe0;
    static final int TYPE_TEXT_FLAG_MULTI_LINE = 0x20000;
    static final int TYPE_NUMBER_VARIATION_PASSWORD = 0x10;
    static final int TYPE_NUMBER_FLAG_SIGNED = 0x1000;
    static final int TYPE_NUMBER_FLAG_DECIMAL = 0x2000;
    // android.view.inputmethod.EditorInfo
    static final int IME_FLAG_NO_PERSONALIZED_LEARNING = 0x1000000;

    static final int MAX_WORDS = 200;

    /** Words that make a field look like it wants a secret; checked first. "*" marks a whole-word match. */
    private static final String[] SECRET = {
        "密码", "口令", "验证码", "校验码", "动态码", "安全码", "短信码", "支付", "银行卡", "卡号",
        "password", "passcode", "passwd", "*pin", "*otp", "verification code", "security code", "cvv", "cvc", "card number",
    };

    /** kind, then its words. */
    private static final String[][] KIND_WORDS = {
        {"email", "邮箱", "电子邮件", "邮件", "email", "e-mail"},
        {"phone", "手机", "电话", "联系方式", "phone", "mobile", "tel"},
        {"name", "姓名", "名字", "full name", "your name"},
        {"school", "学校", "院校", "毕业院校", "school", "university", "college"},
        {"major", "专业", "major"},
        {"company", "公司", "单位", "company", "employer"},
        {"position", "职位", "岗位", "position", "job title"},
        {"wechat", "微信", "wechat"},
        {"qq", "*qq"},
        {"date", "日期", "时间", "年月", "date"},
        {"url", "链接", "网址", "主页", "url", "link", "website"},
        {"address", "地址", "address"},
        {"postcode", "邮编", "postcode", "zip"},
    };

    private static final String[] EMAIL_ADDRESS = {"email address", "e-mail address", "mail address", "邮箱地址", "邮件地址"};

    private FieldClassifier() {}

    static Field classify(int inputType, int imeOptions, String hint, String label) {
        Set<String> kinds = new LinkedHashSet<>();
        Field.Sensitivity sensitivity = Field.Sensitivity.NONE;
        boolean multiLine = false;
        Field.Layer layer = Field.Layer.LETTERS;
        Field.NumberRule numberRule = Field.NumberRule.NONE;

        int cls = inputType & TYPE_MASK_CLASS;
        int variation = inputType & TYPE_MASK_VARIATION;
        if (inputType == TYPE_NULL) {
            return new Field(Collections.<String>emptySet(), Field.Sensitivity.NONE, false, Field.Layer.LETTERS, Field.NumberRule.NONE, true);
        }
        switch (cls) {
            case TYPE_CLASS_TEXT:
                if (variation == TYPE_TEXT_VARIATION_EMAIL_ADDRESS || variation == TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS) kinds.add("email");
                else if (variation == TYPE_TEXT_VARIATION_URI) kinds.add("url");
                else if (variation == TYPE_TEXT_VARIATION_PERSON_NAME) kinds.add("name");
                else if (variation == TYPE_TEXT_VARIATION_POSTAL_ADDRESS) {
                    kinds.add("address");
                    kinds.add("postcode");
                } else if (variation == TYPE_TEXT_VARIATION_PASSWORD || variation == TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    || variation == TYPE_TEXT_VARIATION_WEB_PASSWORD) {
                    sensitivity = Field.Sensitivity.PASSWORD;
                }
                multiLine = (inputType & TYPE_TEXT_FLAG_MULTI_LINE) != 0;
                break;
            case TYPE_CLASS_NUMBER:
                kinds.add("number");
                layer = Field.Layer.SYMBOLS;
                boolean signed = (inputType & TYPE_NUMBER_FLAG_SIGNED) != 0;
                boolean decimal = (inputType & TYPE_NUMBER_FLAG_DECIMAL) != 0;
                numberRule = signed && decimal ? Field.NumberRule.SIGNED_DECIMAL
                    : signed ? Field.NumberRule.SIGNED
                    : decimal ? Field.NumberRule.DECIMAL
                    : Field.NumberRule.DIGITS;
                if (variation == TYPE_NUMBER_VARIATION_PASSWORD) sensitivity = Field.Sensitivity.PASSWORD;
                break;
            case TYPE_CLASS_PHONE:
                kinds.add("phone");
                layer = Field.Layer.SYMBOLS;
                numberRule = Field.NumberRule.PHONE;
                break;
            case TYPE_CLASS_DATETIME:
                kinds.add("date");
                layer = Field.Layer.SYMBOLS;
                break;
            default:
                break;
        }

        String words = (cut(hint) + " " + cut(label)).toLowerCase(Locale.ROOT);
        if (sensitivity == Field.Sensitivity.NONE && matchesAny(words, SECRET)) sensitivity = Field.Sensitivity.SECRET;
        // "Email address" / 邮箱地址 asks for an email, not a postal address.
        String forAddress = words;
        for (String phrase : EMAIL_ADDRESS) forAddress = forAddress.replace(phrase, " ");
        for (String[] row : KIND_WORDS) {
            String text = row[0].equals("address") ? forAddress : words;
            for (int k = 1; k < row.length; k++) {
                if (matches(text, row[k])) {
                    kinds.add(row[0]);
                    break;
                }
            }
        }
        if (sensitivity == Field.Sensitivity.NONE && (imeOptions & IME_FLAG_NO_PERSONALIZED_LEARNING) != 0) {
            sensitivity = Field.Sensitivity.NO_LEARNING;
        }
        return new Field(kinds, sensitivity, multiLine, layer, numberRule, false);
    }

    private static String cut(String s) {
        if (s == null) return "";
        return s.length() > MAX_WORDS ? s.substring(0, MAX_WORDS) : s;
    }

    private static boolean matchesAny(String words, String[] list) {
        for (String w : list) if (matches(words, w)) return true;
        return false;
    }

    /** A substring match, or a whole-word match (ASCII letters and digits as word characters) when marked with "*". */
    static boolean matches(String words, String word) {
        if (!word.startsWith("*")) return words.contains(word);
        String w = word.substring(1);
        int from = 0;
        while (true) {
            int at = words.indexOf(w, from);
            if (at < 0) return false;
            int end = at + w.length();
            boolean before = at == 0 || !isWordChar(words.charAt(at - 1));
            boolean after = end == words.length() || !isWordChar(words.charAt(end));
            if (before && after) return true;
            from = at + 1;
        }
    }

    private static boolean isWordChar(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    }
}
