package app.raf.dev;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Alarms do not survive a reboot or an app update, and wall-clock reminders move with the time zone: on these four
 * system broadcasts the stored reminders are scheduled again, without the UI. Exported because the system sends them;
 * any other action is ignored, and nothing but the action is read from the intent.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !handles(intent.getAction())) return;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                ReminderScheduler.rescheduleAll(app);
            } catch (RuntimeException e) {
                // The next sync from the app schedules them again.
            } finally {
                pending.finish();
            }
        }, "raf-reschedule").start();
    }

    static boolean handles(String action) {
        return Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action);
    }
}
