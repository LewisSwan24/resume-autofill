package app.raf.dev;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

public class FrameRegistryTest {
    static final class FakeSink implements FrameRegistry.Sink {
        final List<String> got = new ArrayList<>();

        @Override
        public void post(String data) {
            got.add(data);
        }
    }

    @Test
    public void sameSinkKeepsItsKey() {
        FrameRegistry reg = new FrameRegistry();
        FakeSink a = new FakeSink();
        FakeSink b = new FakeSink();
        int ka = reg.keyFor(a);
        assertTrue(ka > 0);
        assertEquals(ka, reg.keyFor(a));
        int kb = reg.keyFor(b);
        assertTrue(kb > 0);
        assertNotEquals(ka, kb);
    }

    @Test
    public void newGenerationClearsAllFramesAndNeverReusesKeys() {
        FrameRegistry reg = new FrameRegistry();
        FakeSink a = new FakeSink();
        int first = reg.keyFor(a);
        int g1 = reg.generation();
        reg.newGeneration();
        assertEquals(g1 + 1, reg.generation());
        assertEquals(0, reg.size());
        assertFalse(reg.post(reg.generation(), first, "x"));
        int again = reg.keyFor(a);
        assertNotEquals(first, again);
    }

    @Test
    public void the33rdFrameIsRefused() {
        FrameRegistry reg = new FrameRegistry();
        assertEquals(32, FrameRegistry.MAX_FRAMES);
        for (int i = 0; i < FrameRegistry.MAX_FRAMES; i++) assertTrue(reg.keyFor(new FakeSink()) > 0);
        assertEquals(-1, reg.keyFor(new FakeSink()));
        assertEquals(32, reg.size());
    }

    @Test
    public void removeFreesASlot() {
        FrameRegistry reg = new FrameRegistry();
        FakeSink first = new FakeSink();
        int key = reg.keyFor(first);
        for (int i = 1; i < FrameRegistry.MAX_FRAMES; i++) reg.keyFor(new FakeSink());
        assertEquals(key, reg.remove(first));
        assertEquals(-1, reg.remove(first));
        assertFalse(reg.post(reg.generation(), key, "x"));
        assertTrue(reg.keyFor(new FakeSink()) > 0);
    }

    @Test
    public void postReachesOnlyARegisteredFrameOfTheCurrentGeneration() {
        FrameRegistry reg = new FrameRegistry();
        FakeSink a = new FakeSink();
        int key = reg.keyFor(a);
        int gen = reg.generation();
        assertTrue(reg.post(gen, key, "one"));
        assertFalse(reg.post(gen, key + 100, "two"));
        reg.newGeneration();
        assertFalse(reg.post(gen, key, "three"));
        assertEquals(1, a.got.size());
        assertEquals("one", a.got.get(0));
    }

    @Test
    public void aSinkThatThrowsIsNotDelivered() {
        FrameRegistry reg = new FrameRegistry();
        int key = reg.keyFor(data -> {
            throw new IllegalStateException("gone");
        });
        assertFalse(reg.post(reg.generation(), key, "x"));
    }
}
