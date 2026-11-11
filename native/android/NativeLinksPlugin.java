package __PACKAGE__;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.TimeUnit;

/**
 * Opens an otpauth:// link straight in the phone's authenticator app (Google Authenticator, Microsoft
 * Authenticator, Authy...). Capacitor's App.openUrl does not do this reliably (package-visibility rules on
 * Android 11+), so this fires the ACTION_VIEW intent directly and reports "no_app" only when Android really
 * has nothing that can handle it.
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(
    name = "NativeLinks",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location")
    }
)
public class NativeLinksPlugin extends Plugin {

    @PluginMethod
    public void openOtpAuth(final PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !uri.startsWith("otpauth://")) { call.reject("bad_uri"); return; }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no_app", "no_app");
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "failed" : e.getMessage());
        }
    }

    /** Opens this app's page in Android Settings (to switch on permissions the system dialog will no longer ask for). */
    @PluginMethod
    public void openAppSettings(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "failed" : e.getMessage());
        }
    }

    /**
     * Background delivery (so chat / notification pushes arrive with the app closed, like WhatsApp):
     * {ignoring:true} when Android's battery optimisation is already switched off for this app.
     */
    @PluginMethod
    public void batteryStatus(final PluginCall call) {
        JSObject r = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        r.put("ignoring", ignoring);
        call.resolve(r);
    }

    /** Shows Android's own "Allow this app to run in the background?" dialog (falls back to the battery settings list). */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject(e2.getMessage() == null ? "failed" : e2.getMessage());
            }
        }
    }

    /**
     * Xiaomi / Oppo / Realme / Vivo / Huawei / Samsung keep their own "auto-start / background" switch that kills closed apps
     * and blocks their pushes. Opens that screen when the phone has it, otherwise this app's settings page.
     */
    @PluginMethod
    public void openAutoStartSettings(final PluginCall call) {
        String[][] screens = new String[][] {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgauge.PowerUsageModelActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.hihonor.systemmanager", "com.hihonor.systemmanager.optimize.process.ProtectActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
            {"com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"},
        };
        for (String[] s : screens) {
            try {
                Intent intent = new Intent();
                intent.setComponent(new ComponentName(s[0], s[1]));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
                return;
            } catch (Exception ignored) { /* not this brand: try the next one */ }
        }
        openAppSettings(call);
    }

    /** Opens Android's "Location" switch (GPS on/off) for when the permission is granted but location services are turned off. */
    @PluginMethod
    public void openLocationSettings(final PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "failed" : e.getMessage());
        }
    }

    // ---- Location straight from Android's LocationManager (no Google Play Services / Fused provider needed) ----

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * getLocation({ mode: "fast" | "precise", timeout: ms })
     *  - fast: the newest last-known position (GPS / network / passive, up to 10 min old) at once; otherwise the first fresh fix.
     *  - precise: fresh GPS + network updates, answers as soon as one is accurate (~40 m) or with the best one when time is up.
     * Asks for the location permission itself. Rejects: "denied", "gps_off", "timeout".
     */
    @PluginMethod
    public void getLocation(final PluginCall call) {
        if (!hasLocationPermission()) {
            requestPermissionForAlias("location", call, "locationPermsCallback");
            return;
        }
        doLocation(call);
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (hasLocationPermission()) doLocation(call); else call.reject("denied", "denied");
    }

    private JSObject locationToJs(Location l) {
        JSObject r = new JSObject();
        r.put("lat", l.getLatitude());
        r.put("lng", l.getLongitude());
        r.put("accuracy", l.hasAccuracy() ? Math.round(l.getAccuracy()) : null);
        r.put("age_ms", Math.max(0L, System.currentTimeMillis() - l.getTime()));
        return r;
    }

    private void doLocation(final PluginCall call) {
        final LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) { call.reject("gps_off", "gps_off"); return; }
        final boolean precise = "precise".equals(call.getString("mode", "fast"));
        final long timeout = call.getInt("timeout", precise ? 30000 : 15000);

        if (!precise) {
            Location last = null;
            try {
                for (String p : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER }) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && System.currentTimeMillis() - l.getTime() < 10 * 60 * 1000L && (last == null || l.getTime() > last.getTime())) last = l;
                }
            } catch (SecurityException e) { call.reject("denied", "denied"); return; }
            if (last != null) { call.resolve(locationToJs(last)); return; }
        }

        final boolean gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        final boolean netOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gpsOn && !netOn) { call.reject("gps_off", "gps_off"); return; }

        final float goodAccuracy = precise ? 40f : 250f;
        final Handler handler = new Handler(Looper.getMainLooper());
        final Location[] best = new Location[1];
        final boolean[] done = new boolean[1];
        final LocationListener[] listener = new LocationListener[1];
        final Runnable[] finish = new Runnable[1];

        finish[0] = new Runnable() {
            @Override public void run() {
                if (done[0]) return;
                done[0] = true;
                handler.removeCallbacks(finish[0]);
                try { lm.removeUpdates(listener[0]); } catch (Exception ignored) { /* already removed */ }
                if (best[0] == null) call.reject("timeout", "timeout"); else call.resolve(locationToJs(best[0]));
            }
        };
        listener[0] = new LocationListener() {
            @Override public void onLocationChanged(Location l) {
                if (done[0] || l == null) return;
                if (best[0] == null || (l.hasAccuracy() && l.getAccuracy() < best[0].getAccuracy())) best[0] = l;
                if (l.hasAccuracy() && l.getAccuracy() <= goodAccuracy) finish[0].run();
            }
            public void onStatusChanged(String provider, int status, Bundle extras) { /* deprecated, unused */ }
            public void onProviderEnabled(String provider) { /* unused */ }
            public void onProviderDisabled(String provider) { /* unused */ }
        };

        try {
            if (gpsOn) lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener[0], Looper.getMainLooper());
            if (netOn) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener[0], Looper.getMainLooper());
        } catch (SecurityException e) {
            done[0] = true;
            call.reject("denied", "denied");
            return;
        } catch (Exception e) {
            done[0] = true;
            call.reject("gps_off", "gps_off");
            return;
        }
        handler.postDelayed(finish[0], timeout);
    }

    /** Link / call of the notification that launched (or re-focused) the app: read once, then cleared. */
    @PluginMethod
    public void consumeLaunch(final PluginCall call) {
        JSObject r = new JSObject();
        r.put("link", MainActivity.pendingLink == null ? "" : MainActivity.pendingLink);
        r.put("call_id", MainActivity.pendingCallId);
        MainActivity.pendingLink = null;
        MainActivity.pendingCallId = 0;
        call.resolve(r);
    }

    /**
     * FCM token straight from Firebase (does not depend on the Capacitor push plugin's events) + the exact reason when it fails.
     * Resolves { token } or rejects with a readable reason, e.g. "firebase_not_initialized" (google-services.json not applied to
     * this build), "SERVICE_NOT_AVAILABLE" (no Google Play services / no network), "INVALID_SENDER"... Also logged under tag UIP-PUSH.
     */
    @PluginMethod
    public void getPushToken(final PluginCall call) {
        final Context ctx = getContext();
        new Thread(() -> {
            try {
                if (FirebaseApp.getApps(ctx).isEmpty()) {
                    android.util.Log.e("UIP-PUSH", "FirebaseApp is NOT initialised: google-services.json was not applied to this build");
                    call.reject("firebase_not_initialized", "firebase_not_initialized");
                    return;
                }
                String t = Tasks.await(FirebaseMessaging.getInstance().getToken(), 20, TimeUnit.SECONDS);
                android.util.Log.i("UIP-PUSH", "FCM token OK (" + (t == null ? 0 : t.length()) + " chars)");
                JSObject r = new JSObject();
                r.put("token", t == null ? "" : t);
                call.resolve(r);
            } catch (Throwable e) {
                Throwable c = e.getCause() != null ? e.getCause() : e;
                String m = c.getClass().getSimpleName() + ": " + c.getMessage();
                android.util.Log.e("UIP-PUSH", "FCM token FAILED: " + m, e);
                call.reject(m, m);
            }
        }, "uip-fcm-token").start();
    }

    /** Can the app open the call screen over other apps / the lock screen? { fsi: full-screen-intent allowed (Android 14+), overlay: "display over other apps" } */
    @PluginMethod
    public void callScreenStatus(final PluginCall call) {
        boolean fsi = true;
        boolean overlay = true;
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                fsi = nm == null || nm.canUseFullScreenIntent();
            }
            if (Build.VERSION.SDK_INT >= 23) overlay = Settings.canDrawOverlays(getContext());
        } catch (Throwable ignored) { /* assume allowed */ }
        JSObject r = new JSObject();
        r.put("fsi", fsi);
        r.put("overlay", overlay);
        call.resolve(r);
    }

    /** Opens the exact Settings page for the call screen: kind = "fsi" (full-screen notifications) or "overlay" (display over other apps). */
    @PluginMethod
    public void openCallScreenSettings(final PluginCall call) {
        String kind = call.getString("kind", "overlay");
        try {
            Intent intent;
            Uri pkg = Uri.parse("package:" + getContext().getPackageName());
            if ("fsi".equals(kind) && Build.VERSION.SDK_INT >= 34) intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg);
            else intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            openAppSettings(call);
        }
    }
}
