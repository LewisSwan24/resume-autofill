package app.raf.dev;

import java.net.URI;
import java.util.Locale;

/**
 * Which URLs the page WebView may load, and which ones may leave the app. Pure, so it unit-tests without Android.
 * Everything the page WebView may not load is cancelled and reported to the app as an "external" event; the
 * TypeScript policy (model/urlPolicy.ts) decides what, if anything, to offer the person.
 */
final class NavigationPolicy {
    enum Decision { LOAD, EXTERNAL }

    private NavigationPolicy() {}

    static Decision decide(String url) {
        String scheme = scheme(url);
        if ("http".equals(scheme) || "https".equals(scheme)) return Decision.LOAD;
        if ("about".equals(scheme)) {
            String rest = url.substring("about:".length()).toLowerCase(Locale.ROOT);
            if (isDocument(rest, "blank") || isDocument(rest, "srcdoc")) return Decision.LOAD;
        }
        return Decision.EXTERNAL;
    }

    /** openExternal: dial, mail and text drafts, and http(s) for "open in the phone's browser". Nothing else. */
    static boolean externalAllowed(String url) {
        String scheme = scheme(url);
        if (scheme == null) return false;
        switch (scheme) {
            case "tel":
            case "mailto":
            case "sms":
            case "smsto":
            case "http":
            case "https":
                return true;
            default:
                return false;
        }
    }

    /**
     * Same scheme, host and port (default ports filled in). SSL errors arrive without a main-frame flag: only one on the
     * main document's own origin is the page's; a third-party image, script or iframe with a bad certificate is not.
     */
    static boolean sameOrigin(String a, String b) {
        String x = origin(a);
        return x != null && x.equals(origin(b));
    }

    private static String origin(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if (port == -1) port = "https".equals(scheme) ? 443 : "http".equals(scheme) ? 80 : -1;
            return scheme + "://" + host.toLowerCase(Locale.ROOT) + ":" + port;
        } catch (Exception e) {
            return null;
        }
    }

    /** The lower-cased scheme, or null when the string has none (RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )). */
    static String scheme(String url) {
        if (url == null) return null;
        int colon = url.indexOf(':');
        if (colon <= 0) return null;
        for (int i = 0; i < colon; i++) {
            char c = url.charAt(i);
            boolean alpha = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
            boolean other = (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.';
            if (!(alpha || (i > 0 && other))) return null;
        }
        return url.substring(0, colon).toLowerCase(Locale.ROOT);
    }

    private static boolean isDocument(String rest, String name) {
        if (!rest.startsWith(name)) return false;
        if (rest.length() == name.length()) return true;
        char next = rest.charAt(name.length());
        return next == '#' || next == '?';
    }
}
