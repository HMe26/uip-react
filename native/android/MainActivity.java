package __PACKAGE__;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Set when the app is opened from our own (call) notification; the web layer reads it via NativeLinks.consumeLaunch(). */
    public static volatile String pendingLink = null;
    public static volatile int pendingCallId = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExamLockPlugin.class); // must be before super.onCreate
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(NativeLinksPlugin.class);
        registerPlugin(NativeFilesPlugin.class);
        registerPlugin(NativeGalleryPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            android.util.Log.i("UIP-PUSH", "FirebaseApp initialised: " + !com.google.firebase.FirebaseApp.getApps(this).isEmpty());
        } catch (Throwable t) { android.util.Log.e("UIP-PUSH", "firebase check failed", t); }
        UipMessagingService.ensureChannels(this); // channels exist before the first push, even if the web layer never ran
        handleLaunch(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleLaunch(intent);
        try {
            // app already running: tell the web layer right away
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('uip:native-launch'))", null));
        } catch (Exception ignored) { /* web layer not ready: it reads the pending link on start */ }
    }

    private void handleLaunch(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(UipMessagingService.EXTRA_FROM_CALL, false)) return;
        pendingLink = intent.getStringExtra(UipMessagingService.EXTRA_LINK);
        pendingCallId = intent.getIntExtra(UipMessagingService.EXTRA_CALL_ID, 0);
        // ringing call: show over the lock screen and wake the display
        try {
            if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        } catch (Exception ignored) { /* ignore */ }
        UipMessagingService.cancelCall(this, pendingCallId);
    }

    /** Pulling down the notification shade (or any system dialog) steals focus; hide the bars again when it comes back. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && ExamLockPlugin.active) ExamLockPlugin.applyImmersive(this);
    }
}
