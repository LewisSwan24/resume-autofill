package app.raf.dev;

import java.util.HashMap;
import java.util.Map;

/**
 * The frames of the page WebView that have checked in through the bridge. Each reply proxy gets a frame key the
 * first time it posts; keys are never reused, so a late reply can never reach a different frame. The generation
 * goes up when the main frame starts a new document, which drops every frame of the old one.
 *
 * Takes no Android types (Sink wraps JavaScriptReplyProxy), so it unit-tests on the JVM. UI thread only.
 */
final class FrameRegistry {
    static final int MAX_FRAMES = 32;

    /** Where a command for one frame goes. Equality decides "same frame". */
    interface Sink {
        void post(String data);
    }

    private final Map<Sink, Integer> keys = new HashMap<>();
    private final Map<Integer, Sink> sinks = new HashMap<>();
    private int generation = 1;
    private int nextKey = 1;

    int generation() {
        return generation;
    }

    int newGeneration() {
        keys.clear();
        sinks.clear();
        generation += 1;
        return generation;
    }

    /** The key of this sink in the current generation, registering it if new; -1 when 32 frames are already in. */
    int keyFor(Sink sink) {
        Integer known = keys.get(sink);
        if (known != null) return known;
        if (keys.size() >= MAX_FRAMES) return -1;
        int key = nextKey++;
        keys.put(sink, key);
        sinks.put(key, sink);
        return key;
    }

    /** Removes the sink's frame; returns its key, or -1 when it was not registered. */
    int remove(Sink sink) {
        Integer key = keys.remove(sink);
        if (key == null) return -1;
        sinks.remove(key);
        return key;
    }

    /** Delivers data to one frame of the given generation; false when the generation is old or the frame unknown. */
    boolean post(int generation, int frame, String data) {
        if (generation != this.generation) return false;
        Sink sink = sinks.get(frame);
        if (sink == null) return false;
        try {
            sink.post(data);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    int size() {
        return keys.size();
    }

    void clear() {
        keys.clear();
        sinks.clear();
    }
}
