package app.raf.dev;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Where launcher shortcuts land (static 粘贴链接 / 示例表单, the dynamic and pinned application shortcuts).
 *
 * A launcher starts a shortcut with FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK. Aimed straight at MainActivity,
 * that clears its task and recreates it, which throws away an open page and a running import. This activity lives in
 * a task of its own (empty taskAffinity, not in Recents, no history), so the clear only hits that task; it hands the
 * action and the two allowed extras to MainActivity, which gets them in onNewIntent, and finishes. It is not exported:
 * only the launcher, acting for this app, starts it. Nothing is read or logged here; IncomingIntents still decides.
 */
public class ShortcutActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        if (savedInstanceState == null && in != null && (in.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            String action = in.getAction();
            if (IncomingIntents.ACTION_PASTE_LINK.equals(action)
                || IncomingIntents.ACTION_OPEN_DEMO.equals(action)
                || IncomingIntents.ACTION_OPEN_APPLICATION.equals(action)) {
                Intent out = new Intent(this, MainActivity.class).setAction(action);
                if (IncomingIntents.ACTION_OPEN_APPLICATION.equals(action)) {
                    String recordId = in.getStringExtra(IncomingIntents.EXTRA_RECORD_ID);
                    String open = in.getStringExtra(IncomingIntents.EXTRA_OPEN);
                    if (recordId != null) out.putExtra(IncomingIntents.EXTRA_RECORD_ID, recordId);
                    if (open != null) out.putExtra(IncomingIntents.EXTRA_OPEN, open);
                }
                out.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(out);
            }
        }
        finish();
    }
}
