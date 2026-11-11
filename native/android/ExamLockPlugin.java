package __PACKAGE__;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exam mode for the UIP app (switched on by src/native.js while an exam attempt is in progress):
 *  - immersive full screen: status bar + the 3 navigation buttons are hidden;
 *  - screen pinning (startLockTask): Home / Recents are disabled and the notification shade cannot be
 *    pulled down. Android asks the student once to confirm "screen pinning". Un-pinning (long-press
 *    Back + Overview, or the gesture equivalent) is detected by the web side and reported as a violation;
 *  - screen stays on while the exam is open.
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(name = "ExamLock")
public class ExamLockPlugin extends Plugin {

    /** True while an exam attempt is open. MainActivity re-applies immersive mode whenever the window regains focus. */
    static volatile boolean active = false;

    static void applyImmersive(Activity activity) {
        if (activity == null) return;
        Window window = activity.getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return;
        // a swipe from the edge only shows the bars for a moment, then they hide again by themselves
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    static void clearImmersive(Activity activity) {
        if (activity == null) return;
        Window window = activity.getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) controller.show(WindowInsetsCompat.Type.systemBars());
    }

    static boolean isPinned(Activity activity) {
        if (activity == null) return false;
        ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    private JSObject state(Activity activity) {
        JSObject ret = new JSObject();
        ret.put("active", active);
        ret.put("pinned", isPinned(activity));
        return ret;
    }

    @PluginMethod
    public void enable(final PluginCall call) {
        final Activity activity = getActivity();
        active = true;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                applyImmersive(activity);
                try {
                    if (!isPinned(activity)) activity.startLockTask();
                } catch (Exception ignored) {
                    // pinning refused by the device: immersive mode still applies
                }
                call.resolve(state(activity));
            }
        });
    }

    @PluginMethod
    public void disable(final PluginCall call) {
        final Activity activity = getActivity();
        active = false;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (isPinned(activity)) activity.stopLockTask();
                } catch (Exception ignored) { }
                clearImmersive(activity);
                call.resolve(state(activity));
            }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state(getActivity()));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (active) {
            final Activity activity = getActivity();
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() { applyImmersive(activity); }
            });
        }
    }
}
