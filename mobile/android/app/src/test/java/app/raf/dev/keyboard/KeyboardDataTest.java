package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.Collections;

import org.junit.Test;

public class KeyboardDataTest {
    // ------------------------------------------------------------ shared builders (used by other keyboard tests)

    /** Single quotes become double quotes, so the documents below stay readable. */
    static String j(String s) {
        return s.replace('\'', '"');
    }

    static String item(String id, String label, String value, String... kinds) {
        StringBuilder k = new StringBuilder();
        for (String kind : kinds) k.append(k.length() == 0 ? "" : ",").append('\'').append(kind).append('\'');
        return j("{'id':'" + id + "','label':'" + label + "','value':'" + value + "','kinds':[" + k + "]}");
    }

    static String section(String title, String a11y, String... items) {
        String t = title == null ? "null" : "'" + title + "'";
        String a = a11y == null ? "null" : "'" + a11y + "'";
        return j("{'title':" + t + ",'a11y':" + a + ",'items':[") + String.join(",", items) + "]}";
    }

    static String group(String id, String label, String... sections) {
        return j("{'id':'" + id + "','label':'" + label + "','sections':[") + String.join(",", sections) + "]}";
    }

    static String resume(String id, String title, String lang, String counterpart, String... groups) {
        String c = counterpart == null ? "null" : "'" + counterpart + "'";
        return j("{'id':'" + id + "','title':'" + title + "','lang':'" + lang + "','counterpart':" + c + ",'groups':[")
            + String.join(",", groups) + "]}";
    }

    static String doc(String ui, String defaultResume, String... resumes) {
        return j("{'v':1,'ui':'" + ui + "','defaultResume':'" + defaultResume + "','resumes':[") + String.join(",", resumes) + "]}";
    }

    /** The zh resume most tests use: basics (phone, phoneFull, email, QQ), two education entries and a referee. */
    static String zhResume(String id, String counterpart) {
        return resume(id, "我的中文简历", "zh", counterpart,
            group("basics", "基本信息", section(null, null,
                item("basics.0.fullName", "姓名", "张三", "name"),
                item("contact.0.phone", "手机", "13800000000", "phone", "number"),
                item("contact.0.phoneFull", "手机（带区号）", "+86 13800000000", "phone"),
                item("contact.0.email", "邮箱", "zhangsan@example.com", "email"),
                item("contact.0.qq", "QQ", "10000", "qq", "number"))),
            group("education", "教育",
                section("第一段 · 示例大学", "第一段",
                    item("education.0.major", "专业", "计算机科学与技术", "major"),
                    item("education.0.school", "学校", "示例大学", "school"),
                    item("education.0.period", "起止时间", "2022.09-2026.06")),
                section("第二段 · 示例学院", "第二段",
                    item("education.1.school", "学校", "示例学院", "school"))),
            group("other", "其他",
                section("推荐人 · 第一位", "推荐人第一位",
                    item("other.0.name", "姓名", "李四", "name"),
                    item("other.0.email", "邮箱", "lisi@example.com", "email"))));
    }

    static String enResume(String id, String counterpart) {
        return resume(id, "My English resume", "en", counterpart,
            group("basics", "Basics", section(null, null, item("basics.0.fullName", "Name", "San Zhang", "name"))));
    }

    static String sample() {
        return doc("zh", "r0", zhResume("r0", "r1"), enResume("r1", "r0"));
    }

    static KeyboardData parsed(String json) {
        try {
            return KeyboardData.parse(json);
        } catch (KeyboardData.Invalid e) {
            throw new AssertionError("rejected a valid document");
        }
    }

    private static void rejects(String why, String json) {
        try {
            KeyboardData.parse(json);
            fail("accepted: " + why);
        } catch (KeyboardData.Invalid expected) {
            // constant reason, no data
        }
    }

    private static String repeat(char c, int n) {
        return String.join("", Collections.nCopies(n, String.valueOf(c)));
    }

    // ------------------------------------------------------------ tests

    @Test
    public void parsesAMinimalDocument() {
        String one = doc("en", "r0", resume("r0", "CV", "en", null,
            group("links", "Links", section(null, null, item("links.0.github", "GitHub", "github.com/example")))));
        KeyboardData d = parsed(one);
        assertEquals(1, d.v);
        assertEquals("en", d.ui);
        assertEquals("r0", d.defaultResume);
        assertEquals(1, d.resumes.size());
        KeyboardData.Resume r = d.resumes.get(0);
        assertEquals("CV", r.title);
        assertNull(r.counterpart);
        assertEquals("links", r.groups.get(0).id);
        KeyboardData.Section s = r.groups.get(0).sections.get(0);
        assertNull(s.title);
        assertNull(s.a11y);
        assertEquals("github.com/example", s.items.get(0).value);
        assertTrue(s.items.get(0).kinds.isEmpty());
    }

    @Test
    public void parsesTheSampleWithKindsAndSections() {
        KeyboardData d = parsed(sample());
        assertEquals(2, d.resumes.size());
        assertEquals("r1", d.resume("r0").counterpart);
        assertEquals("r0", d.resume("r1").counterpart);
        assertNull(d.resume("r9"));
        KeyboardData.Item phone = d.resume("r0").groups.get(0).sections.get(0).items.get(1);
        assertEquals("手机", phone.label);
        assertTrue(phone.kinds.contains("phone") && phone.kinds.contains("number"));
        assertEquals("第一段", d.resume("r0").groups.get(1).sections.get(0).a11y);
    }

    @Test
    public void rejectsWrongVersionAndLanguage() {
        rejects("v 2", sample().replace("\"v\":1", "\"v\":2"));
        rejects("v 1.5", sample().replace("\"v\":1", "\"v\":1.5"));
        rejects("ui fr", sample().replace("\"ui\":\"zh\"", "\"ui\":\"fr\""));
        rejects("lang fr", sample().replace("\"lang\":\"en\"", "\"lang\":\"fr\""));
        rejects("not an object", "[]");
        rejects("not json", "{");
    }

    @Test
    public void rejectsResumeCounts() {
        rejects("0 resumes", j("{'v':1,'ui':'zh','defaultResume':'r0','resumes':[]}"));
        String[] twenty = new String[20];
        for (int i = 0; i < 20; i++) twenty[i] = enResume("r" + i, null);
        parsed(doc("en", "r0", twenty));
        String[] many = new String[21];
        for (int i = 0; i < 21; i++) many[i] = enResume("r" + i, null);
        rejects("21 resumes", doc("en", "r0", many));
        rejects("duplicate resume ids", doc("en", "r0", enResume("r0", null), enResume("r0", null)));
    }

    @Test
    public void rejectsDanglingReferences() {
        rejects("default names nobody", doc("zh", "r7", zhResume("r0", "r1"), enResume("r1", "r0")));
        rejects("counterpart names nobody", doc("zh", "r0", zhResume("r0", "r5"), enResume("r1", "r0")));
    }

    @Test
    public void rejectsBadGroupsSectionsAndItems() {
        rejects("unknown group", sample().replace("\"id\":\"education\"", "\"id\":\"hobbies\""));
        rejects("empty section", doc("en", "r0", resume("r0", "CV", "en", null, group("basics", "Basics", section(null, null)))));
        rejects("group without sections", doc("en", "r0", resume("r0", "CV", "en", null, group("basics", "Basics"))));
        rejects("resume without groups", doc("en", "r0", resume("r0", "CV", "en", null)));
        rejects("empty value", sample().replace("\"value\":\"张三\"", "\"value\":\"\""));
        rejects("value is a number", sample().replace("\"value\":\"张三\"", "\"value\":3"));
        rejects("duplicate item id", sample().replace("\"id\":\"education.1.school\"", "\"id\":\"education.0.school\""));
        rejects("duplicate group", doc("en", "r0", resume("r0", "CV", "en", null,
            group("basics", "A", section(null, null, item("a", "A", "x"))),
            group("basics", "B", section(null, null, item("b", "B", "y"))))));
    }

    @Test
    public void enforcesLimits() {
        parsed(sample().replace("\"label\":\"姓名\"", "\"label\":\"" + repeat('名', 60) + "\""));
        rejects("label over 60", sample().replace("\"label\":\"姓名\"", "\"label\":\"" + repeat('名', 61) + "\""));
        parsed(sample().replace("\"value\":\"张三\"", "\"value\":\"" + repeat('三', 2000) + "\""));
        rejects("value over 2000", sample().replace("\"value\":\"张三\"", "\"value\":\"" + repeat('三', 2001) + "\""));
        rejects("title over 40", sample().replace("\"title\":\"我的中文简历\"", "\"title\":\"" + repeat('简', 41) + "\""));
        rejects("section title over 60", sample().replace("第一段 · 示例大学", repeat('段', 61)));
        rejects("five kinds", sample().replace("\"kinds\":[\"name\"]", "\"kinds\":[\"name\",\"email\",\"phone\",\"url\",\"date\"]"));
        String[] items = new String[601];
        for (int i = 0; i < 601; i++) items[i] = item("other.0.i" + i, "L", "v");
        rejects("601 items", doc("en", "r0", resume("r0", "CV", "en", null, group("other", "Other", section(null, null, items)))));
        String[] six = new String[600];
        System.arraycopy(items, 0, six, 0, 600);
        parsed(doc("en", "r0", resume("r0", "CV", "en", null, group("other", "Other", section(null, null, six)))));
    }

    @Test
    public void rejectsUnknownKeysAtEveryLevel() {
        rejects("top-level key", sample().replace("{\"v\":1,", "{\"v\":1,\"extra\":true,"));
        rejects("resume key", sample().replace("\"lang\":\"en\",", "\"lang\":\"en\",\"photo\":\"x\","));
        rejects("item key", sample().replace("\"value\":\"张三\",", "\"value\":\"张三\",\"secret\":\"x\","));
        rejects("missing key", sample().replace("\"counterpart\":\"r1\",", ""));
    }

    @Test
    public void ignoresAnUnknownKind() {
        KeyboardData d = parsed(sample().replace("\"kinds\":[\"name\"]", "\"kinds\":[\"name\",\"telepathy\"]"));
        KeyboardData.Item name = d.resume("r0").groups.get(0).sections.get(0).items.get(0);
        assertEquals(Collections.singleton("name"), name.kinds);
    }
}
