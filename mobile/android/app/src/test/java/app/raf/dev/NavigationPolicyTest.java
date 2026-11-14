package app.raf.dev;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NavigationPolicyTest {
    @Test
    public void webAndBlankDocumentsLoad() {
        for (String url : new String[] {
                "http://jobs.example.com/apply", "https://jobs.example.com/", "HTTPS://EXAMPLE.COM",
                "about:blank", "about:srcdoc", "https://appassets.androidplatform.net/demo/form.html"}) {
            assertEquals(url, NavigationPolicy.Decision.LOAD, NavigationPolicy.decide(url));
        }
    }

    @Test
    public void everythingElseIsExternal() {
        for (String url : new String[] {
                "tel:10086", "mailto:hr@example.com", "sms:10086", "weixin://dl/business/?t=demo",
                "intent://scan/#Intent;scheme=zxing;end", "javascript:alert(1)", "file:///sdcard/a.pdf",
                "data:text/html,hi", "blob:https://example.com/x", "content://x/y", "about:config",
                "market://details?id=x", "", "no-scheme", null}) {
            assertEquals(String.valueOf(url), NavigationPolicy.Decision.EXTERNAL, NavigationPolicy.decide(url));
        }
    }

    @Test
    public void onlyDialMailTextAndWebMayLeaveTheApp() {
        for (String url : new String[] {
                "tel:10086", "TEL:10086", "mailto:hr@example.com", "sms:10086", "smsto:10086",
                "http://example.com", "https://example.com/a"}) {
            assertTrue(url, NavigationPolicy.externalAllowed(url));
        }
        for (String url : new String[] {
                "weixin://dl", "intent://x#Intent;end", "javascript:alert(1)", "file:///a", "content://a/b",
                "data:,x", "market://details?id=x", "about:blank", "telx:1", "", null}) {
            assertFalse(String.valueOf(url), NavigationPolicy.externalAllowed(url));
        }
    }

    /** onReceivedSslError has no main-frame flag: only an error on the main document's own origin is the page's. */
    @Test
    public void sslErrorsCountOnlyForTheMainDocumentsOrigin() {
        assertTrue(NavigationPolicy.sameOrigin("https://127.0.0.1:4443/", "https://127.0.0.1:4443"));
        assertTrue(NavigationPolicy.sameOrigin("https://jobs.example.com/apply?x=1", "HTTPS://Jobs.Example.com/other"));
        assertTrue(NavigationPolicy.sameOrigin("https://jobs.example.com:443/a", "https://jobs.example.com/b"));
        assertFalse(NavigationPolicy.sameOrigin("https://cdn.example.net/logo.png", "https://jobs.example.com/apply"));
        assertFalse(NavigationPolicy.sameOrigin("https://jobs.example.com:8443/a", "https://jobs.example.com/a"));
        assertFalse(NavigationPolicy.sameOrigin("http://jobs.example.com/a", "https://jobs.example.com/a"));
        assertFalse(NavigationPolicy.sameOrigin("https://jobs.example.com/a", null));
        assertFalse(NavigationPolicy.sameOrigin(null, "https://jobs.example.com/a"));
        assertFalse(NavigationPolicy.sameOrigin("not a url", "not a url"));
    }
}
