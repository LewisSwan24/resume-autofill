package app.raf.other;

/** Never used: an app class outside app/raf/dev/ for the planted escape in KeyboardNoNetworkTest. */
public final class Courier {
    private Courier() {}

    public static void carry(String text) {
        if (text == null) throw new IllegalArgumentException();
    }
}
