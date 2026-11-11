package __PACKAGE__;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * "Download" inside the app. The WebView silently ignores <a download href="blob:..."> so exports and
 * report files never reached the phone. JS (src/native.js -> nativeSaveFile) sends the file as base64 and
 * this plugin:
 *   - Android 10+ : writes it to the public Downloads folder through MediaStore (no permission needed);
 *   - older       : writes it to the app cache and opens it through the FileProvider Capacitor already declares;
 *   - then (open=true) opens it in whatever viewer app is installed.
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {

    @PluginMethod
    public void save(final PluginCall call) {
        final String data = call.getString("data");
        if (data == null || data.isEmpty()) { call.reject("no_data"); return; }
        final String name = safeName(call.getString("filename", "download"));
        final String mime = call.getString("mimeType", "application/octet-stream");
        final boolean open = Boolean.TRUE.equals(call.getBoolean("open", false));

        getBridge().execute(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Context ctx = getContext();
                Uri uri;
                String where;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = ctx.getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new java.io.IOException("insert_failed");
                    try (OutputStream os = resolver.openOutputStream(uri)) {
                        if (os == null) throw new java.io.IOException("open_failed");
                        os.write(bytes);
                    }
                    where = "downloads";
                } else {
                    File dir = new File(ctx.getCacheDir(), "exports");
                    if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("mkdir_failed");
                    File file = new File(dir, name);
                    try (FileOutputStream fos = new FileOutputStream(file)) { fos.write(bytes); }
                    uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
                    where = "cache";
                }

                boolean opened = false;
                if (open || "cache".equals(where)) opened = view(uri, mime);

                JSObject res = new JSObject();
                res.put("uri", uri.toString());
                res.put("where", where);
                res.put("opened", opened);
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "save_failed" : e.getMessage());
            }
        });
    }


    /**
     * Chat media auto-save (like WhatsApp): streams a file straight from its URL into the phone's shared storage,
     * inside a folder called "UIP" of the matching gallery category:
     *   image -> Pictures/UIPE   video -> Movies/UIPE   audio -> Music/UIPE   anything else -> Documents/UIPE
     * Android 10+ : MediaStore (no permission, shows up in Gallery / Files). Android 9 and older: needs the storage
     * permission (asked once; the call rejects with "no_permission" so JS tries again later).
     * The download is streamed (never loaded into memory / JS), so big videos are fine.
     */
    @PluginMethod
    public void saveUrl(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("http")) { call.reject("bad_url"); return; }
        final String name = safeName(call.getString("filename", "file"));
        final String mime = call.getString("mimeType", "application/octet-stream");
        final String kind = call.getString("kind", "file");

        getBridge().execute(() -> {
            HttpURLConnection conn = null;
            Uri pending = null;
            ContentResolver resolver = getContext().getContentResolver();
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("X-UIP-Client", "android");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) throw new java.io.IOException("http_" + code);

                String folder;
                Uri collection;
                if ("image".equals(kind)) { folder = Environment.DIRECTORY_PICTURES; collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI; }
                else if ("video".equals(kind)) { folder = Environment.DIRECTORY_MOVIES; collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI; }
                else if ("audio".equals(kind)) { folder = Environment.DIRECTORY_MUSIC; collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI; }
                else { folder = Environment.DIRECTORY_DOCUMENTS; collection = MediaStore.Files.getContentUri("external"); }

                String where;
                String path;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder + "/UIPE");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    pending = resolver.insert(collection, values);
                    if (pending == null) throw new java.io.IOException("insert_failed");
                    try (InputStream in = conn.getInputStream(); OutputStream os = resolver.openOutputStream(pending)) {
                        if (os == null) throw new java.io.IOException("open_failed");
                        copy(in, os);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    resolver.update(pending, done, null, null);
                    where = folder + "/UIPE";
                    path = pending.toString();
                } else {
                    if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        if (getActivity() != null) ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 4711);
                        throw new java.io.IOException("no_permission");
                    }
                    File dir = new File(Environment.getExternalStoragePublicDirectory(folder), "UIPE");
                    if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("mkdir_failed");
                    File file = uniqueFile(dir, name);
                    try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(file)) { copy(in, fos); }
                    MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, new String[] { mime }, null);
                    where = folder + "/UIPE";
                    path = file.getAbsolutePath();
                }

                JSObject res = new JSObject();
                res.put("where", where);
                res.put("path", path);
                call.resolve(res);
            } catch (Exception e) {
                if (pending != null) { try { resolver.delete(pending, null, null); } catch (Exception ignored) { /* half-written entry */ } }
                call.reject(e.getMessage() == null ? "save_failed" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static void copy(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }


    // ---------------------------------------------------------------------------------------------------------
    // Chat media cache (WhatsApp-style): a received video is downloaded ONCE into the app's private storage
    // (files/media) and played from that local file afterwards - no re-download, instant start, works offline.
    // JS side: src/lib/mediaCache.js (uses Capacitor.convertFileSrc(path) as the <video> source).
    // ---------------------------------------------------------------------------------------------------------
    private static final long CACHE_MAX_BYTES = 1536L * 1024 * 1024;

    private File cacheFile(String key, String ext) {
        File dir = new File(getContext().getFilesDir(), "media");
        if (!dir.exists()) dir.mkdirs();
        String e = ext == null ? "" : ext.replaceAll("[^A-Za-z0-9]", "");
        if (e.length() > 6) e = "";
        return new File(dir, sha1(key) + (e.isEmpty() ? "" : "." + e));
    }

    private static String sha1(String s) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(s.hashCode());
        }
    }

    /** Where is this attachment on the phone already? { path: string|null } */
    @PluginMethod
    public void cachedPath(final PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.isEmpty()) { call.reject("bad_key"); return; }
        File f = cacheFile(key, call.getString("ext", ""));
        JSObject res = new JSObject();
        if (f.exists() && f.length() > 0) { f.setLastModified(System.currentTimeMillis()); res.put("path", f.getAbsolutePath()); }
        else res.put("path", JSONObject.NULL);
        call.resolve(res);
    }

    /** Downloads url into the cache (streamed, resumable-free but atomic: .part -> rename). Emits "cacheProgress". */
    @PluginMethod
    public void cacheUrl(final PluginCall call) {
        final String url = call.getString("url");
        final String key = call.getString("key");
        if (url == null || !url.startsWith("http") || key == null || key.isEmpty()) { call.reject("bad_url"); return; }
        final File target = cacheFile(key, call.getString("ext", ""));
        if (target.exists() && target.length() > 0) {
            JSObject res = new JSObject();
            res.put("path", target.getAbsolutePath());
            res.put("cached", true);
            call.resolve(res);
            return;
        }
        getBridge().execute(() -> {
            HttpURLConnection conn = null;
            File part = new File(target.getAbsolutePath() + ".part");
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("X-UIP-Client", "android");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) throw new java.io.IOException("http_" + code);
                final long total = conn.getContentLengthLong();
                long loaded = 0;
                long lastEmit = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        loaded += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 250) {
                            lastEmit = now;
                            JSObject ev = new JSObject();
                            ev.put("key", key);
                            ev.put("loaded", loaded);
                            ev.put("total", total);
                            notifyListeners("cacheProgress", ev);
                        }
                    }
                    fos.flush();
                }
                if (total > 0 && loaded < total) throw new java.io.IOException("incomplete");
                if (!part.renameTo(target)) throw new java.io.IOException("rename_failed");
                trimCache(target.getParentFile());
                JSObject res = new JSObject();
                res.put("path", target.getAbsolutePath());
                res.put("cached", false);
                call.resolve(res);
            } catch (Exception e) {
                if (part.exists()) part.delete();
                call.reject(e.getMessage() == null ? "cache_failed" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /** Frees the oldest cached files once the cache passes CACHE_MAX_BYTES. */
    private static void trimCache(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long sum = 0;
        for (File f : files) sum += f.length();
        if (sum <= CACHE_MAX_BYTES) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (sum <= CACHE_MAX_BYTES * 3 / 4) break;
            long len = f.length();
            if (f.delete()) sum -= len;
        }
    }

    /** Settings -> "clear media cache". */
    @PluginMethod
    public void clearCache(final PluginCall call) {
        File dir = new File(getContext().getFilesDir(), "media");
        File[] files = dir.listFiles();
        long freed = 0;
        if (files != null) for (File f : files) { long l = f.length(); if (f.delete()) freed += l; }
        JSObject res = new JSObject();
        res.put("freed", freed);
        call.resolve(res);
    }

    private boolean view(Uri uri, String mime) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    private static String safeName(String name) {
        String n = name == null ? "download" : name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        return n.isEmpty() ? "download" : n;
    }
}
