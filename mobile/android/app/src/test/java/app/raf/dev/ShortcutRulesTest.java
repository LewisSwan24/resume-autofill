package app.raf.dev;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class ShortcutRulesTest {
    private static Set<String> set(String... xs) {
        return new HashSet<>(Arrays.asList(xs));
    }

    private static Map<String, String> pinned(String... recordIds) {
        Map<String, String> map = new HashMap<>();
        for (String id : recordIds) map.put("app-" + id, id);
        return map;
    }

    @Test
    public void pinnedForDeletedRecordIsDisabled() {
        ShortcutRules.Plan plan = ShortcutRules.plan(pinned("r1", "r2"), set("r2"));
        assertEquals(set("app-r1"), plan.disable);
        assertEquals(set("app-r2"), plan.enable);
    }

    @Test
    public void pinnedForRestoredRecordIsEnabled() {
        ShortcutRules.Plan gone = ShortcutRules.plan(pinned("r1"), Collections.emptySet());
        assertEquals(set("app-r1"), gone.disable);
        ShortcutRules.Plan back = ShortcutRules.plan(pinned("r1"), set("r1"));
        assertEquals(set("app-r1"), back.enable);
        assertEquals(Collections.emptySet(), back.disable);
    }

    @Test
    public void unrelatedPinnedShortcutsAreLeftAlone() {
        Map<String, String> map = pinned("r1");
        map.put("paste", null);
        map.put("demo", null);
        map.put("last-application", "r9");
        map.put("app-r3", "r4"); // id and record disagree: not ours to judge
        ShortcutRules.Plan plan = ShortcutRules.plan(map, set("r4"));
        assertEquals(set("app-r1"), plan.disable);
        assertEquals(Collections.emptySet(), plan.enable);
    }

    @Test
    public void labelsAreClampedByCodePoints() {
        String emoji = new String(Character.toChars(0x1F600));
        assertEquals("示例科技有限公司研发", ShortcutRules.clamp("示例科技有限公司研发中心", 10));
        assertEquals("短", ShortcutRules.clamp("短", 10));
        String clamped = ShortcutRules.clamp(emoji + emoji + emoji, 2);
        assertEquals(emoji + emoji, clamped);
        assertEquals("", ShortcutRules.clamp(null, 10));
    }
}
