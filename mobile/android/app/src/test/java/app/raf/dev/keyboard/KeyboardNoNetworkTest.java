package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.JarURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.Test;

/**
 * The keyboard's compiled classes (app/raf/dev/keyboard/*, plus VaultCrypto, the one app
 * class it may use) reference no network, web, download, socket, reflection, native-code, clipboard or field-text API,
 * and no other app class. It reads the constant pool of each .class file, so it sees what the bytecode really links to,
 * including fully qualified names and types that only appear in descriptors. Every class below the keyboard package is
 * scanned, subpackages included, and anything outside the platform and a short allowlist (ALLOWED_EXTERNAL) is refused,
 * because a library the scan does not read could do the network call for it.
 *
 * What it does not prove: a deliberate exit through an intent built at run time (an explicit component with extras,
 * strings assembled from pieces) or a platform API not on the lists. It guards against the keyboard picking up network
 * code by accident or through a dependency, and the review of each change still has to look at intents.
 *
 * The rules are mirrored over the Java sources in tests/unit/mobile/keyboard/noNetworkRules.ts.
 */
public class KeyboardNoNetworkTest {
    static final List<String> BANNED_PREFIXES = Arrays.asList(
        "java/net/", "javax/net/", "android/net/", "android/webkit/", "androidx/webkit/", "okhttp3/", "okio/",
        "com/android/okhttp/", "org/apache/http/", "android/app/DownloadManager", "java/nio/channels/",
        "com/getcapacitor/", "android/util/Log", "java/lang/reflect/", "java/lang/ClassLoader", "dalvik/system/",
        "java/lang/Runtime", "java/lang/ProcessBuilder", "android/content/ClipboardManager",
        "android/content/ClipData", "android/bluetooth/", "android/nfc/", "android/telephony/SmsManager",
        "android/app/PendingIntent");

    /** Method handles are how javac compiles lambdas and string concatenation; any other use of them is refused. */
    static final List<String> COMPILER_INVOKE = Arrays.asList(
        "java/lang/invoke/LambdaMetafactory.metafactory", "java/lang/invoke/LambdaMetafactory.altMetafactory",
        "java/lang/invoke/StringConcatFactory.makeConcatWithConstants");

    /** Packages outside the app the keyboard may reference at all (the banned rules still apply inside them). */
    static final List<String> ALLOWED_EXTERNAL = Arrays.asList(
        "java/lang/", "java/util/", "java/io/", "java/nio/", "java/security/", "javax/crypto/", "java/text/",
        "java/time/", "java/math/", "android/", "androidx/core/", "androidx/annotation/", "dalvik/annotation/");

    /** Banned on a specific owner (owner.name). */
    static final List<String> BANNED_MEMBERS = Arrays.asList(
        "java/lang/Class.forName", "java/lang/System.loadLibrary", "java/lang/System.load", "java/lang/System.out",
        "java/lang/System.err", "android/content/Intent.parseUri", "android/content/Intent.getIntent",
        "android/content/Intent.getIntentOld");

    /** Banned whatever the owner (subclasses and interfaces declare them too). */
    static final List<String> BANNED_NAMES = Arrays.asList(
        "printStackTrace", "getTextBeforeCursor", "getTextAfterCursor", "getSelectedText", "getSurroundingText",
        "getExtractedText", "sendBroadcast", "getContentResolver", "bindService", "sendOrderedBroadcast",
        "sendStickyBroadcast", "sendStickyOrderedBroadcast", "sendBroadcastAsUser", "sendOrderedBroadcastAsUser",
        "sendStickyBroadcastAsUser", "sendStickyOrderedBroadcastAsUser", "startService", "startForegroundService",
        "startIntentSender", "startActivities");

    static final List<String> BANNED_STRINGS = Arrays.asList("http://", "https://", "java.net", "javax.net", "okhttp",
        "android.intent.action.SEND", "android.intent.action.VIEW", "android.intent.action.WEB_SEARCH");

    private static final Pattern DESCRIPTOR_TYPE = Pattern.compile("L([A-Za-z_$][A-Za-z0-9_$]*(?:/[A-Za-z0-9_$]+)+);");
    private static final int ACC_NATIVE = 0x0100;

    /** Whether an app class outside the keyboard package may be referenced. */
    static boolean allowedAppClass(String internalName) {
        if (!internalName.startsWith("app/raf/")) return true;
        if (internalName.startsWith("app/raf/dev/keyboard/")) return true;
        if (!internalName.startsWith("app/raf/dev/")) return false;
        String rest = internalName.substring("app/raf/dev/".length());
        return rest.equals("VaultCrypto") || rest.equals("R") || rest.startsWith("R$") || rest.equals("BuildConfig");
    }

    // ------------------------------------------------------------ the class-file reader

    static final class Scan {
        final String self;
        final Set<String> types = new TreeSet<>();
        final Set<String> members = new TreeSet<>();
        final List<String> strings = new ArrayList<>();
        final List<String> nativeMethods = new ArrayList<>();

        Scan(String self) {
            this.self = self;
        }
    }

    static Scan scan(byte[] bytes) throws IOException {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes));
        if (in.readInt() != 0xCAFEBABE) throw new IOException("not a class file");
        in.readUnsignedShort();
        in.readUnsignedShort();
        int count = in.readUnsignedShort();
        int[] tag = new int[count];
        String[] utf = new String[count];
        int[] a = new int[count];
        int[] b = new int[count];
        for (int i = 1; i < count; i++) {
            tag[i] = in.readUnsignedByte();
            switch (tag[i]) {
                case 1: utf[i] = in.readUTF(); break;
                case 3: case 4: in.readInt(); break;
                case 5: case 6: in.readLong(); i++; break;
                case 7: case 8: case 16: case 19: case 20: a[i] = in.readUnsignedShort(); break;
                case 9: case 10: case 11: case 12: case 17: case 18:
                    a[i] = in.readUnsignedShort();
                    b[i] = in.readUnsignedShort();
                    break;
                case 15: in.readUnsignedByte(); a[i] = in.readUnsignedShort(); break;
                default: throw new IOException("unknown constant tag " + tag[i]);
            }
        }
        in.readUnsignedShort(); // access
        String self = utf[a[in.readUnsignedShort()]];
        Scan s = new Scan(self);
        for (int i = 1; i < count; i++) {
            if (tag[i] == 7) addType(s, utf[a[i]]);
            if (tag[i] == 1) {
                Matcher m = DESCRIPTOR_TYPE.matcher(utf[i]);
                while (m.find()) addType(s, m.group(1));
            }
            if (tag[i] == 8) s.strings.add(utf[a[i]]);
            if (tag[i] == 9 || tag[i] == 10 || tag[i] == 11) {
                String owner = utf[a[a[i]]];
                String name = utf[a[b[i]]];
                s.members.add(owner + "." + name);
            }
        }
        in.readUnsignedShort(); // super
        int interfaces = in.readUnsignedShort();
        for (int i = 0; i < interfaces; i++) in.readUnsignedShort();
        int fields = in.readUnsignedShort();
        for (int i = 0; i < fields; i++) skipMember(in, null, null);
        int methods = in.readUnsignedShort();
        for (int i = 0; i < methods; i++) skipMember(in, s, utf);
        return s;
    }

    private static void addType(Scan s, String name) {
        if (name == null) return;
        if (name.startsWith("[")) {
            Matcher m = DESCRIPTOR_TYPE.matcher(name);
            while (m.find()) s.types.add(m.group(1));
            return;
        }
        s.types.add(name);
    }

    private static void skipMember(DataInputStream in, Scan s, String[] utf) throws IOException {
        int access = in.readUnsignedShort();
        int name = in.readUnsignedShort();
        in.readUnsignedShort();
        if (s != null && (access & ACC_NATIVE) != 0) s.nativeMethods.add(utf[name]);
        int attributes = in.readUnsignedShort();
        for (int i = 0; i < attributes; i++) {
            in.readUnsignedShort();
            int length = in.readInt();
            in.skipBytes(length);
        }
    }

    /** A package rule ("java/net/") covers everything below it; a class rule covers the class and its inner classes. */
    static boolean banned(String type, String rule) {
        if (rule.endsWith("/")) return type.startsWith(rule);
        return type.equals(rule) || type.startsWith(rule + "$");
    }

    /** Every rule broken by one class, as "kind detail" lines. */
    static List<String> violations(byte[] bytes) throws IOException {
        Scan s = scan(bytes);
        List<String> out = new ArrayList<>();
        for (String t : s.types) {
            for (String p : BANNED_PREFIXES) if (banned(t, p)) out.add("type " + t);
            boolean own = t.equals(s.self) || t.startsWith(s.self + "$");
            if (!own && !allowedAppClass(t)) out.add("appClass " + t);
            if (!t.startsWith("app/raf/") && !allowedExternal(t)) out.add("foreign " + t);
        }
        for (String m : s.members) {
            if (BANNED_MEMBERS.contains(m)) out.add("member " + m);
            String name = m.substring(m.lastIndexOf('.') + 1);
            if (BANNED_NAMES.contains(name)) out.add("member " + m);
            if (m.startsWith("java/lang/invoke/") && !COMPILER_INVOKE.contains(m)) out.add("member " + m);
        }
        for (String n : s.nativeMethods) out.add("native " + n);
        for (String str : s.strings) {
            for (String banned : BANNED_STRINGS) if (str.contains(banned)) out.add("string " + banned);
        }
        return out;
    }

    // ------------------------------------------------------------ locating the compiled classes

    /** The bytes of one class on the test classpath (a folder or a jar). */
    private static byte[] classBytes(String resource) throws Exception {
        URL url = KeyboardNoNetworkTest.class.getResource(resource);
        assertNotNull(resource + " is not on the test classpath", url);
        try (InputStream in = url.openStream()) {
            return readAll(in);
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }

    /** The compiled keyboard classes (including nested ones) and VaultCrypto, by file name. */
    static Map<String, byte[]> keyboardClasses() throws Exception {
        Map<String, byte[]> out = new TreeMap<>();
        URL url = KeyboardNoNetworkTest.class.getResource("/app/raf/dev/keyboard/KbJson.class");
        assertNotNull("the keyboard classes are not on the test classpath", url);
        if ("jar".equals(url.getProtocol())) {
            JarURLConnection connection = (JarURLConnection) url.openConnection();
            connection.setUseCaches(false);
            try (JarFile jar = connection.getJarFile()) {
                Enumeration<JarEntry> entries = jar.entries();
                while (entries.hasMoreElements()) {
                    JarEntry e = entries.nextElement();
                    String name = e.getName();
                    if (!isKeyboardEntry(name)) continue;
                    try (InputStream in = jar.getInputStream(e)) {
                        out.put(name.substring("app/raf/dev/keyboard/".length()), readAll(in));
                    }
                }
            }
        } else {
            collectClasses(new File(url.toURI()).getParentFile(), "", out);
        }
        out.put("VaultCrypto.class", classBytes("/app/raf/dev/VaultCrypto.class"));
        return out;
    }

    static boolean allowedExternal(String type) {
        for (String p : ALLOWED_EXTERNAL) if (type.startsWith(p)) return true;
        return false;
    }

    /** A jar entry of the keyboard package or any package below it. */
    static boolean isKeyboardEntry(String name) {
        return name.startsWith("app/raf/dev/keyboard/") && name.endsWith(".class");
    }

    /** The .class files in a folder and every folder below it, by path relative to it. */
    static void collectClasses(File dir, String prefix, Map<String, byte[]> out) throws IOException {
        File[] list = dir.listFiles();
        assertNotNull(list);
        for (File f : list) {
            if (f.isDirectory()) collectClasses(f, prefix + f.getName() + "/", out);
            else if (f.getName().endsWith(".class")) out.put(prefix + f.getName(), Files.readAllBytes(f.toPath()));
        }
    }

    // ------------------------------------------------------------ tests

    @Test
    public void thePlantedClassIsCaught() throws Exception {
        List<String> found = violations(classBytes("/app/raf/dev/kbfixture/PlantedNetworkUse.class"));
        assertTrue(found.toString(), found.contains("type java/net/URL"));
        assertTrue(found.toString(), found.contains("type android/webkit/WebView"));
        assertTrue(found.toString(), found.contains("member java/lang/Class.forName"));
        assertTrue(found.toString(), found.contains("member android/view/inputmethod/InputConnection.getTextBeforeCursor"));
        assertTrue(found.toString(), found.contains("string java.net"));
        assertTrue(found.toString(), found.contains("appClass app/raf/dev/MainActivity"));
    }

    @Test
    public void thePlantedEscapeIsCaught() throws Exception {
        List<String> found = violations(classBytes("/app/raf/kbfixture/PlantedEscape.class"));
        assertTrue(found.toString(), found.contains("appClass app/raf/other/Courier"));
        assertTrue(found.toString(), found.contains("foreign org/json/JSONObject"));
        assertTrue(found.toString(), found.contains("member android/content/Context.sendOrderedBroadcast"));
        assertTrue(found.toString(), found.contains("member android/content/Context.startService"));
        assertTrue(found.toString(), found.contains("member android/content/Intent.parseUri"));
        assertTrue(found.toString(), found.contains("type android/app/PendingIntent"));
        assertTrue(found.toString(), found.contains("member java/lang/invoke/MethodHandles.lookup"));
        assertTrue(found.toString(), found.contains("string android.intent.action.SEND"));
    }

    @Test
    public void keyboardSubpackagesAreScannedToo() throws Exception {
        assertTrue(isKeyboardEntry("app/raf/dev/keyboard/KbJson.class"));
        assertTrue(isKeyboardEntry("app/raf/dev/keyboard/util/Http.class"));
        assertTrue(isKeyboardEntry("app/raf/dev/keyboard/a/b/C$1.class"));
        assertTrue(!isKeyboardEntry("app/raf/dev/keyboardx/Http.class"));
        assertTrue(!isKeyboardEntry("app/raf/dev/keyboard/notes.txt"));
        File root = Files.createTempDirectory("kbscan").toFile();
        try {
            File nested = new File(root, "util/deeper");
            assertTrue(nested.mkdirs());
            Files.write(new File(root, "Top.class").toPath(), new byte[] {1});
            Files.write(new File(nested, "Http.class").toPath(), new byte[] {2});
            Files.write(new File(nested, "readme.txt").toPath(), new byte[] {3});
            Map<String, byte[]> out = new TreeMap<>();
            collectClasses(root, "", out);
            assertEquals("[Top.class, util/deeper/Http.class]", out.keySet().toString());
        } finally {
            for (String f : new String[] {"util/deeper/Http.class", "util/deeper/readme.txt", "util/deeper", "util", "Top.class", ""}) {
                new File(root, f).delete();
            }
        }
    }

    @Test
    public void theKeyboardClassesAndVaultCryptoAreClean() throws Exception {
        Map<String, byte[]> classes = keyboardClasses();
        Set<String> names = classes.keySet();
        // The scan covers the real keyboard, not an empty folder.
        for (String expected : new String[] {"ResumeKeyboardService.class", "KeyboardDataStore.class", "KbJson.class",
            "KeyboardData.class", "KeyboardRootView.class", "EntryRowView.class", "VaultCrypto.class"}) {
            assertTrue(expected + " not scanned", names.contains(expected));
        }
        List<String> all = new ArrayList<>();
        for (Map.Entry<String, byte[]> c : classes.entrySet()) for (String v : violations(c.getValue())) all.add(c.getKey() + ": " + v);
        assertEquals("[]", all.toString());
    }

    @Test
    public void theAppClassAllowlistHolds() throws Exception {
        Set<String> appClasses = new TreeSet<>();
        for (byte[] bytes : keyboardClasses().values()) {
            for (String t : scan(bytes).types) {
                if (t.startsWith("app/raf/dev/") && !t.startsWith("app/raf/dev/keyboard/")) appClasses.add(t);
            }
        }
        // The keyboard really does use VaultCrypto, so the check is looking at app references at all.
        assertTrue(appClasses.toString(), appClasses.contains("app/raf/dev/VaultCrypto"));
        for (String c : appClasses) assertTrue(c, allowedAppClass(c));
        assertTrue(allowedAppClass("app/raf/dev/R$string"));
        assertTrue(!allowedAppClass("app/raf/dev/ProfileVaultPlugin"));
        assertTrue(!allowedAppClass("app/raf/dev/Rogue"));
    }

    @Test
    public void classRulesCoverInnerClassesButNotLookalikes() {
        assertTrue(banned("java/lang/Runtime", "java/lang/Runtime"));
        assertTrue(banned("java/lang/Runtime$Version", "java/lang/Runtime"));
        assertTrue(!banned("java/lang/RuntimeException", "java/lang/Runtime"));
        assertTrue(banned("android/util/Log", "android/util/Log"));
        assertTrue(banned("java/net/Socket", "java/net/"));
        assertTrue(banned("android/app/DownloadManager$Request", "android/app/DownloadManager"));
    }
}
