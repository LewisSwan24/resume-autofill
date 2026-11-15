package app.raf.dev.keyboard;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * KeyboardData v1, the slim projection the app writes for the keyboard. It mirrors the strict zod schema of
 * mobile/app/src/keyboard/keyboardData.ts: unknown keys are rejected, limits are enforced, unknown kinds are dropped.
 * Immutable once parsed. {@link Invalid} carries a constant message and never any data.
 */
public final class KeyboardData {
    public static final class Invalid extends Exception {
        Invalid() {
            super("Bad keyboard data");
        }
    }

    static final List<String> GROUP_IDS = Collections.unmodifiableList(Arrays.asList(
        "basics", "education", "internship", "work", "projects", "campus", "awards",
        "skills", "intention", "links", "about", "other"));
    static final Set<String> KINDS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "email", "phone", "url", "number", "date", "name", "address", "postcode",
        "school", "major", "company", "position", "wechat", "qq")));

    static final int MAX_RESUMES = 20;
    static final int MAX_ITEMS_PER_RESUME = 600;
    static final int MAX_VALUE = 2000;
    static final int MAX_LABEL = 60;
    static final int MAX_SECTION_TITLE = 60;
    static final int MAX_RESUME_TITLE = 40;
    static final int MAX_KINDS = 4;
    /** The native size limit (UTF-8 bytes), the same as KeyboardDataStore.MAX_BYTES and RESUME_KEYBOARD_MAX_BYTES. */
    static final int MAX_JSON_BYTES = 524288;
    /** Ids are short positional or dotted strings; anything longer is not ours. */
    static final int MAX_ID = 120;

    public final int v;
    public final String ui;
    public final String defaultResume;
    public final List<Resume> resumes;

    private KeyboardData(int v, String ui, String defaultResume, List<Resume> resumes) {
        this.v = v;
        this.ui = ui;
        this.defaultResume = defaultResume;
        this.resumes = Collections.unmodifiableList(resumes);
    }

    /** The resume with this id, or null. */
    Resume resume(String id) {
        if (id == null) return null;
        for (Resume r : resumes) if (r.id.equals(id)) return r;
        return null;
    }

    static final class Resume {
        final String id;
        final String title;
        final String lang;
        final String counterpart;
        final List<Group> groups;

        Resume(String id, String title, String lang, String counterpart, List<Group> groups) {
            this.id = id;
            this.title = title;
            this.lang = lang;
            this.counterpart = counterpart;
            this.groups = Collections.unmodifiableList(groups);
        }

        Group group(String id) {
            for (Group g : groups) if (g.id.equals(id)) return g;
            return null;
        }
    }

    static final class Group {
        final String id;
        final String label;
        final List<Section> sections;

        Group(String id, String label, List<Section> sections) {
            this.id = id;
            this.label = label;
            this.sections = Collections.unmodifiableList(sections);
        }
    }

    static final class Section {
        final String title;
        final String a11y;
        final List<Item> items;

        Section(String title, String a11y, List<Item> items) {
            this.title = title;
            this.a11y = a11y;
            this.items = Collections.unmodifiableList(items);
        }
    }

    static final class Item {
        final String id;
        final String label;
        final String value;
        final Set<String> kinds;

        Item(String id, String label, String value, Set<String> kinds) {
            this.id = id;
            this.label = label;
            this.value = value;
            this.kinds = Collections.unmodifiableSet(kinds);
        }
    }

    // ------------------------------------------------------------ parsing

    public static KeyboardData parse(String json) throws Invalid {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_JSON_BYTES) throw new Invalid();
        Object root;
        try {
            root = KbJson.parse(json);
        } catch (KbJson.Error e) {
            throw new Invalid();
        }
        Map<String, Object> o = object(root, "v", "ui", "defaultResume", "resumes");
        Object v = o.get("v");
        if (!(v instanceof Double) || ((Double) v) != 1.0) throw new Invalid();
        String ui = oneOf(o.get("ui"), "zh", "en");
        String defaultResume = string(o.get("defaultResume"), 1, MAX_ID);
        List<Object> list = list(o.get("resumes"), 1, MAX_RESUMES);
        List<Resume> resumes = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Object r : list) {
            Resume resume = resume(r);
            if (!ids.add(resume.id)) throw new Invalid();
            resumes.add(resume);
        }
        if (!ids.contains(defaultResume)) throw new Invalid();
        for (Resume r : resumes) if (r.counterpart != null && !ids.contains(r.counterpart)) throw new Invalid();
        return new KeyboardData(1, ui, defaultResume, resumes);
    }

    private static Resume resume(Object raw) throws Invalid {
        Map<String, Object> o = object(raw, "id", "title", "lang", "counterpart", "groups");
        String id = string(o.get("id"), 1, MAX_ID);
        String title = string(o.get("title"), 1, MAX_RESUME_TITLE);
        String lang = oneOf(o.get("lang"), "zh", "en");
        String counterpart = o.get("counterpart") == null ? null : string(o.get("counterpart"), 1, MAX_ID);
        List<Object> list = list(o.get("groups"), 1, GROUP_IDS.size());
        List<Group> groups = new ArrayList<>();
        Set<String> groupIds = new HashSet<>();
        Set<String> itemIds = new HashSet<>();
        int items = 0;
        for (Object g : list) {
            Group group = group(g);
            if (!groupIds.add(group.id)) throw new Invalid();
            for (Section s : group.sections) {
                for (Item i : s.items) {
                    if (!itemIds.add(i.id)) throw new Invalid();
                    if (++items > MAX_ITEMS_PER_RESUME) throw new Invalid();
                }
            }
            groups.add(group);
        }
        return new Resume(id, title, lang, counterpart, groups);
    }

    private static Group group(Object raw) throws Invalid {
        Map<String, Object> o = object(raw, "id", "label", "sections");
        String id = string(o.get("id"), 1, MAX_ID);
        if (!GROUP_IDS.contains(id)) throw new Invalid();
        String label = string(o.get("label"), 1, MAX_LABEL);
        List<Section> sections = new ArrayList<>();
        for (Object s : list(o.get("sections"), 1, MAX_ITEMS_PER_RESUME)) sections.add(section(s));
        return new Group(id, label, sections);
    }

    private static Section section(Object raw) throws Invalid {
        Map<String, Object> o = object(raw, "title", "a11y", "items");
        String title = o.get("title") == null ? null : string(o.get("title"), 1, MAX_SECTION_TITLE);
        String a11y = o.get("a11y") == null ? null : string(o.get("a11y"), 1, MAX_SECTION_TITLE);
        List<Item> items = new ArrayList<>();
        for (Object i : list(o.get("items"), 1, MAX_ITEMS_PER_RESUME)) items.add(item(i));
        return new Section(title, a11y, items);
    }

    private static Item item(Object raw) throws Invalid {
        Map<String, Object> o = object(raw, "id", "label", "value", "kinds");
        String id = string(o.get("id"), 1, MAX_ID);
        String label = string(o.get("label"), 1, MAX_LABEL);
        String value = string(o.get("value"), 1, MAX_VALUE);
        Set<String> kinds = new LinkedHashSet<>();
        for (Object k : list(o.get("kinds"), 0, MAX_KINDS)) {
            if (!(k instanceof String)) throw new Invalid();
            if (KINDS.contains(k)) kinds.add((String) k); // an unknown kind from a newer app is ignored
        }
        return new Item(id, label, value, kinds);
    }

    // ------------------------------------------------------------ shape helpers

    /** An object with exactly these keys: none missing, none extra. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> object(Object raw, String... keys) throws Invalid {
        if (!(raw instanceof Map)) throw new Invalid();
        Map<String, Object> o = (Map<String, Object>) raw;
        if (o.size() != keys.length) throw new Invalid();
        for (String k : keys) if (!o.containsKey(k)) throw new Invalid();
        return o;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Object raw, int min, int max) throws Invalid {
        if (!(raw instanceof List)) throw new Invalid();
        List<Object> l = (List<Object>) raw;
        if (l.size() < min || l.size() > max) throw new Invalid();
        return l;
    }

    private static String string(Object raw, int min, int max) throws Invalid {
        if (!(raw instanceof String)) throw new Invalid();
        String s = (String) raw;
        if (s.length() < min || s.length() > max) throw new Invalid();
        return s;
    }

    private static String oneOf(Object raw, String a, String b) throws Invalid {
        if (a.equals(raw)) return a;
        if (b.equals(raw)) return b;
        throw new Invalid();
    }
}
