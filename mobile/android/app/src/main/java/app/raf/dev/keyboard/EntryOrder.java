package app.raf.dev.keyboard;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * The resume panel's strip and rows for one resume and one field. Items whose kinds match the field
 * come first: in the 推荐 chip across the whole resume, and at the front of their own section in a regular group.
 */
final class EntryOrder {
    static final String SUGGESTED = "suggested";
    static final int MAX_SUGGESTED = 12;

    static final class Chip {
        final String id;
        final String label;

        Chip(String id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    /** A section header (text set, item null) or an entry (item set). */
    static final class Row {
        final String text;
        final KeyboardData.Item item;
        final KeyboardData.Section section;
        final String label;
        final String a11yLabel;

        private Row(String text, KeyboardData.Item item, KeyboardData.Section section, String label, String a11yLabel) {
            this.text = text;
            this.item = item;
            this.section = section;
            this.label = label;
            this.a11yLabel = a11yLabel;
        }

        static Row header(String text) {
            return new Row(text, null, null, null, null);
        }

        boolean isHeader() {
            return item == null;
        }
    }

    static final class Panel {
        final List<Chip> strip;
        final String selected;
        final List<Row> rows;

        Panel(List<Chip> strip, String selected, List<Row> rows) {
            this.strip = Collections.unmodifiableList(strip);
            this.selected = selected;
            this.rows = Collections.unmodifiableList(rows);
        }
    }

    private EntryOrder() {}

    static Panel build(KeyboardData.Resume r, Field field, String selectedGroupId, String suggestedLabel) {
        List<Row> suggested = suggestions(r, field.kinds);
        List<Chip> strip = new ArrayList<>();
        if (!suggested.isEmpty()) strip.add(new Chip(SUGGESTED, suggestedLabel));
        for (KeyboardData.Group g : r.groups) strip.add(new Chip(g.id, g.label));

        String selected = null;
        for (Chip c : strip) if (c.id.equals(selectedGroupId)) selected = c.id;
        if (selected == null) selected = strip.isEmpty() ? null : strip.get(0).id;

        if (SUGGESTED.equals(selected)) return new Panel(strip, selected, suggested);
        List<Row> rows = new ArrayList<>();
        KeyboardData.Group group = selected == null ? null : r.group(selected);
        if (group != null) {
            for (KeyboardData.Section s : group.sections) {
                if (s.title != null) rows.add(Row.header(s.title));
                for (int rank = 0; rank <= 2; rank++) {
                    for (KeyboardData.Item i : s.items) {
                        if (rank(i, field.kinds) == rank) {
                            rows.add(new Row(null, i, s, i.label, A11yText.entryDescription(s, i)));
                        }
                    }
                }
            }
        }
        return new Panel(strip, selected, rows);
    }

    /** 0 = matches a kind of the field; 1 = a number-only item for a phone field; 2 = the rest. */
    private static int rank(KeyboardData.Item i, Set<String> kinds) {
        for (String k : i.kinds) if (kinds.contains(k)) return 0;
        if (kinds.contains("phone") && i.kinds.contains("number")) return 1;
        return 2;
    }

    private static List<Row> suggestions(KeyboardData.Resume r, Set<String> kinds) {
        List<Row> out = new ArrayList<>();
        if (kinds.isEmpty()) return out;
        for (int rank = 0; rank <= 1; rank++) {
            for (KeyboardData.Group g : r.groups) {
                for (KeyboardData.Section s : g.sections) {
                    for (KeyboardData.Item i : s.items) {
                        if (out.size() >= MAX_SUGGESTED) return out;
                        if (rank(i, kinds) != rank) continue;
                        String label = s.a11y == null ? i.label : i.label + " · " + s.a11y;
                        out.add(new Row(null, i, s, label, label));
                    }
                }
            }
        }
        return out;
    }
}
