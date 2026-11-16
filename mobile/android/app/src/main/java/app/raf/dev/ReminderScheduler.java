package app.raf.dev;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Turns stored reminders into inexact alarms and posts their notifications. Every alarm is a broadcast to
 * ReminderReceiver whose only data is the entry id ({@code raf-reminder://<entryId>}); every notification opens the
 * app with a record id and what to open, nothing else. Wall-clock times become instants here, in the device's zone at
 * the moment of scheduling, so the boot, time and time-zone broadcasts re-schedule them right.
 */
final class ReminderScheduler {
    static final String ACTION_REMINDER = "app.raf.dev.REMINDER";
    static final String SCHEME = "raf-reminder://";
    static final String CHANNEL_ID = "deadlines";
    static final int NOTIFICATION_ID = 1;
    static final long WINDOW_MS = 10 * 60_000L;
    /** The light accent; native colours from the design tokens are a follow-up. */
    private static final int ACCENT = 0xFF0066CC;

    /** Store reads and writes happen under this, from the plugin's thread and the receivers alike. */
    static final Object LOCK = new Object();

    private ReminderScheduler() {}

    /** Replace everything with {@code next}; returns how many alarms are set. */
    static int syncAll(Context context, ReminderStore.Payload next) throws Exception {
        synchronized (LOCK) {
            ReminderStore.Payload old = ReminderStore.read(context);
            Set<String> nextIds = new HashSet<>();
            Set<String> nextRecords = new HashSet<>();
            for (ReminderStore.Entry e : next.entries) {
                nextIds.add(e.id);
                nextRecords.add(e.recordId);
            }
            Set<String> oldIds = new HashSet<>();
            if (old != null) {
                NotificationManagerCompat notifications = NotificationManagerCompat.from(context);
                for (ReminderStore.Entry e : old.entries) {
                    oldIds.add(e.id);
                    if (!nextIds.contains(e.id)) cancelAlarm(context, e.id);
                    if (!nextRecords.contains(e.recordId)) notifications.cancel(e.recordId, NOTIFICATION_ID);
                }
            }
            return apply(context, next, oldIds);
        }
    }

    /** Read the store and set its alarms again (boot, time or zone change, app update). */
    static void rescheduleAll(Context context) {
        synchronized (LOCK) {
            ReminderStore.Payload stored = ReminderStore.read(context);
            if (stored == null) return;
            try {
                apply(context, stored, null);
            } catch (Exception e) {
                // Nothing to report to: the next sync from the app writes the store again.
            }
        }
    }

    /** Cancel every stored alarm. The store itself stays; ReminderStore.delete removes it. */
    static void cancelAll(Context context) {
        synchronized (LOCK) {
            ReminderStore.Payload stored = ReminderStore.read(context);
            if (stored == null) return;
            for (ReminderStore.Entry e : stored.entries) cancelAlarm(context, e.id);
        }
    }

    /** An alarm went off: post the entry if it is still due, and remove it. A missing entry does nothing. */
    static void fire(Context context, String entryId) {
        if (!ReminderMath.validId(entryId)) return;
        synchronized (LOCK) {
            ReminderStore.Payload stored = ReminderStore.read(context);
            if (stored == null) return;
            ReminderStore.Entry entry = stored.find(entryId);
            if (entry == null) return;
            List<ReminderStore.Entry> rest = new ArrayList<>(stored.entries);
            rest.remove(entry);
            try {
                ReminderStore.write(context, stored.withEntries(rest));
            } catch (Exception e) {
                return;
            }
            ZoneId zone = ZoneId.systemDefault();
            long now = System.currentTimeMillis();
            ReminderMath.Decision d = ReminderMath.decide(
                ReminderMath.toEpoch(entry.at, zone), ReminderMath.toEpoch(entry.end, zone), now);
            // An inexact alarm may come a little early; the window is ten minutes.
            if (d != ReminderMath.Decision.DROP) post(context, stored, entry);
        }
    }

    /** Debug builds only (DebugReminderReceiver): post and remove every entry due at {@code at}. */
    static void fireDue(Context context, long at) {
        synchronized (LOCK) {
            ReminderStore.Payload stored = ReminderStore.read(context);
            if (stored == null) return;
            ZoneId zone = ZoneId.systemDefault();
            List<ReminderStore.Entry> rest = new ArrayList<>();
            List<ReminderStore.Entry> due = new ArrayList<>();
            for (ReminderStore.Entry e : stored.entries) {
                if (ReminderMath.toEpoch(e.at, zone) <= at) due.add(e);
                else rest.add(e);
            }
            try {
                ReminderStore.write(context, stored.withEntries(rest));
            } catch (Exception e) {
                return;
            }
            for (ReminderStore.Entry e : due) {
                cancelAlarm(context, e.id);
                post(context, stored, e);
            }
        }
    }

    /**
     * Decide each entry, write back the ones still ahead, then set their alarms. Caller holds LOCK. {@code storedIds}
     * are the entries stored before a sync (a due one posts only if it is among them); null when re-applying the store
     * itself, where every entry is still undelivered.
     */
    private static int apply(Context context, ReminderStore.Payload payload, Set<String> storedIds) throws Exception {
        ZoneId zone = ZoneId.systemDefault();
        long now = System.currentTimeMillis();
        List<ReminderStore.Entry> keep = new ArrayList<>();
        List<Long> times = new ArrayList<>();
        List<ReminderStore.Entry> postNow = new ArrayList<>();
        for (ReminderStore.Entry e : payload.entries) {
            long at = ReminderMath.toEpoch(e.at, zone);
            long end = ReminderMath.toEpoch(e.end, zone);
            switch (ReminderMath.onSync(at, end, now, storedIds == null || storedIds.contains(e.id))) {
                case SCHEDULE:
                    keep.add(e);
                    times.add(at);
                    break;
                case POST_NOW:
                    postNow.add(e);
                    cancelAlarm(context, e.id);
                    break;
                default:
                    cancelAlarm(context, e.id);
            }
        }
        // Written before the alarms are set, so an alarm always finds its entry.
        ReminderStore.write(context, payload.withEntries(keep));
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        for (int i = 0; i < keep.size(); i++) {
            alarms.setWindow(AlarmManager.RTC_WAKEUP, times.get(i), WINDOW_MS, alarmIntent(context, keep.get(i).id, 0));
        }
        for (ReminderStore.Entry e : postNow) post(context, payload, e);
        return keep.size();
    }

    private static void cancelAlarm(Context context, String entryId) {
        PendingIntent pending = alarmIntent(context, entryId, PendingIntent.FLAG_NO_CREATE);
        if (pending == null) return;
        context.getSystemService(AlarmManager.class).cancel(pending);
        pending.cancel();
    }

    private static PendingIntent alarmIntent(Context context, String entryId, int extraFlags) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .setAction(ACTION_REMINDER)
            .setData(Uri.parse(SCHEME + entryId));
        return PendingIntent.getBroadcast(context, ReminderMath.requestCode(entryId), intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT | extraFlags);
    }

    /** The entry id of an alarm intent's data, or null. */
    static String entryIdOf(String dataString) {
        if (dataString == null || !dataString.startsWith(SCHEME)) return null;
        String id = dataString.substring(SCHEME.length());
        return ReminderMath.validId(id) ? id : null;
    }

    // ------------------------------------------------------------ notification

    static void ensureChannel(Context context, ReminderStore.Payload payload) {
        String name = payload.channelName == null || payload.channelName.isEmpty()
            ? context.getString(R.string.notification_channel) : payload.channelName;
        NotificationChannelCompat channel = new NotificationChannelCompat.Builder(
                CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
            .setName(name)
            .setDescription(payload.channelDescription)
            .build();
        NotificationManagerCompat.from(context).createNotificationChannel(channel);
    }

    static boolean canPost(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static void post(Context context, ReminderStore.Payload payload, ReminderStore.Entry entry) {
        if (!canPost(context)) return;
        ensureChannel(context, payload);
        // The lock screen shows only this: no company, no position.
        Notification publicVersion = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_deadline)
            .setColor(ACCENT)
            .setContentTitle(payload.publicText)
            .build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_deadline)
            .setColor(ACCENT)
            .setContentTitle(entry.title)
            .setContentText(entry.text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(entry.text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setContentIntent(openIntent(context, entry.recordId, IncomingIntents.OPEN_DETAIL));
        if (payload.openPageLabel != null && !payload.openPageLabel.isEmpty()) {
            builder.addAction(0, payload.openPageLabel, openIntent(context, entry.recordId, IncomingIntents.OPEN_REMINDER_PAGE));
        }
        try {
            // Tag = record id, id 1: a later reminder for the same record replaces the earlier one.
            NotificationManagerCompat.from(context).notify(entry.recordId, NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // Permission withdrawn between the check and the post.
        }
    }

    private static PendingIntent openIntent(Context context, String recordId, String open) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(IncomingIntents.ACTION_OPEN_APPLICATION)
            .putExtra(IncomingIntents.EXTRA_RECORD_ID, recordId)
            .putExtra(IncomingIntents.EXTRA_OPEN, open)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // Extras do not tell PendingIntents apart; the request code does, per record and per target.
        int code = ReminderMath.requestCode(recordId + ":" + open);
        return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
