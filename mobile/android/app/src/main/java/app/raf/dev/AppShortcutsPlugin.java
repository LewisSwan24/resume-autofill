package app.raf.dev;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Launcher shortcuts for applications: the dynamic "last application" and pinned ones per record. The launcher keeps
 * shortcut intents in plain text, so they carry a record id and what to open, never a URL or a name beyond the label.
 * A pinned shortcut of a deleted record is disabled (the launcher keeps it, greyed) and enabled again when the record
 * comes back. Rejects carry constant messages only; nothing is logged.
 */
@CapacitorPlugin(name = "AppShortcuts")
public class AppShortcutsPlugin extends Plugin {
    private static final int MAX_DYNAMIC = 4;
    private static final int MAX_LIVE = 5000;
    private static final int MAX_MESSAGE = 200;

    @PluginMethod
    public void sync(PluginCall call) {
        Context context = getContext();
        List<ShortcutInfoCompat> dynamic = new ArrayList<>();
        Set<String> live = new HashSet<>();
        String message = call.getString("disabledMessage");
        try {
            JSArray items = call.getArray("dynamic");
            JSArray ids = call.getArray("liveRecordIds");
            if (items == null || ids == null || items.length() > MAX_DYNAMIC || ids.length() > MAX_LIVE
                    || message == null || message.trim().isEmpty() || message.length() > MAX_MESSAGE) {
                call.reject("bad_args");
                return;
            }
            for (int i = 0; i < items.length(); i++) {
                ShortcutInfoCompat info = item(context, items.getJSONObject(i), true);
                if (info == null) {
                    call.reject("bad_args");
                    return;
                }
                dynamic.add(info);
            }
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                if (!IncomingIntents.validRecordId(id)) {
                    call.reject("bad_args");
                    return;
                }
                live.add(id);
            }
        } catch (JSONException e) {
            call.reject("bad_args");
            return;
        }
        try {
            if (dynamic.isEmpty()) ShortcutManagerCompat.removeAllDynamicShortcuts(context);
            else ShortcutManagerCompat.setDynamicShortcuts(context, dynamic);
            applyPinnedRules(context, live, message);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("failed");
        }
    }

    @PluginMethod
    public void canPin(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", ShortcutManagerCompat.isRequestPinShortcutSupported(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestPin(PluginCall call) {
        Context context = getContext();
        ShortcutInfoCompat info = item(context, call.getData(), false);
        if (info == null) {
            call.reject("bad_args");
            return;
        }
        boolean requested = false;
        try {
            requested = ShortcutManagerCompat.isRequestPinShortcutSupported(context)
                && ShortcutManagerCompat.requestPinShortcut(context, info, null);
        } catch (RuntimeException e) {
            requested = false;
        }
        JSObject result = new JSObject();
        result.put("requested", requested);
        call.resolve(result);
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        try {
            clearEverything(getContext());
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("failed");
        }
    }

    /** Delete all: no dynamic shortcut, and every pinned application shortcut disabled. */
    static void clearEverything(Context context) {
        ShortcutManagerCompat.removeAllDynamicShortcuts(context);
        applyPinnedRules(context, new HashSet<>(), context.getString(R.string.shortcut_deleted));
    }

    private static void applyPinnedRules(Context context, Set<String> live, String message) {
        List<ShortcutInfoCompat> pinned = ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED);
        Map<String, String> byId = new HashMap<>();
        Map<String, ShortcutInfoCompat> infos = new HashMap<>();
        for (ShortcutInfoCompat info : pinned) {
            String id = info.getId();
            infos.put(id, info);
            byId.put(id, id.startsWith(ShortcutRules.PINNED_PREFIX) ? id.substring(ShortcutRules.PINNED_PREFIX.length()) : null);
        }
        ShortcutRules.Plan plan = ShortcutRules.plan(byId, live);
        List<String> disable = new ArrayList<>();
        for (String id : plan.disable) if (infos.get(id).isEnabled()) disable.add(id);
        List<ShortcutInfoCompat> enable = new ArrayList<>();
        for (String id : plan.enable) if (!infos.get(id).isEnabled()) enable.add(infos.get(id));
        if (!disable.isEmpty()) ShortcutManagerCompat.disableShortcuts(context, disable, message);
        if (!enable.isEmpty()) ShortcutManagerCompat.enableShortcuts(context, enable);
    }

    /**
     * A shortcut from {id, recordId, shortLabel, longLabel}, or null when malformed. Dynamic: id "last-application";
     * pinned: id "app-<recordId>".
     */
    private static ShortcutInfoCompat item(Context context, JSONObject o, boolean dynamic) {
        if (o == null) return null;
        String id = o.optString("id", null);
        String recordId = o.optString("recordId", null);
        String shortLabel = ShortcutRules.clamp(o.optString("shortLabel", "").trim(), ShortcutRules.SHORT_LABEL);
        String longLabel = ShortcutRules.clamp(o.optString("longLabel", "").trim(), ShortcutRules.LONG_LABEL);
        if (!IncomingIntents.validRecordId(recordId) || shortLabel.isEmpty()) return null;
        String expected = dynamic ? ShortcutRules.DYNAMIC_ID : ShortcutRules.pinnedId(recordId);
        if (!expected.equals(id)) return null;
        Intent intent = new Intent(context, ShortcutActivity.class)
            .setAction(IncomingIntents.ACTION_OPEN_APPLICATION)
            .putExtra(IncomingIntents.EXTRA_RECORD_ID, recordId)
            .putExtra(IncomingIntents.EXTRA_OPEN, IncomingIntents.OPEN_PAGE);
        ShortcutInfoCompat.Builder builder = new ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(shortLabel)
            .setLongLabel(longLabel.isEmpty() ? shortLabel : longLabel)
            .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_application))
            .setIntent(intent);
        if (dynamic) builder.setRank(0);
        return builder.build();
    }
}
