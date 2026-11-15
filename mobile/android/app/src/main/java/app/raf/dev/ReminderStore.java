package app.raf.dev;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The deadline reminders the web UI handed over, sealed in {@code files/reminders.enc} with {@link VaultCrypto} (same
 * Keystore key as the profile). The words in it (titles, texts, the channel name) were rendered by the web UI in the
 * person's language; native code only posts them. Read by the alarm receiver and the boot path without the UI.
 *
 * JSON: {"v":1, "channel":{name, description}, "publicText", "openPageLabel", "entries":[{id, recordId, at, end,
 * title, text}]}; {@code at} and {@code end} are local wall-clock times "YYYY-MM-DDTHH:MM".
 */
final class ReminderStore {
    static final String FILE_NAME = "reminders.enc";
    private static final int VERSION = 1;

    static final class Entry {
        final String id;
        final String recordId;
        final String at;
        final String end;
        final String title;
        final String text;

        Entry(String id, String recordId, String at, String end, String title, String text) {
            this.id = id;
            this.recordId = recordId;
            this.at = at;
            this.end = end;
            this.title = title;
            this.text = text;
        }
    }

    static final class Payload {
        final String channelName;
        final String channelDescription;
        final String publicText;
        final String openPageLabel;
        final List<Entry> entries;

        Payload(String channelName, String channelDescription, String publicText, String openPageLabel, List<Entry> entries) {
            this.channelName = channelName;
            this.channelDescription = channelDescription;
            this.publicText = publicText;
            this.openPageLabel = openPageLabel;
            this.entries = entries;
        }

        Payload withEntries(List<Entry> next) {
            return new Payload(channelName, channelDescription, publicText, openPageLabel, next);
        }

        Entry find(String id) {
            for (Entry e : entries) if (e.id.equals(id)) return e;
            return null;
        }
    }

    private ReminderStore() {}

    static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    /** The stored reminders, or null when there are none or the file cannot be opened (then nothing fires). */
    static Payload read(Context context) {
        try {
            byte[] data = VaultCrypto.readSealed(file(context));
            return data == null ? null : fromJson(new String(data, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    /** An empty list deletes the file: nothing about reminders stays on disk once none are left. */
    static void write(Context context, Payload payload) throws Exception {
        if (payload.entries.isEmpty()) {
            delete(context);
            return;
        }
        VaultCrypto.writeSealed(file(context), toJson(payload).getBytes(StandardCharsets.UTF_8));
    }

    static void delete(Context context) {
        VaultCrypto.deleteSealed(file(context));
    }

    static boolean exists(Context context) {
        return VaultCrypto.sealedExists(file(context));
    }

    static String toJson(Payload p) throws JSONException {
        JSONObject channel = new JSONObject();
        channel.put("name", p.channelName);
        channel.put("description", p.channelDescription);
        JSONArray entries = new JSONArray();
        for (Entry e : p.entries) {
            JSONObject o = new JSONObject();
            o.put("id", e.id);
            o.put("recordId", e.recordId);
            o.put("at", e.at);
            o.put("end", e.end);
            o.put("title", e.title);
            o.put("text", e.text);
            entries.put(o);
        }
        JSONObject root = new JSONObject();
        root.put("v", VERSION);
        root.put("channel", channel);
        root.put("publicText", p.publicText);
        root.put("openPageLabel", p.openPageLabel);
        root.put("entries", entries);
        return root.toString();
    }

    /** Entries that are not well formed are left out, so a bad one can never be scheduled. */
    static Payload fromJson(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        if (root.optInt("v") != VERSION) return null;
        JSONObject channel = root.getJSONObject("channel");
        JSONArray array = root.getJSONArray("entries");
        List<Entry> entries = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject o = array.getJSONObject(i);
            Entry e = new Entry(
                o.optString("id"), o.optString("recordId"), o.optString("at"), o.optString("end"),
                o.optString("title"), o.optString("text"));
            if (ReminderMath.validId(e.id) && IncomingIntents.validRecordId(e.recordId)
                    && ReminderMath.validWall(e.at) && ReminderMath.validWall(e.end)) {
                entries.add(e);
            }
        }
        return new Payload(channel.optString("name"), channel.optString("description"), root.optString("publicText"),
            root.optString("openPageLabel"), entries);
    }
}
