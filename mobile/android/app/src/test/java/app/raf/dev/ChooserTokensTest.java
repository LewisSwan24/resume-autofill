package app.raf.dev;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ChooserTokensTest {
    private final ChooserStreamProvider.Tokens tokens = new ChooserStreamProvider.Tokens();

    @Test
    public void aTokenOpensAgainUntilCleared() {
        // Chromium opens a chosen content:// file more than once (when it is picked, and again when the page reads or
        // submits it, possibly minutes later), so a token is not used up by an open and has no short expiry.
        byte[] bytes = {1, 2, 3};
        String token = tokens.put(bytes, "a.pdf", "application/pdf");
        assertTrue(token.matches("[0-9a-f]{32}"));
        ChooserStreamProvider.Entry peeked = tokens.peek(token);
        assertNotNull(peeked);
        assertEquals("a.pdf", peeked.name);
        assertEquals(3, peeked.size());
        ChooserStreamProvider.Entry first = tokens.open(token);
        assertNotNull(first);
        assertArrayEquals(bytes, first.bytes);
        assertEquals("application/pdf", first.mimeType);
        assertNotNull(tokens.open(token));
        tokens.clear();
        assertNull(tokens.open(token));
        assertNull(tokens.peek(token));
    }

    @Test
    public void tokensAreDistinct() {
        assertNotEquals(tokens.put(new byte[0], "a", "x/y"), tokens.put(new byte[0], "a", "x/y"));
    }

    @Test
    public void theOldestFileGoesWhenTooManyAreHeld() {
        String first = tokens.put(new byte[] {1}, "a", "x/y");
        for (int i = 1; i < ChooserStreamProvider.Tokens.MAX_ENTRIES; i++) tokens.put(new byte[] {1}, "b", "x/y");
        assertNotNull(tokens.peek(first));
        String last = tokens.put(new byte[] {2}, "c", "x/y");
        assertNull(tokens.peek(first));
        assertNotNull(tokens.peek(last));
        assertEquals(ChooserStreamProvider.Tokens.MAX_ENTRIES, tokens.size());
    }

    @Test
    public void theOldestFilesGoWhenTheBytesAddUpTooHigh() {
        int chunk = ChooserStreamProvider.Tokens.MAX_BYTES / 3 + 1;
        String a = tokens.put(new byte[chunk], "a", "x/y");
        String b = tokens.put(new byte[chunk], "b", "x/y");
        String c = tokens.put(new byte[chunk], "c", "x/y");
        assertNull(tokens.peek(a));
        assertNotNull(tokens.peek(b));
        assertNotNull(tokens.peek(c));
    }

    @Test
    public void clearDropsAll() {
        String a = tokens.put(new byte[] {1}, "a", "x/y");
        String b = tokens.put(new byte[] {2}, "b", "x/y");
        assertEquals(2, tokens.size());
        tokens.clear();
        assertEquals(0, tokens.size());
        assertNull(tokens.open(a));
        assertNull(tokens.open(b));
    }

    @Test
    public void unknownTokensGiveNothing() {
        assertNull(tokens.open("0123456789abcdef0123456789abcdef"));
        assertNull(tokens.open(null));
        assertNull(tokens.peek(""));
    }
}
