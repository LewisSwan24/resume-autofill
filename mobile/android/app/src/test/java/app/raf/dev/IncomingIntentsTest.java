package app.raf.dev;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;

import org.junit.Test;

public class IncomingIntentsTest {
    private static final String VIEW = Intent.ACTION_VIEW;
    private static final String SEND = Intent.ACTION_SEND;

    private static IncomingIntents.Result view(String scheme, String data) {
        return IncomingIntents.classify(VIEW, scheme, data, null, null, null, null, false, null, null, 0);
    }

    private static IncomingIntents.Result send(String type, CharSequence text, String subject, String title, boolean stream) {
        return IncomingIntents.classify(SEND, null, null, type, text, subject, title, stream, null, null, 0);
    }

    private static IncomingIntents.Result action(String action, String recordId, String open, int flags) {
        return IncomingIntents.classify(action, null, null, null, null, null, null, false, recordId, open, flags);
    }

    private static String repeat(String s, int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(s);
        return b.toString();
    }

    @Test
    public void viewHttpsIsALink() {
        IncomingIntents.Result r = view("https", "https://jobs.example.com/apply?id=1");
        assertEquals(IncomingIntents.Kind.VIEW, r.kind);
        assertEquals("https://jobs.example.com/apply?id=1", r.url);
        assertEquals(IncomingIntents.Kind.VIEW, view("http", "http://example.com/").kind);
    }

    @Test
    public void viewSchemeIsCaseInsensitive() {
        IncomingIntents.Result r = view("HTTPS", "HTTPS://EXAMPLE.COM/");
        assertEquals(IncomingIntents.Kind.VIEW, r.kind);
        assertEquals("HTTPS://EXAMPLE.COM/", r.url);
        assertEquals(IncomingIntents.Kind.VIEW, view("Http", "Http://example.com/").kind);
    }

    @Test
    public void viewContentIsAFile() {
        assertEquals(IncomingIntents.Kind.FILE, view("content", "content://provider/doc/1").kind);
    }

    @Test
    public void viewJavascriptFileDataIntentAreRefused() {
        String[][] cases = {
            {"javascript", "javascript:alert(1)"}, {"file", "file:///sdcard/a.html"}, {"data", "data:text/html,hi"},
            {"intent", "intent://x#Intent;end"}, {"ftp", "ftp://example.com/"}, {"weixin", "weixin://dl"},
        };
        for (String[] c : cases) {
            IncomingIntents.Result r = view(c[0], c[1]);
            assertEquals(c[0], IncomingIntents.Kind.REFUSED, r.kind);
            assertEquals(c[0], "scheme", r.reason);
            assertNull(c[0], r.url);
        }
    }

    @Test
    public void viewOver4096IsRefusedTooLong() {
        String head = "https://example.com/?q=";
        String exact = head + repeat("a", 4096 - head.length());
        assertEquals(IncomingIntents.Kind.VIEW, view("https", exact).kind);
        IncomingIntents.Result r = view("https", exact + "a");
        assertEquals(IncomingIntents.Kind.REFUSED, r.kind);
        assertEquals("too_long", r.reason);
        assertNull(r.url);
    }

    @Test
    public void viewWithoutDataIsNone() {
        assertEquals(IncomingIntents.Kind.NONE, view(null, null).kind);
        assertEquals(IncomingIntents.Kind.NONE, view("https", "").kind);
    }

    @Test
    public void sendTextPlainIsText() {
        IncomingIntents.Result r = send("text/plain", "【示例科技校园招聘】网申入口 https://example.com/job", "示例", null, false);
        assertEquals(IncomingIntents.Kind.TEXT, r.kind);
        assertEquals("【示例科技校园招聘】网申入口 https://example.com/job", r.text);
        assertEquals("示例", r.subject);
        assertFalse(r.cut);
        assertEquals(IncomingIntents.Kind.TEXT, send("text/html", "<a>x</a>", null, null, false).kind);
        assertEquals(IncomingIntents.Kind.NONE, send("text/plain", "", null, null, false).kind);
        assertEquals(IncomingIntents.Kind.NONE, send("text/plain", null, null, null, false).kind);
    }

    @Test
    public void sendTextIsCutAt8192CodePointsAndFlagged() {
        String emoji = new String(Character.toChars(0x1F600));
        IncomingIntents.Result exact = send("text/plain", repeat(emoji, 8192), null, null, false);
        assertFalse(exact.cut);
        assertEquals(8192, exact.text.codePointCount(0, exact.text.length()));
        IncomingIntents.Result r = send("text/plain", repeat(emoji, 8193), null, null, false);
        assertEquals(IncomingIntents.Kind.TEXT, r.kind);
        assertTrue(r.cut);
        assertEquals(8192, r.text.codePointCount(0, r.text.length()));
        assertEquals(8192 * 2, r.text.length());
    }

    @Test
    public void sendSubjectFallsBackToTitle() {
        assertEquals("标题", send("text/plain", "x", null, "标题", false).subject);
        assertEquals("标题", send("text/plain", "x", "", "标题", false).subject);
        assertEquals("主题", send("text/plain", "x", "主题", "标题", false).subject);
        assertNull(send("text/plain", "x", null, null, false).subject);
        String subject = send("text/plain", "x", repeat("长", 300), null, false).subject;
        assertEquals(200, subject.codePointCount(0, subject.length()));
    }

    @Test
    public void sendPdfStreamIsAFile() {
        assertEquals(IncomingIntents.Kind.FILE, send("application/pdf", null, null, null, true).kind);
        assertEquals(IncomingIntents.Kind.NONE, send("application/pdf", null, null, null, false).kind);
    }

    @Test
    public void sendTextTypeWithoutTextButStreamIsAFile() {
        assertEquals(IncomingIntents.Kind.FILE, send("text/plain", null, null, null, true).kind);
        assertEquals(IncomingIntents.Kind.FILE, send("text/plain", "  ", null, null, true).kind);
    }

    @Test
    public void pasteAndDemoShortcuts() {
        assertEquals(IncomingIntents.Kind.PASTE, action(IncomingIntents.ACTION_PASTE_LINK, null, null, 0).kind);
        assertEquals(IncomingIntents.Kind.DEMO, action(IncomingIntents.ACTION_OPEN_DEMO, null, null, 0).kind);
        assertEquals("app.raf.dev.action.PASTE_LINK", IncomingIntents.ACTION_PASTE_LINK);
        assertEquals("app.raf.dev.action.OPEN_DEMO", IncomingIntents.ACTION_OPEN_DEMO);
        assertEquals("app.raf.dev.action.OPEN_APPLICATION", IncomingIntents.ACTION_OPEN_APPLICATION);
    }

    @Test
    public void openApplicationNeedsAValidRecordId() {
        String a = IncomingIntents.ACTION_OPEN_APPLICATION;
        IncomingIntents.Result r = action(a, "rec-1A", "detail", 0);
        assertEquals(IncomingIntents.Kind.APPLICATION, r.kind);
        assertEquals("rec-1A", r.recordId);
        assertEquals("detail", r.open);
        for (String bad : new String[] {null, "", "../x", "a b", "a:b", repeat("a", 65), "示例"}) {
            assertEquals(String.valueOf(bad), IncomingIntents.Kind.NONE, action(a, bad, "page", 0).kind);
        }
        assertEquals(IncomingIntents.Kind.APPLICATION, action(a, repeat("a", 64), null, 0).kind);
    }

    @Test
    public void openApplicationDefaultsToPage() {
        String a = IncomingIntents.ACTION_OPEN_APPLICATION;
        assertEquals("page", action(a, "r1", null, 0).open);
        assertEquals("page", action(a, "r1", "page", 0).open);
        assertEquals("page", action(a, "r1", "something", 0).open);
    }

    /** A notification's 打开网申页面 says where it came from, so closing returns to 网申. */
    @Test
    public void reminderPageOpensThePageAndSaysItCameFromAReminder() {
        String a = IncomingIntents.ACTION_OPEN_APPLICATION;
        IncomingIntents.Result r = action(a, "r1", IncomingIntents.OPEN_REMINDER_PAGE, 0);
        assertEquals("page", r.open);
        assertEquals("reminder", r.from);
        assertEquals(null, action(a, "r1", "page", 0).from);
        assertEquals(null, action(a, "r1", "detail", 0).from);
    }

    @Test
    public void launchedFromHistoryIsIgnoredForEveryKind() {
        int h = Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY;
        assertEquals(IncomingIntents.Kind.NONE,
            IncomingIntents.classify(VIEW, "https", "https://example.com/", null, null, null, null, false, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE,
            IncomingIntents.classify(VIEW, "content", "content://x/1", null, null, null, null, false, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE,
            IncomingIntents.classify(VIEW, "javascript", "javascript:x", null, null, null, null, false, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE,
            IncomingIntents.classify(SEND, null, null, "text/plain", "x", null, null, true, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE, action(IncomingIntents.ACTION_PASTE_LINK, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE, action(IncomingIntents.ACTION_OPEN_DEMO, null, null, h).kind);
        assertEquals(IncomingIntents.Kind.NONE, action(IncomingIntents.ACTION_OPEN_APPLICATION, "r1", null, h).kind);
    }

    @Test
    public void mainLauncherIsNone() {
        assertEquals(IncomingIntents.Kind.NONE, action(Intent.ACTION_MAIN, null, null, 0).kind);
        assertEquals(IncomingIntents.Kind.NONE, action(null, null, null, 0).kind);
        assertEquals(IncomingIntents.Kind.NONE, action("android.intent.action.EDIT", null, null, 0).kind);
    }
}
