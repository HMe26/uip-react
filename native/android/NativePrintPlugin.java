package __PACKAGE__;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * window.print() is a no-op inside an Android WebView. This opens the system print dialog
 * (print / "Save as PDF") for the current page, rendered with its @media print CSS.
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    @PluginMethod
    public void print(final PluginCall call) {
        final String name = call.getString("name", "UIP");
        final boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (webView == null || pm == null) { call.reject("print unavailable"); return; }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                PrintAttributes.MediaSize size = landscape
                    ? PrintAttributes.MediaSize.ISO_A4.asLandscape()
                    : PrintAttributes.MediaSize.ISO_A4;
                pm.print(name, adapter, new PrintAttributes.Builder().setMediaSize(size).build());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }
}
