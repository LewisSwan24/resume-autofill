package app.raf.dev;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A reminder alarm went off. Not exported: only this app's own alarms reach it. The intent carries the entry id in its
 * data ({@code raf-reminder://<entryId>}); the words come from reminders.enc.
 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ReminderScheduler.ACTION_REMINDER.equals(intent.getAction())) return;
        String entryId = ReminderScheduler.entryIdOf(intent.getDataString());
        if (entryId == null) return;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ReminderScheduler.fire(app, entryId);
            } catch (RuntimeException e) {
                // Nothing posts; the entry stays for the next sync or boot.
            } finally {
                pending.finish();
            }
        }, "raf-reminder").start();
    }
}
