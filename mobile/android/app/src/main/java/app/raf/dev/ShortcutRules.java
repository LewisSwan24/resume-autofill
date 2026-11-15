package app.raf.dev;

import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Pure rules for pinned launcher shortcuts. A pinned shortcut "app-<recordId>" is disabled when its record is gone and
 * enabled again when it comes back (undo, import); the launcher keeps pinned shortcuts, the app can only switch them.
 * Shortcuts that are not ours ("paste", "demo", "last-application", or an id that does not match its record) are left
 * alone.
 */
final class ShortcutRules {
    static final String DYNAMIC_ID = "last-application";
    static final String PINNED_PREFIX = "app-";
    static final int SHORT_LABEL = 10;
    static final int LONG_LABEL = 25;

    static final class Plan {
        final Set<String> disable;
        final Set<String> enable;

        Plan(Set<String> disable, Set<String> enable) {
            this.disable = disable;
            this.enable = enable;
        }
    }

    private ShortcutRules() {}

    static String pinnedId(String recordId) {
        return PINNED_PREFIX + recordId;
    }

    /** @param pinned shortcut id → the record id its intent carries (null when none) */
    static Plan plan(Map<String, String> pinned, Set<String> liveRecordIds) {
        Set<String> disable = new TreeSet<>();
        Set<String> enable = new TreeSet<>();
        for (Map.Entry<String, String> e : pinned.entrySet()) {
            String id = e.getKey();
            String recordId = e.getValue();
            if (id == null || recordId == null || !id.equals(pinnedId(recordId))) continue;
            if (liveRecordIds.contains(recordId)) enable.add(id);
            else disable.add(id);
        }
        return new Plan(disable, enable);
    }

    /** At most {@code codePoints} code points, so a surrogate pair is never split. */
    static String clamp(String label, int codePoints) {
        if (label == null) return "";
        return IncomingIntents.cutCodePoints(label, codePoints);
    }
}
