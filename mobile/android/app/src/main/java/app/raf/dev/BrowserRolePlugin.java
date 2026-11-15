package app.raf.dev;

import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The browser role. The app is a browser candidate (its VIEW http/https filter) but never asks for the role by itself:
 * request() runs only from a button in Settings. openInOtherBrowser() hands a page to another browser, never back to
 * this app. Nothing is logged; rejects carry constant messages only.
 */
@CapacitorPlugin(name = "BrowserRole")
public class BrowserRolePlugin extends Plugin {
    private static final int MAX_URL = 2048;
    private static final int MAX_TITLE = 100;

    @PluginMethod
    public void state(PluginCall call) {
        RoleManager roles = getContext().getSystemService(RoleManager.class);
        boolean available = roles != null && roles.isRoleAvailable(RoleManager.ROLE_BROWSER);
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("held", available && roles.isRoleHeld(RoleManager.ROLE_BROWSER));
        call.resolve(result);
    }

    @PluginMethod
    public void request(PluginCall call) {
        RoleManager roles = getContext().getSystemService(RoleManager.class);
        if (roles == null || !roles.isRoleAvailable(RoleManager.ROLE_BROWSER) || roles.isRoleHeld(RoleManager.ROLE_BROWSER)) {
            resolveHeld(call, roles);
            return;
        }
        try {
            startActivityForResult(call, roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER), "roleResult");
        } catch (ActivityNotFoundException e) {
            resolveHeld(call, roles);
        }
    }

    @ActivityCallback
    private void roleResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        resolveHeld(call, getContext().getSystemService(RoleManager.class));
    }

    private static void resolveHeld(PluginCall call, RoleManager roles) {
        JSObject result = new JSObject();
        result.put("held", roles != null && roles.isRoleAvailable(RoleManager.ROLE_BROWSER)
            && roles.isRoleHeld(RoleManager.ROLE_BROWSER));
        call.resolve(result);
    }

    @PluginMethod
    public void openDefaultAppsSettings(PluginCall call) {
        boolean opened = start(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            || start(new Intent(Settings.ACTION_SETTINGS));
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    @PluginMethod
    public void openInOtherBrowser(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        JSObject result = new JSObject();
        Uri uri = webUri(url);
        if (uri == null) {
            result.put("opened", false);
            result.put("reason", "bad_url");
            call.resolve(result);
            return;
        }
        Context context = getContext();
        Intent view = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        Set<String> others = otherBrowsers(context, view);
        if (others.isEmpty()) {
            result.put("opened", false);
            result.put("reason", "none");
            call.resolve(result);
            return;
        }
        Intent launch;
        if (others.size() == 1) {
            launch = view.setPackage(others.iterator().next());
        } else {
            String chooserTitle = title == null ? "" : IncomingIntents.cutCodePoints(title.trim(), MAX_TITLE);
            launch = Intent.createChooser(view, chooserTitle.isEmpty() ? null : chooserTitle);
            launch.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS,
                new ComponentName[] { new ComponentName(context, MainActivity.class) });
        }
        result.put("opened", start(launch));
        call.resolve(result);
    }

    /** http(s) only, at most MAX_URL characters, with a host. */
    private static Uri webUri(String url) {
        if (url == null || url.length() > MAX_URL) return null;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        return uri;
    }

    /** Packages that open web links, minus this one. */
    @SuppressWarnings("deprecation")
    private static Set<String> otherBrowsers(Context context, Intent view) {
        Set<String> packages = new LinkedHashSet<>();
        List<ResolveInfo> found = context.getPackageManager().queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo info : found) {
            if (info.activityInfo == null) continue;
            String pkg = info.activityInfo.packageName;
            if (!context.getPackageName().equals(pkg)) packages.add(pkg);
        }
        return packages;
    }

    private boolean start(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }
}
