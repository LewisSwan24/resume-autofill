package app.raf.dev.keyboard;

import static app.raf.dev.keyboard.KeyboardDataTest.doc;
import static app.raf.dev.keyboard.KeyboardDataTest.group;
import static app.raf.dev.keyboard.KeyboardDataTest.item;
import static app.raf.dev.keyboard.KeyboardDataTest.parsed;
import static app.raf.dev.keyboard.KeyboardDataTest.resume;
import static app.raf.dev.keyboard.KeyboardDataTest.sample;
import static app.raf.dev.keyboard.KeyboardDataTest.section;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class EntryOrderTest {
    private static final KeyboardData.Resume ZH = parsed(sample()).resume("r0");

    private static List<String> chipIds(EntryOrder.Panel p) {
        List<String> out = new ArrayList<>();
        for (EntryOrder.Chip c : p.strip) out.add(c.id);
        return out;
    }

    private static List<String> itemIds(EntryOrder.Panel p) {
        List<String> out = new ArrayList<>();
        for (EntryOrder.Row r : p.rows) if (r.item != null) out.add(r.item.id);
        return out;
    }

    private static Field field(int inputType, String hint) {
        return FieldClassifier.classify(inputType, 0, hint, null);
    }

    @Test
    public void anEmailFieldStartsOnSuggested() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x21, null), null, "推荐");
        assertEquals(Arrays.asList("suggested", "basics", "education", "other"), chipIds(p));
        assertEquals("推荐", p.strip.get(0).label);
        assertEquals("基本信息", p.strip.get(1).label);
        assertEquals("suggested", p.selected);
        assertEquals(Arrays.asList("contact.0.email", "other.0.email"), itemIds(p));
    }

    @Test
    public void aPhoneFieldPutsPhoneBeforeNumberOnly() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x3, null), null, "推荐");
        assertEquals(Arrays.asList("contact.0.phone", "contact.0.phoneFull", "contact.0.qq"), itemIds(p));
    }

    @Test
    public void aPlainFieldHasNoSuggestedChip() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x1, null), null, "推荐");
        assertEquals(Arrays.asList("basics", "education", "other"), chipIds(p));
        assertEquals("basics", p.selected);
        assertEquals("basics.0.fullName", itemIds(p).get(0));
        assertEquals(5, itemIds(p).size());
    }

    @Test
    public void aChosenGroupIsKeptWhenValidAndFallsBackOtherwise() {
        Field email = field(0x21, null);
        assertEquals("education", EntryOrder.build(ZH, email, "education", "推荐").selected);
        assertEquals("suggested", EntryOrder.build(ZH, email, "links", "推荐").selected);
        assertEquals("basics", EntryOrder.build(ZH, field(0x1, null), "suggested", "推荐").selected);
    }

    @Test
    public void inAGroupMatchingItemsMoveFirstWithinTheirSection() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x1, "学校"), "education", "推荐");
        assertEquals(
            Arrays.asList("education.0.school", "education.0.major", "education.0.period", "education.1.school"),
            itemIds(p));
        // Section headers stay in order, before their items.
        assertTrue(p.rows.get(0).isHeader());
        assertEquals("第一段 · 示例大学", p.rows.get(0).text);
        assertTrue(p.rows.get(4).isHeader());
        assertEquals("第二段 · 示例学院", p.rows.get(4).text);
    }

    @Test
    public void rowsOfARepeatedSectionCarryTheSpokenPrefix() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x1, null), "education", "推荐");
        EntryOrder.Row school = p.rows.get(2);
        assertEquals("学校", school.label);
        assertEquals("第一段，学校", school.a11yLabel);
        assertFalse(school.a11yLabel.contains("示例大学"));
        assertNull(p.rows.get(1).text);
    }

    @Test
    public void suggestedLabelsFromRepeatedSectionsCarryTheSection() {
        EntryOrder.Panel p = EntryOrder.build(ZH, field(0x1, "学校"), null, "推荐");
        assertEquals("suggested", p.selected);
        assertEquals(Arrays.asList("education.0.school", "education.1.school"), itemIds(p));
        assertEquals("学校 · 第一段", p.rows.get(0).label);
        assertEquals("学校 · 第一段", p.rows.get(0).a11yLabel);
        assertEquals("学校 · 第二段", p.rows.get(1).label);
        EntryOrder.Panel mail = EntryOrder.build(ZH, field(0x21, null), null, "推荐");
        assertEquals("邮箱", mail.rows.get(0).label);
        assertEquals("邮箱 · 推荐人第一位", mail.rows.get(1).label);
    }

    @Test
    public void suggestionsAreCappedAt12() {
        String[] items = new String[20];
        for (int i = 0; i < 20; i++) items[i] = item("other.0.e" + i, "邮箱" + i, "a" + i + "@example.com", "email");
        KeyboardData.Resume r = parsed(doc("zh", "r0", resume("r0", "简历", "zh", null,
            group("other", "其他", section(null, null, items))))).resume("r0");
        EntryOrder.Panel p = EntryOrder.build(r, field(0x21, null), null, "推荐");
        assertEquals(12, itemIds(p).size());
        assertEquals("other.0.e0", itemIds(p).get(0));
        assertEquals("other.0.e11", itemIds(p).get(11));
    }
}
