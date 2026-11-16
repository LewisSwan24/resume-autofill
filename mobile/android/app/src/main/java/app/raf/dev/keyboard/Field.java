package app.raf.dev.keyboard;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/** What the keyboard knows about the focused field: kinds for ordering, how sensitive it is, and how to type into it. */
public final class Field {
    public enum Sensitivity { NONE, PASSWORD, SECRET, NO_LEARNING }

    public enum Layer { LETTERS, SYMBOLS }

    public enum NumberRule { NONE, DIGITS, SIGNED, DECIMAL, SIGNED_DECIMAL, PHONE }

    public final Set<String> kinds;
    public final Sensitivity sensitivity;
    public final boolean multiLine;
    public final Layer startLayer;
    public final NumberRule numberRule;
    public final boolean raw;

    Field(Set<String> kinds, Sensitivity sensitivity, boolean multiLine, Layer startLayer, NumberRule numberRule, boolean raw) {
        this.kinds = Collections.unmodifiableSet(new LinkedHashSet<>(kinds));
        this.sensitivity = sensitivity;
        this.multiLine = multiLine;
        this.startLayer = startLayer;
        this.numberRule = numberRule;
        this.raw = raw;
    }
}
