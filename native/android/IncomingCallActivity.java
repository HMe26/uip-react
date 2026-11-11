package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen incoming-call screen (WhatsApp style): shows over the lock screen and wakes the display.
 * Launched by the call notification's full-screen intent, or directly when the app has the "display over other apps" permission.
 * Answer -> opens the app on the call; Decline -> silences it here. Closed automatically when the caller hangs up (call_cancel).
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
public class IncomingCallActivity extends Activity {

    static volatile IncomingCallActivity current;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int callId;
    private String link = "";

    /** Called when the call ends / is answered elsewhere: close the screen if it is showing this call. */
    static void dismiss(int callId) {
        final IncomingCallActivity a = current;
        if (a == null || (callId > 0 && a.callId != callId)) return;
        a.runOnUiThread(a::finishAndRemoveTask);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        current = this;
        build(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        build(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current == this) current = null;
        super.onDestroy();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private View circleButton(String glyph, String label, int color, View.OnClickListener l) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView c = new TextView(this);
        c.setText(glyph);
        c.setTextColor(Color.WHITE);
        c.setTextSize(30);
        c.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        c.setBackground(bg);
        c.setOnClickListener(l);
        col.addView(c, new LinearLayout.LayoutParams(dp(76), dp(76)));
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(0xFFDDE2FF);
        t.setTextSize(14);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(10), 0, 0);
        col.addView(t);
        return col;
    }

    private void build(Intent in) {
        callId = in.getIntExtra(UipMessagingService.EXTRA_CALL_ID, 0);
        link = in.getStringExtra(UipMessagingService.EXTRA_LINK);
        if (link == null) link = "";
        String name = in.getStringExtra("caller_name");
        boolean video = in.getBooleanExtra("video", false);
        boolean ar = in.getBooleanExtra("ar", true);
        long ringMs = in.getLongExtra("ring_ms", 45000L);
        if (name == null || name.trim().isEmpty()) name = ar ? "مكالمة واردة" : "Incoming call";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(24), dp(72), dp(24), dp(64));
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[]{0xFF141B45, 0xFF0A0E26});
        root.setBackground(bg);

        TextView app = new TextView(this);
        app.setText("UIP");
        app.setTextColor(0xFF8F9BFF);
        app.setTextSize(15);
        app.setTypeface(Typeface.DEFAULT_BOLD);
        app.setLetterSpacing(0.3f);
        root.addView(app);

        TextView status = new TextView(this);
        status.setText(video ? (ar ? "مكالمة فيديو واردة…" : "Incoming video call…") : (ar ? "مكالمة صوتية واردة…" : "Incoming voice call…"));
        status.setTextColor(0xFFB8C0F0);
        status.setTextSize(16);
        status.setPadding(0, dp(10), 0, 0);
        root.addView(status);

        View spacer1 = new View(this);
        root.addView(spacer1, new LinearLayout.LayoutParams(1, 0, 1f));

        TextView avatar = new TextView(this);
        String trimmed = name.trim();
        avatar.setText(trimmed.isEmpty() ? "?" : trimmed.substring(0, trimmed.offsetByCodePoints(0, 1)).toUpperCase());
        avatar.setTextColor(Color.WHITE);
        avatar.setTextSize(52);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable ab = new GradientDrawable();
        ab.setShape(GradientDrawable.OVAL);
        ab.setColor(0xFF4F5BE8);
        ab.setStroke(dp(4), 0x445F6CFF);
        avatar.setBackground(ab);
        root.addView(avatar, new LinearLayout.LayoutParams(dp(150), dp(150)));

        TextView nm = new TextView(this);
        nm.setText(name);
        nm.setTextColor(Color.WHITE);
        nm.setTextSize(30);
        nm.setTypeface(Typeface.DEFAULT_BOLD);
        nm.setGravity(Gravity.CENTER);
        nm.setPadding(0, dp(28), 0, 0);
        root.addView(nm);

        View spacer2 = new View(this);
        root.addView(spacer2, new LinearLayout.LayoutParams(1, 0, 1.4f));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        row.addView(circleButton("✕", ar ? "رفض" : "Decline", 0xFFE5484D, v -> {
            UipMessagingService.cancelCall(this, callId);
            finishAndRemoveTask();
        }), lp);
        row.addView(circleButton(video ? "▶" : "✆", ar ? "رد" : "Answer", 0xFF1FA855, v -> answer()), lp);
        root.addView(row, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::finishAndRemoveTask, Math.max(8000L, ringMs));
    }

    private void answer() {
        Intent open = new Intent(this, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(UipMessagingService.EXTRA_LINK, link);
        open.putExtra(UipMessagingService.EXTRA_CALL_ID, callId);
        open.putExtra(UipMessagingService.EXTRA_FROM_CALL, true);
        startActivity(open);
        UipMessagingService.cancelCall(this, callId);
        finishAndRemoveTask();
    }

    @Override
    public void onBackPressed() { /* a ringing call is answered or declined, not backed out of */ }
}
