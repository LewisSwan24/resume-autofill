package app.raf.dev.keyboard;

/**
 * Which resume the keyboard shows. The choice lives in the keyboard process's memory only and never changes the app's
 * active resume.
 */
final class ResumeChoice {
    private ResumeChoice() {}

    static String initial(KeyboardData d) {
        return d.defaultResume;
    }

    /** Keep the current choice while it still exists, else go back to the default. */
    static String reconcile(KeyboardData d, String current) {
        return d.resume(current) != null ? current : d.defaultResume;
    }

    /** The other-language resume (the 中|EN toggle), or the current one when there is none. */
    static String toggleLanguage(KeyboardData d, String current) {
        KeyboardData.Resume r = d.resume(current);
        if (r == null) return d.defaultResume;
        return r.counterpart != null && d.resume(r.counterpart) != null ? r.counterpart : current;
    }
}
