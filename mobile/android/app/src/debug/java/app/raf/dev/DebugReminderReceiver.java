package app.raf.dev;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Debug builds only, for the device tests: inexact alarms cannot be awaited and BOOT_COMPLETED cannot be sent from the
 * shell. {@code FIRE_DUE} (long extra {@code at}, default now) posts and removes every stored reminder due by then;
 * {@code RESCHEDULE} runs the boot path.
 */
public class DebugReminderReceiver extends BroadcastReceiver {
    static final String ACTION_FIRE_DUE = "app.raf.dev.debug.FIRE_DUE";
    static final String ACTION_RESCHEDULE = "app.raf.dev.debug.RESCHEDULE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Context app = context.getApplicationContext();
        if (ACTION_FIRE_DUE.equals(action)) {
            long at = intent.getLongExtra("at", System.currentTimeMillis());
            run(() -> ReminderScheduler.fireDue(app, at));
        } else if (ACTION_RESCHEDULE.equals(action)) {
            run(() -> ReminderScheduler.rescheduleAll(app));
        }
    }

    private void run(Runnable work) {
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                work.run();
            } catch (RuntimeException e) {
                // Debug hook: a failure shows as a missing alarm or notification in the test.
            } finally {
                pending.finish();
            }
        }, "raf-debug-reminder").start();
    }
}
