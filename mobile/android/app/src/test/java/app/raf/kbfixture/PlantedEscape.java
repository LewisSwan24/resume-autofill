package app.raf.kbfixture;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.lang.invoke.MethodHandles;

import org.json.JSONObject;

import app.raf.other.Courier;

/**
 * Never used: the second planted class for KeyboardNoNetworkTest. It sits outside
 * app/raf/dev/ and reaches out of the process in ways the first fixture does not: a third-party class, another app
 * package, broadcasts and services other than sendBroadcast, an intent parsed from a string, a pending intent, method
 * handles and an inlined share action.
 */
public final class PlantedEscape {
    private PlantedEscape() {}

    static Object run(Context context, String typed) throws Exception {
        Courier.carry(typed);
        context.sendOrderedBroadcast(new Intent("x"), null);
        context.startService(new Intent("x"));
        context.startActivity(Intent.parseUri(typed, 0));
        context.startActivity(new Intent(Intent.ACTION_SEND).putExtra("t", typed));
        Object handle = MethodHandles.lookup();
        PendingIntent pending = null;
        return new JSONObject().put("t", typed).toString() + handle + pending;
    }
}
