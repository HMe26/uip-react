package __PACKAGE__;

import android.app.Activity;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/**
 * Tells the web side when the user takes a screenshot (Android 14+) or starts a screen recording that shows this app
 * (Android 15+), so a meeting / call can warn the other people. Started by src/lib/captureGuard.js only while a meeting
 * or call is open. Both Android APIs are reached by reflection so the project still compiles with an older compileSdk.
 * Needs android.permission.DETECT_SCREEN_CAPTURE / DETECT_SCREEN_RECORDING (added by scripts/patch-android.mjs).
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {

    private Object shotCallback;
    private Consumer<Integer> recordingCallback;

    @PluginMethod
    public void start(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> { startScreenshot(activity); startRecording(activity); });
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(() -> stopAll(activity));
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopAll(getActivity());
    }

    private void startScreenshot(Activity activity) {
        if (Build.VERSION.SDK_INT < 34 || shotCallback != null) return;
        try {
            Class<?> cbClass = Class.forName("android.app.Activity$ScreenCaptureCallback");
            Object proxy = Proxy.newProxyInstance(cbClass.getClassLoader(), new Class<?>[]{cbClass}, (p, m, args) -> {
                switch (m.getName()) {
                    case "onScreenCaptured": notifyListeners("screenshot", new JSObject()); return null;
                    case "hashCode": return System.identityHashCode(p);
                    case "equals": return args != null && args.length > 0 && p == args[0];
                    case "toString": return "ScreenCaptureCallback";
                    default: return null;
                }
            });
            Method register = Activity.class.getMethod("registerScreenCaptureCallback", Executor.class, cbClass);
            register.invoke(activity, activity.getMainExecutor(), proxy);
            shotCallback = proxy;
        } catch (Throwable ignored) { /* permission missing or API not available: no screenshot warning */ }
    }

    private void startRecording(Activity activity) {
        if (Build.VERSION.SDK_INT < 35 || recordingCallback != null) return;
        try {
            Consumer<Integer> cb = state -> {
                if (state != null && state == 1) notifyListeners("recording", new JSObject()); // SCREEN_RECORDING_STATE_VISIBLE
            };
            Method add = android.view.WindowManager.class.getMethod("addScreenRecordingCallback", Executor.class, Consumer.class);
            add.invoke(activity.getWindowManager(), activity.getMainExecutor(), cb);
            recordingCallback = cb;
        } catch (Throwable ignored) { /* permission missing or API not available: no recording warning */ }
    }

    private void stopAll(Activity activity) {
        if (activity == null) return;
        try {
            if (shotCallback != null) {
                Class<?> cbClass = Class.forName("android.app.Activity$ScreenCaptureCallback");
                Activity.class.getMethod("unregisterScreenCaptureCallback", cbClass).invoke(activity, shotCallback);
            }
        } catch (Throwable ignored) { /* ignore */ }
        shotCallback = null;
        try {
            if (recordingCallback != null) {
                android.view.WindowManager.class.getMethod("removeScreenRecordingCallback", Consumer.class)
                        .invoke(activity.getWindowManager(), recordingCallback);
            }
        } catch (Throwable ignored) { /* ignore */ }
        recordingCallback = null;
    }
}
