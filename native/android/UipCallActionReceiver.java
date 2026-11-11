package __PACKAGE__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * "Dismiss" button of the incoming-call notification: silences the ring on this phone.
 * (The caller keeps ringing until the call times out or is answered/declined from the app.)
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
public class UipCallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        UipMessagingService.cancelCall(context, intent.getIntExtra(UipMessagingService.EXTRA_CALL_ID, 0));
    }
}
