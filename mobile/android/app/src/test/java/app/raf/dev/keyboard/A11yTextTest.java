package app.raf.dev.keyboard;

import static app.raf.dev.keyboard.KeyboardDataTest.doc;
import static app.raf.dev.keyboard.KeyboardDataTest.group;
import static app.raf.dev.keyboard.KeyboardDataTest.item;
import static app.raf.dev.keyboard.KeyboardDataTest.parsed;
import static app.raf.dev.keyboard.KeyboardDataTest.resume;
import static app.raf.dev.keyboard.KeyboardDataTest.section;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

public class A11yTextTest {
    private static final String PHONE = "13800000000";
    private static final KeyboardData.Resume R = parsed(doc("zh", "r0",
        resume("r0", "简历", "zh", null,
            group("basics", "基本信息", section(null, null, item("contact.0.phone", "手机", PHONE, "phone"))),
            group("education", "教育", section("第一段 · 示例大学", "第一段",
                item("education.0.school", "学校", "示例大学", "school"),
                item("education.0.tel", "学校电话", PHONE, "phone")))),
        resume("r1", "CV", "en", null,
            group("education", "Education", section("Entry 1 · Example University", "Entry 1",
                item("education.0.school", "School", "Example University", "school"))))))
        .resume("r0");

    @Test
    public void aSingleSectionItemIsItsLabel() {
        KeyboardData.Section s = R.groups.get(0).sections.get(0);
        assertEquals("手机", A11yText.entryDescription(s, s.items.get(0)));
    }

    @Test
    public void aRepeatedItemIsPrefixedWithItsSection() {
        KeyboardData.Section s = R.groups.get(1).sections.get(0);
        assertEquals("第一段，学校", A11yText.entryDescription(s, s.items.get(0)));
    }

    @Test
    public void englishUsesACommaAndSpace() {
        KeyboardData d = parsed(doc("en", "r0", resume("r0", "CV", "en", null,
            group("education", "Education", section("Entry 1 · Example University", "Entry 1",
                item("education.0.school", "School", "Example University", "school"))))));
        KeyboardData.Section s = d.resume("r0").groups.get(0).sections.get(0);
        assertEquals("Entry 1, School", A11yText.entryDescription(s, s.items.get(0)));
    }

    @Test
    public void neverContainsTheValue() {
        for (KeyboardData.Group g : R.groups) {
            for (KeyboardData.Section s : g.sections) {
                for (KeyboardData.Item i : s.items) {
                    String said = A11yText.entryDescription(s, i);
                    assertFalse(said, said.contains(PHONE));
                    assertFalse(said, said.contains(i.value));
                }
            }
        }
    }
}
