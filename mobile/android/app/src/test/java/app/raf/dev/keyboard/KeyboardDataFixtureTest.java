package app.raf.dev.keyboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.Test;

/**
 * The TypeScript builder (mobile/app/src/keyboard/projection.ts) and this parser must agree on the format. The TS test
 * writes the fixture from the builder; this test parses it with the Java side.
 */
public class KeyboardDataFixtureTest {
    /** Walk up from the working directory to the folder holding tests/unit/mobile (the repo root). */
    static File repoRoot() {
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (dir != null) {
            if (new File(dir, "tests/unit/mobile").isDirectory()) return dir;
            dir = dir.getParentFile();
        }
        throw new AssertionError("tests/unit/mobile not found above user.dir");
    }

    @Test
    public void theBuildersFixtureParses() throws Exception {
        File fixture = new File(repoRoot(), "tests/unit/mobile/fixtures/keyboard/projection-v1.json");
        assertTrue("the projection-v1.json is missing", fixture.isFile());
        KeyboardData d = KeyboardData.parse(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
        assertEquals(2, d.resumes.size());
        // Ids are keyboardResumeId(real id) (projection.ts): 'r' and 8 hex digits, stable when resumes move.
        KeyboardData.Resume r0 = d.resumes.get(0);
        KeyboardData.Resume r1 = d.resumes.get(1);
        assertTrue(r0.id, r0.id.matches("r[0-9a-f]{8}"));
        assertTrue(r1.id, r1.id.matches("r[0-9a-f]{8}"));
        assertEquals(r0.id, d.defaultResume);
        assertNotNull(d.resume(r1.id));
        assertEquals(r1.id, r0.counterpart);
        assertEquals(r0.id, r1.counterpart);
        KeyboardData.Group first = r0.groups.get(0);
        assertEquals("basics", first.id);
        KeyboardData.Item name = first.sections.get(0).items.get(0);
        assertEquals("姓名", name.label);
        assertEquals("张三", name.value);
        boolean educationTitled = false;
        for (KeyboardData.Group g : r0.groups) {
            if (!g.id.equals("education")) continue;
            for (KeyboardData.Section s : g.sections) educationTitled |= s.title != null && s.title.startsWith("第一段");
        }
        assertTrue("an education section titled 第一段…", educationTitled);
    }
}
