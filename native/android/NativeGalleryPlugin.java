package __PACKAGE__;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Size;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * The phone's photo / video gallery inside the chat attachment sheet (WhatsApp style).
 *
 *  access() / requestAccess() / openSettings()  READ_MEDIA_* (Android 13+, incl. "selected photos only" on 14+) or READ_EXTERNAL_STORAGE
 *  albums()                                     Recents, Videos and every folder (Camera, Screenshots, WhatsApp ...) with counts + cover
 *  list({album, offset, limit})                 newest first, paged, so 4,000 photos never load at once
 *  thumb({id, kind, size})                      small JPEG in the app cache, shown through Capacitor's local server
 *  prepare({items, hd})                         THE speed trick: every picked photo is decoded with sub-sampling, rotated, shrunk (1920 px,
 *                                               4096 px in HD) and re-encoded natively - 3 files at the same time - so a 6 MB camera photo
 *                                               becomes ~300 KB before it ever touches the network. Videos are copied as they are.
 *  release({paths})                             deletes the temporary files once JS has read them
 *
 * Generated into android/ by scripts/patch-android.mjs - do not edit the copy inside android/.
 */
@CapacitorPlugin(
    name = "NativeGallery",
    permissions = {
        @Permission(alias = "media33", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }),
        @Permission(alias = "media32", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class NativeGalleryPlugin extends Plugin {

    private static final ExecutorService POOL = Executors.newFixedThreadPool(3);
    private static final String PREFS = "uip_gallery";
    private static final String VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"; // API 34

    // ------------------------------------------------------------------ permission

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED;
    }

    private String accessState() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (granted(Manifest.permission.READ_MEDIA_IMAGES) || granted(Manifest.permission.READ_MEDIA_VIDEO)) return "granted";
            if (Build.VERSION.SDK_INT >= 34 && granted(VISUAL_USER_SELECTED)) return "limited";
        } else if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) {
            return "granted";
        }
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("asked", false) ? "denied" : "prompt";
    }

    private JSObject stateObj() {
        JSObject o = new JSObject();
        o.put("state", accessState());
        return o;
    }

    @PluginMethod
    public void access(PluginCall call) {
        call.resolve(stateObj());
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        // "limited" is asked again on purpose: Android 14 then lets the person pick more photos.
        if ("granted".equals(accessState())) { call.resolve(stateObj()); return; }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked", true).apply();
        requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "media33" : "media32", call, "accessDone");
    }

    @PermissionCallback
    private void accessDone(PluginCall call) {
        call.resolve(stateObj());
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("settings_failed");
        }
    }

    // ------------------------------------------------------------------ albums + listing

    private static Uri filesUri() {
        return MediaStore.Files.getContentUri("external");
    }

    private static Uri itemUri(String kind, long id) {
        Uri base = "video".equals(kind) ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        return ContentUris.withAppendedId(base, id);
    }

    private static final String TYPES = MediaStore.Files.FileColumns.MEDIA_TYPE + " IN (" + MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE + "," + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO + ")";

    @PluginMethod
    public void albums(final PluginCall call) {
        POOL.execute(() -> {
            try {
                if ("denied".equals(accessState()) || "prompt".equals(accessState())) { call.reject("no_access"); return; }
                ContentResolver cr = getContext().getContentResolver();
                String[] proj = {
                    MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE,
                    MediaStore.Files.FileColumns.BUCKET_ID, MediaStore.Files.FileColumns.BUCKET_DISPLAY_NAME,
                };
                Map<String, long[]> counts = new LinkedHashMap<>();   // bucket -> [count, coverId, coverIsVideo]
                Map<String, String> names = new LinkedHashMap<>();
                long total = 0, videos = 0, allCover = 0, vidCover = 0;
                int allCoverKind = 0;
                try (Cursor c = cr.query(filesUri(), proj, TYPES, null, MediaStore.Files.FileColumns.DATE_ADDED + " DESC, " + MediaStore.Files.FileColumns._ID + " DESC")) {
                    if (c != null) {
                        while (c.moveToNext()) {
                            long id = c.getLong(0);
                            boolean vid = c.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                            String bucket = c.getString(2);
                            String name = c.getString(3);
                            if (total == 0) { allCover = id; allCoverKind = vid ? 1 : 0; }
                            total++;
                            if (vid) { if (videos == 0) vidCover = id; videos++; }
                            if (bucket == null) continue;
                            long[] a = counts.get(bucket);
                            if (a == null) { a = new long[] { 0, id, vid ? 1 : 0 }; counts.put(bucket, a); names.put(bucket, name == null ? "" : name); }
                            a[0]++;
                        }
                    }
                }
                JSArray out = new JSArray();
                out.put(album("all", "Recents", total, allCover, allCoverKind == 1));
                if (videos > 0) out.put(album("videos", "Videos", videos, vidCover, true));
                List<Map.Entry<String, long[]>> rows = new ArrayList<>(counts.entrySet());
                rows.sort((x, y) -> Long.compare(y.getValue()[0], x.getValue()[0]));
                for (Map.Entry<String, long[]> e : rows) {
                    out.put(album(e.getKey(), names.get(e.getKey()), e.getValue()[0], e.getValue()[1], e.getValue()[2] == 1));
                }
                JSObject res = new JSObject();
                res.put("albums", out);
                res.put("access", accessState());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("albums_failed: " + e.getMessage());
            }
        });
    }

    private static JSObject album(String id, String name, long count, long coverId, boolean coverVideo) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("name", name);
        o.put("count", count);
        o.put("coverId", coverId);
        o.put("coverKind", coverVideo ? "video" : "image");
        return o;
    }

    @PluginMethod
    public void list(final PluginCall call) {
        final String album = call.getString("album", "all");
        final int offset = Math.max(0, call.getInt("offset", 0));
        final int limit = Math.min(240, Math.max(1, call.getInt("limit", 90)));
        POOL.execute(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                String[] proj = {
                    MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Files.FileColumns.MIME_TYPE,
                    MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.SIZE, "width", "height", "duration",
                    MediaStore.Files.FileColumns.DATE_ADDED,
                };
                String sel;
                String[] args = null;
                if ("videos".equals(album)) sel = MediaStore.Files.FileColumns.MEDIA_TYPE + "=" + MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                else if ("all".equals(album)) sel = TYPES;
                else { sel = TYPES + " AND " + MediaStore.Files.FileColumns.BUCKET_ID + "=?"; args = new String[] { album }; }
                String sort = MediaStore.Files.FileColumns.DATE_ADDED + " DESC, " + MediaStore.Files.FileColumns._ID + " DESC";

                Cursor c;
                if (Build.VERSION.SDK_INT >= 26) {
                    Bundle b = new Bundle();
                    b.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, sel);
                    if (args != null) b.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
                    b.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, sort);
                    b.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
                    b.putInt(ContentResolver.QUERY_ARG_OFFSET, offset);
                    c = cr.query(filesUri(), proj, b, null);
                } else {
                    c = cr.query(filesUri(), proj, sel, args, sort + " LIMIT " + limit + " OFFSET " + offset);
                }
                JSArray items = new JSArray();
                if (c != null) {
                    try (Cursor cc = c) {
                        while (cc.moveToNext()) {
                            boolean vid = cc.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                            JSObject o = new JSObject();
                            o.put("id", cc.getLong(0));
                            o.put("kind", vid ? "video" : "image");
                            o.put("mime", cc.getString(2) == null ? (vid ? "video/mp4" : "image/jpeg") : cc.getString(2));
                            o.put("name", cc.getString(3) == null ? ("media_" + cc.getLong(0)) : cc.getString(3));
                            o.put("size", cc.getLong(4));
                            o.put("w", cc.getInt(5));
                            o.put("h", cc.getInt(6));
                            o.put("duration", vid ? cc.getLong(7) : 0);
                            o.put("date", cc.getLong(8));
                            items.put(o);
                        }
                    }
                }
                JSObject res = new JSObject();
                res.put("items", items);
                res.put("hasMore", items.length() == limit);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("list_failed: " + e.getMessage());
            }
        });
    }

    // ------------------------------------------------------------------ thumbnails

    private File cacheDir(String name) {
        File d = new File(getContext().getCacheDir(), name);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    @PluginMethod
    public void thumb(final PluginCall call) {
        final long id = call.getLong("id", 0L);
        final String kind = call.getString("kind", "image");
        final int size = Math.min(512, Math.max(64, call.getInt("size", 200)));
        if (id <= 0) { call.reject("bad_id"); return; }
        POOL.execute(() -> {
            try {
                File f = new File(cacheDir("uip_gal_thumbs"), kind + "_" + id + "_" + size + ".jpg");
                if (!f.exists() || f.length() == 0) {
                    Bitmap bmp = null;
                    ContentResolver cr = getContext().getContentResolver();
                    if (Build.VERSION.SDK_INT >= 29) {
                        bmp = cr.loadThumbnail(itemUri(kind, id), new Size(size, size), null);
                    } else if ("video".equals(kind)) {
                        bmp = MediaStore.Video.Thumbnails.getThumbnail(cr, id, MediaStore.Video.Thumbnails.MINI_KIND, null);
                    } else {
                        bmp = MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                    }
                    if (bmp == null) { call.reject("no_thumb"); return; }
                    try (FileOutputStream os = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.JPEG, 82, os); }
                    bmp.recycle();
                }
                JSObject res = new JSObject();
                res.put("path", f.getAbsolutePath());
                call.resolve(res);
            } catch (Throwable e) {
                call.reject("thumb_failed");
            }
        });
    }

    // ------------------------------------------------------------------ prepare (shrink + copy), 3 files at once

    @PluginMethod
    public void prepare(final PluginCall call) {
        final JSArray items = call.getArray("items");
        final boolean hd = Boolean.TRUE.equals(call.getBoolean("hd", false));
        if (items == null || items.length() == 0) { call.reject("no_items"); return; }
        POOL.execute(() -> {
            try {
                File outDir = cacheDir("uip_gal_out");
                List<Future<JSObject>> jobs = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                    final JSONObject it = items.getJSONObject(i);
                    final int idx = i;
                    // the pool has 3 threads and this task occupies one: run the per-file work on a short-lived helper pool
                    jobs.add(PREP.submit(() -> prepareOne(it, hd, outDir, idx)));
                }
                JSArray out = new JSArray();
                for (Future<JSObject> f : jobs) out.put(f.get());
                JSObject res = new JSObject();
                res.put("files", out);
                call.resolve(res);
            } catch (Throwable e) {
                call.reject("prepare_failed: " + e.getMessage());
            }
        });
        purgeOld();
    }

    private static final ExecutorService PREP = Executors.newFixedThreadPool(3);

    private JSObject prepareOne(JSONObject it, boolean hd, File outDir, int idx) throws Exception {
        long id = it.getLong("id");
        String kind = it.optString("kind", "image");
        String mime = it.optString("mime", "image/jpeg");
        String name = it.optString("name", "media_" + id);
        long origSize = it.optLong("size", 0);
        Uri uri = itemUri(kind, id);
        ContentResolver cr = getContext().getContentResolver();
        String tag = System.currentTimeMillis() + "_" + idx + "_";

        boolean keepAsIs = "video".equals(kind) || mime.contains("gif") || mime.contains("svg");
        if (!keepAsIs) {
            JSObject shrunk = shrinkImage(cr, uri, name, mime, origSize, hd, new File(outDir, tag + baseName(name) + ".jpg"));
            if (shrunk != null) return shrunk;
        }
        // videos / gifs / images that did not get smaller: copy the original bytes
        File dst = new File(outDir, tag + safe(name));
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(dst)) {
            if (in == null) throw new java.io.IOException("open_failed");
            byte[] buf = new byte[256 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
        JSObject o = new JSObject();
        o.put("path", dst.getAbsolutePath());
        o.put("name", safe(name));
        o.put("mime", mime);
        o.put("size", dst.length());
        o.put("kind", kind);
        o.put("shrunk", false);
        return o;
    }

    /** Decode with sub-sampling, fix the EXIF rotation, scale, re-encode as JPEG. Returns null when the original is already smaller. */
    private JSObject shrinkImage(ContentResolver cr, Uri uri, String name, String mime, long origSize, boolean hd, File dst) {
        Bitmap bmp = null;
        Bitmap work = null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = cr.openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            int w = bounds.outWidth, h = bounds.outHeight;
            if (w <= 0 || h <= 0) return null;

            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try (InputStream in = cr.openInputStream(uri)) {
                if (in != null) orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            } catch (Exception ignored) { /* no EXIF */ }

            // screenshots / PNGs / very tall pictures keep a bigger edge so small text stays readable
            boolean texty = mime.contains("png") || (Math.max(w, h) / (float) Math.min(w, h)) > 2.0f;
            int maxEdge = hd ? 4096 : (texty ? 2560 : 1920);
            int edge = Math.max(w, h);
            int sample = 1;
            while (edge / (sample * 2) >= maxEdge) sample *= 2;

            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            try (InputStream in = cr.openInputStream(uri)) { bmp = BitmapFactory.decodeStream(in, null, o); }
            if (bmp == null) return null;

            work = bmp;
            int cw = bmp.getWidth(), ch = bmp.getHeight();
            int cEdge = Math.max(cw, ch);
            Matrix m = new Matrix();
            boolean change = false;
            if (cEdge > maxEdge) { float s = maxEdge / (float) cEdge; m.postScale(s, s); change = true; }
            switch (orientation) {
                case ExifInterface.ORIENTATION_ROTATE_90: m.postRotate(90); change = true; break;
                case ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); change = true; break;
                case ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); change = true; break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: m.postScale(-1, 1); change = true; break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: m.postScale(1, -1); change = true; break;
                default: break;
            }
            if (change) work = Bitmap.createBitmap(bmp, 0, 0, cw, ch, m, true);
            if (work.hasAlpha()) { // JPEG has no transparency: put the picture on white instead of black
                Bitmap flat = Bitmap.createBitmap(work.getWidth(), work.getHeight(), Bitmap.Config.ARGB_8888);
                Canvas cv = new Canvas(flat);
                cv.drawColor(Color.WHITE);
                cv.drawBitmap(work, 0, 0, null);
                if (work != bmp) work.recycle();
                work = flat;
            }
            try (FileOutputStream os = new FileOutputStream(dst)) { work.compress(Bitmap.CompressFormat.JPEG, hd ? 92 : 80, os); }
            boolean untouched = orientation == ExifInterface.ORIENTATION_NORMAL && sample == 1 && !change;
            if (origSize > 0 && dst.length() >= origSize * 0.95 && untouched && mime.contains("jpeg")) { dst.delete(); return null; }

            JSObject res = new JSObject();
            res.put("path", dst.getAbsolutePath());
            res.put("name", dst.getName().replaceFirst("^\\d+_\\d+_", ""));
            res.put("mime", "image/jpeg");
            res.put("size", dst.length());
            res.put("kind", "image");
            res.put("shrunk", true);
            res.put("width", work.getWidth());
            res.put("height", work.getHeight());
            return res;
        } catch (Throwable t) {
            return null; // anything odd: fall back to copying the original
        } finally {
            if (work != null && work != bmp) work.recycle();
            if (bmp != null) bmp.recycle();
        }
    }

    private static String safe(String n) {
        String s = (n == null ? "file" : n).replaceAll("[\\\\/:*?\"<>|]", "_");
        return s.isEmpty() ? "file" : s;
    }

    private static String baseName(String n) {
        String s = safe(n);
        int dot = s.lastIndexOf('.');
        return dot > 0 ? s.substring(0, dot) : s;
    }

    @PluginMethod
    public void release(PluginCall call) {
        JSArray paths = call.getArray("paths");
        int n = 0;
        if (paths != null) {
            for (int i = 0; i < paths.length(); i++) {
                try {
                    File f = new File(paths.getString(i));
                    // only ever delete inside our own temp folder
                    if (f.getParentFile() != null && "uip_gal_out".equals(f.getParentFile().getName()) && f.delete()) n++;
                } catch (Exception ignored) { /* keep going */ }
            }
        }
        JSObject res = new JSObject();
        res.put("deleted", n);
        call.resolve(res);
    }

    /** Old thumbnails (> 3 days) and leftover prepared files (> 3 hours) are removed; runs in the background after each prepare. */
    private void purgeOld() {
        POOL.execute(() -> {
            try {
                long now = System.currentTimeMillis();
                File[] a = cacheDir("uip_gal_out").listFiles();
                if (a != null) for (File f : a) if (now - f.lastModified() > 3L * 3600_000L) f.delete();
                File[] b = cacheDir("uip_gal_thumbs").listFiles();
                if (b != null && b.length > 600) for (File f : b) if (now - f.lastModified() > 3L * 86_400_000L) f.delete();
            } catch (Throwable ignored) { /* best effort */ }
        });
    }
}
