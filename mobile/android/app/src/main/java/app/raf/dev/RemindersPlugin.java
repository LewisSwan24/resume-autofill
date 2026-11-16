package app.raf.dev;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Deadline reminders: the notification permission, and the list of reminders the web UI planned and worded. sync()
 * replaces everything (ReminderScheduler.syncAll); the list is sealed in reminders.enc so alarms and the boot path work
 * without the UI. Input is checked and rejected with constant messages only; nothing is logged.
 */
@CapacitorPlugin(
    name = "Reminders",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public class RemindersPlugin extends Plugin {
    static final int MAX_ENTRIES = 1000;
    static final int MAX_TEXT = 200;
    private static final String ALIAS = "notifications";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void status(PluginCall call) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
        NotificationChannelCompat channel = manager.getNotificationChannelCompat(ReminderScheduler.CHANNEL_ID);
        JSObject result = new JSObject();
        result.put("permission", permission());
        result.put("enabled", manager.areNotificationsEnabled());
        result.put("channelBlocked", channel != null && channel.getImportance() == NotificationManagerCompat.IMPORTANCE_NONE);
        call.resolve(result);
    }

    /** Android 13+: the system prompt (when not answered for good). Below 13 there is no prompt: the current state. */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || "granted".equals(permission())) {
            permissionResult(call);
            return;
        }
        requestPermissionForAlias(ALIAS, call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("permission", permission());
        call.resolve(result);
    }

    private String permission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
        }
        PermissionState state = getPermissionState(ALIAS);
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    /** The app's notification settings, or its details page when a skin lacks the first. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        boolean opened = start(intent);
        if (!opened) {
            opened = start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.getPackageName(), null)));
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    private boolean start(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    @PluginMethod
    public void sync(PluginCall call) {
        final ReminderStore.Payload payload;
        try {
            payload = parse(call);
        } catch (JSONException | RuntimeException e) {
            call.reject("bad_args");
            return;
        }
        if (payload == null) {
            call.reject("bad_args");
            return;
        }
        final Context context = getContext().getApplicationContext();
        try {
            executor.execute(() -> {
                try {
                    JSObject result = new JSObject();
                    result.put("scheduled", ReminderScheduler.syncAll(context, payload));
                    call.resolve(result);
                } catch (Exception e) {
                    call.reject("sync_failed");
                }
            });
        } catch (RejectedExecutionException e) {
            call.reject("sync_failed");
        }
    }

    /** Cancel every alarm, delete reminders.enc and take down posted reminders. */
    @PluginMethod
    public void clear(PluginCall call) {
        final Context context = getContext().getApplicationContext();
        try {
            executor.execute(() -> {
                synchronized (ReminderScheduler.LOCK) {
                    ReminderScheduler.cancelAll(context);
                    ReminderStore.delete(context);
                }
                NotificationManagerCompat.from(context).cancelAll();
                if (ReminderStore.exists(context)) call.reject("clear_failed");
                else call.resolve();
            });
        } catch (RejectedExecutionException e) {
            call.reject("clear_failed");
        }
    }

    /** The payload, or null when anything is missing, too long or malformed. */
    private static ReminderStore.Payload parse(PluginCall call) throws JSONException {
        JSObject channel = call.getObject("channel");
        String publicText = call.getString("publicText");
        String openPageLabel = call.getString("openPageLabel");
        JSArray array = call.getArray("entries");
        if (channel == null || array == null || array.length() > MAX_ENTRIES) return null;
        String channelName = channel.getString("name");
        String channelDescription = channel.getString("description");
        if (!text(channelName, true) || !text(channelDescription, false) || !text(publicText, true)
                || !text(openPageLabel, true)) {
            return null;
        }
        List<ReminderStore.Entry> entries = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject o = array.getJSONObject(i);
            String id = o.optString("id", null);
            String recordId = o.optString("recordId", null);
            String at = o.optString("at", null);
            String end = o.optString("end", null);
            String title = o.optString("title", null);
            String body = o.optString("text", null);
            if (!ReminderMath.validId(id) || !IncomingIntents.validRecordId(recordId) || !id.startsWith(recordId + ":")
                    || !ReminderMath.validWall(at) || !ReminderMath.validWall(end)
                    || !text(title, true) || !text(body, false) || !ids.add(id)) {
                return null;
            }
            entries.add(new ReminderStore.Entry(id, recordId, at, end, title, body));
        }
        return new ReminderStore.Payload(channelName, channelDescription, publicText, openPageLabel, entries);
    }

    private static boolean text(String value, boolean required) {
        if (value == null) return false;
        if (required && value.trim().isEmpty()) return false;
        return value.length() <= MAX_TEXT;
    }
}
