package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives FCM messages while the app is closed / in the background.
 *  - data-only "incoming_call"  -> a full-screen, ringing, WhatsApp-style call notification (works on the lock screen).
 *  - data-only "call_cancel"    -> removes that notification (answered elsewhere / caller hung up / missed).
 *  - everything else (chat messages, alerts, ...) -> handed to Capacitor's own MessagingService (same behaviour as before).
 * Registered in AndroidManifest.xml with a higher priority than Capacitor's service by scripts/patch-android.mjs.
 * Generated into android/ - do not edit the copy inside android/.
 */
public class UipMessagingService extends MessagingService {

    static final String CH_MESSAGES = "uip";
    static final String CH_ALERTS = "uip-alerts";
    static final String CH_CALLS = "uip-calls";
    static final String CALL_TAG = "uip-call";

    static final String EXTRA_LINK = "uip_link";
    static final String EXTRA_CALL_ID = "uip_call_id";
    static final String EXTRA_FROM_CALL = "uip_from_call";
    static final String ACTION_DISMISS = "__PACKAGE__.CALL_DISMISS";

    @Override
    public void onNewToken(@NonNull String token) {
        android.util.Log.i("UIP-PUSH", "onNewToken (" + token.length() + " chars)");
        super.onNewToken(token); // Capacitor forwards it to the web layer's 'registration' listener when the app is running
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        android.util.Log.i("UIP-PUSH", "message received type=" + (message.getData() == null ? null : message.getData().get("type")));
        Map<String, String> d = message.getData();
        String type = d == null ? null : d.get("type");
        try {
            if ("incoming_call".equals(type)) { showIncomingCall(this, d); return; }
            if ("call_cancel".equals(type)) { cancelCall(this, parseInt(d.get("call_id"))); return; }
        } catch (Exception ignored) { /* fall through to the default handling */ }
        super.onMessageReceived(message);
    }

    // ------------------------------------------------------------------ channels

    /** Creates the notification channels (idempotent). Called from MainActivity too, so they exist before the first push. */
    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            NotificationChannel msg = new NotificationChannel(CH_MESSAGES, "UIPE", NotificationManager.IMPORTANCE_HIGH);
            msg.setDescription("UIPE notifications");
            msg.enableVibration(true);
            msg.enableLights(true);
            msg.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(msg);

            NotificationChannel alerts = new NotificationChannel(CH_ALERTS, "App alerts", NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("App failures reported to admins");
            alerts.enableVibration(true);
            alerts.enableLights(true);
            alerts.setLightColor(0xFFE5484D);
            alerts.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(alerts);

            if (nm.getNotificationChannel(CH_CALLS) == null) {
                NotificationChannel calls = new NotificationChannel(CH_CALLS, "Calls / المكالمات", NotificationManager.IMPORTANCE_HIGH);
                calls.setDescription("Incoming calls");
                Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                calls.setSound(ring, attrs);
                calls.enableVibration(true);
                calls.setVibrationPattern(new long[]{0, 900, 700, 900, 700, 900, 700});
                calls.enableLights(true);
                calls.setLightColor(0xFF1FA855);
                calls.setBypassDnd(false);
                calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(calls);
            }
        } catch (Exception ignored) { /* never crash the app because of a channel */ }
    }

    // ------------------------------------------------------------------ incoming call

    static int notificationId(int callId) {
        return 7000000 + (callId & 0xFFFFF);
    }

    static int parseInt(String s) {
        try { return Integer.parseInt(s == null ? "0" : s.trim()); } catch (Exception e) { return 0; }
    }

    static void showIncomingCall(Context ctx, Map<String, String> d) {
        ensureChannels(ctx);
        int callId = parseInt(d.get("call_id"));
        String name = d.get("caller_name") == null ? "" : d.get("caller_name");
        boolean ar = !"en".equals(d.get("lang"));
        boolean video = "video".equals(d.get("call_type"));
        String link = d.get("link_url") == null ? "" : d.get("link_url");
        long ringMs = Math.max(8, Math.min(120, parseInt(d.get("ring_seconds")))) * 1000L;

        String title = name.isEmpty() ? (ar ? "مكالمة واردة" : "Incoming call") : name;
        String text = video ? (ar ? "مكالمة فيديو واردة…" : "Incoming video call…") : (ar ? "مكالمة صوتية واردة…" : "Incoming voice call…");

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(EXTRA_LINK, link);
        open.putExtra(EXTRA_CALL_ID, callId);
        open.putExtra(EXTRA_FROM_CALL, true);
        PendingIntent openPi = PendingIntent.getActivity(ctx, notificationId(callId), open, flags);

        Intent dismiss = new Intent(ctx, UipCallActionReceiver.class);
        dismiss.setAction(ACTION_DISMISS);
        dismiss.putExtra(EXTRA_CALL_ID, callId);
        PendingIntent dismissPi = PendingIntent.getBroadcast(ctx, notificationId(callId) + 1, dismiss, flags);

        int icon = ctx.getResources().getIdentifier("ic_stat_uip", "drawable", ctx.getPackageName());
        if (icon == 0) icon = ctx.getApplicationInfo().icon;

        // Full-screen call screen (over the lock screen). Its extras carry everything it shows.
        Intent screen = new Intent(ctx, IncomingCallActivity.class);
        screen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        screen.putExtra(EXTRA_LINK, link);
        screen.putExtra(EXTRA_CALL_ID, callId);
        screen.putExtra("caller_name", name);
        screen.putExtra("video", video);
        screen.putExtra("ar", ar);
        screen.putExtra("ring_ms", ringMs);
        PendingIntent screenPi = PendingIntent.getActivity(ctx, notificationId(callId) + 2, screen, flags);

        Notification n = null;
        try {
            // Android's own call notification: avatar, green Answer / red Decline buttons (needs a full-screen intent, which we set).
            androidx.core.app.Person caller = new androidx.core.app.Person.Builder().setName(title).setImportant(true).build();
            NotificationCompat.Builder cs = new NotificationCompat.Builder(ctx, CH_CALLS)
                    .setSmallIcon(icon)
                    .setColor(0xFF1FA855)
                    .setContentText(text)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setOngoing(true)
                    .setTimeoutAfter(ringMs)
                    .setContentIntent(screenPi)
                    .setFullScreenIntent(screenPi, true)
                    .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, dismissPi, openPi));
            n = cs.build();
        } catch (Throwable ignored) { n = null; }
        if (n == null) {
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_CALLS)
                    .setSmallIcon(icon)
                    .setColor(0xFF1FA855)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setOngoing(true)
                    .setAutoCancel(true)
                    .setTimeoutAfter(ringMs)
                    .setContentIntent(screenPi)
                    .setFullScreenIntent(screenPi, true)
                    .addAction(0, ar ? "رد" : "Answer", openPi)
                    .addAction(0, ar ? "تجاهل" : "Dismiss", dismissPi);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), android.media.AudioManager.STREAM_RING);
                b.setVibrate(new long[]{0, 900, 700, 900, 700});
            }
            n = b.build();
        }
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered / dismissed / timed out

        try {
            NotificationManagerCompat.from(ctx).notify(CALL_TAG, notificationId(callId), n);
        } catch (SecurityException ignored) { /* notifications permission not granted */ }

        // With "display over other apps" granted, Android lets us open the call screen straight away even with the phone unlocked.
        try {
            if (Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(ctx)) ctx.startActivity(screen);
        } catch (Throwable e) { android.util.Log.w("UIP-PUSH", "direct call screen not allowed: " + e.getMessage()); }
    }

    static void cancelCall(Context ctx, int callId) {
        try {
            if (callId > 0) NotificationManagerCompat.from(ctx).cancel(CALL_TAG, notificationId(callId));
            IncomingCallActivity.dismiss(callId);
        } catch (Exception ignored) { /* ignore */ }
    }
}
