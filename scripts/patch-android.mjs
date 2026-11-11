/**
 * Runs after `cap sync android` (see package.json -> android:sync).
 * Copies the exam-mode native code (native/android/*.java) into the generated android/ project and
 * makes MainActivity register it. Safe to run many times.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function appId() {
  const json = join(root, 'capacitor.config.json');
  const ts = join(root, 'capacitor.config.ts');
  const fromTs = existsSync(ts) && /appId:\s*['"]([^'"]+)['"]/.exec(readFileSync(ts, 'utf8'));
  if (fromTs) return fromTs[1];
  if (existsSync(json)) { try { return JSON.parse(readFileSync(json, 'utf8')).appId; } catch { /* ignore */ } }
  return 'com.uipe.platform';
}

const pkg = appId();
const androidDir = join(root, 'android');
if (!existsSync(androidDir)) {
  console.error('[patch-android] android/ not found - run "npx cap add android" first, then npm run android:sync');
  process.exit(1);
}

const javaDir = join(androidDir, 'app', 'src', 'main', 'java', ...pkg.split('.'));
mkdirSync(javaDir, { recursive: true });

for (const file of ['ExamLockPlugin.java', 'ScreenCapturePlugin.java', 'NativePrintPlugin.java', 'NativeLinksPlugin.java', 'NativeFilesPlugin.java', 'NativeGalleryPlugin.java', 'UipMessagingService.java', 'UipCallActionReceiver.java', 'IncomingCallActivity.java', 'MainActivity.java']) {
  const src = readFileSync(join(root, 'native', 'android', file), 'utf8').replaceAll('__PACKAGE__', pkg);
  writeFileSync(join(javaDir, file), src);
  console.log(`[patch-android] wrote ${pkg}.${file.replace('.java', '')}`);
}

// ---- AndroidManifest.xml: permissions + uip:// deep link (idempotent) ----------------------------------
const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  let xml = readFileSync(manifestPath, 'utf8');
  const before = xml;

  const perms = [
    'android.permission.CAMERA',                // exam proctoring + meetings
    'android.permission.RECORD_AUDIO',          // meetings
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.POST_NOTIFICATIONS',    // Android 13+ notifications
    'android.permission.VIBRATE',
    'android.permission.ACCESS_COARSE_LOCATION', // chat: send current location / live location
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.FOREGROUND_SERVICE',     // live location keeps updating with the app in the background
    'android.permission.FOREGROUND_SERVICE_LOCATION', // Android 14+
    'android.permission.BLUETOOTH_CONNECT',      // Android 12+: use a Bluetooth headset in meetings / voice notes
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.WAKE_LOCK',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', // keep pushes arriving with the app closed (like WhatsApp)
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.SYSTEM_ALERT_WINDOW',      // open the incoming-call screen straight away, even with the phone unlocked
    'android.permission.USE_FULL_SCREEN_INTENT',   // incoming call rings full-screen over the lock screen
    'android.permission.DETECT_SCREEN_CAPTURE',   // Android 14+: warn the other people in a meeting when someone takes a screenshot
    'android.permission.DETECT_SCREEN_RECORDING', // Android 15+: same for a screen recording
  ];
  const add = perms.filter((p) => !xml.includes(`"${p}"`)).map((p) => `    <uses-permission android:name="${p}" />`);
  for (const f of ['android.hardware.camera', 'android.hardware.microphone', 'android.hardware.location.gps']) {
    if (!xml.includes(`"${f}"`)) add.push(`    <uses-feature android:name="${f}" android:required="false" />`);
  }
  // Chat media auto-save into Pictures/Movies/Documents/UIP: only Android 9 and older need this (10+ uses MediaStore).
  // Chat attach sheet: the phone's photo / video gallery (native/android/NativeGalleryPlugin.java).
  if (!xml.includes('"android.permission.READ_MEDIA_IMAGES"')) add.push('    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />');
  if (!xml.includes('"android.permission.READ_MEDIA_VIDEO"')) add.push('    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />');
  if (!xml.includes('"android.permission.READ_MEDIA_VISUAL_USER_SELECTED"')) add.push('    <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />'); // Android 14+: "selected photos only"
  if (!xml.includes('"android.permission.READ_EXTERNAL_STORAGE"')) add.push('    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
  if (!xml.includes('"android.permission.WRITE_EXTERNAL_STORAGE"')) {
    add.push('    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />');
  }
  if (add.length) xml = xml.replace('</manifest>', `${add.join('\n')}\n</manifest>`);

  if (!xml.includes('android:scheme="uip"')) {
    const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="uip" android:host="staff-access" />
            </intent-filter>
`;
    xml = xml.replace('</activity>', `${filter}\n        </activity>`);
  }
  // Push (Firebase): default icon / colour / channel for notifications FCM shows while the app is closed.
  if (!xml.includes('com.google.firebase.messaging.default_notification_channel_id')) {
    const meta = `
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_uip" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/uip_notification" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="uip" />
`;
    xml = xml.replace('</application>', `${meta}    </application>`);
  }
  // Incoming calls: our FirebaseMessagingService (subclass of Capacitor's) wins over Capacitor's because of the higher priority.
  if (!xml.includes('UipMessagingService')) {
    const svc = `
        <service android:name=".UipMessagingService" android:exported="false">
            <intent-filter android:priority="100">
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
        <receiver android:name=".UipCallActionReceiver" android:exported="false" />
`;
    xml = xml.replace('</application>', `${svc}    </application>`);
  }
  if (!xml.includes('IncomingCallActivity')) {
    const act = `
        <activity android:name=".IncomingCallActivity" android:exported="false" android:launchMode="singleInstance"
            android:excludeFromRecents="true" android:taskAffinity="" android:showWhenLocked="true" android:turnScreenOn="true"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />
`;
    xml = xml.replace('</application>', `${act}    </application>`);
  }
  if (xml !== before) { writeFileSync(manifestPath, xml); console.log('[patch-android] AndroidManifest.xml updated (permissions, uip:// link)'); }
}

// ---- Push (Firebase): google-services.json + notification icon/colour resources ------------------------------------
// Capacitor's generated app/build.gradle applies the google-services plugin only when app/google-services.json exists.
const gsSrc = join(root, 'native', 'android', 'google-services.json');
if (existsSync(gsSrc)) {
  copyFileSync(gsSrc, join(androidDir, 'app', 'google-services.json'));
  console.log('[patch-android] google-services.json copied (push notifications)');
} else {
  console.warn('[patch-android] native/android/google-services.json missing - push notifications will not work in this build');
}
const resSrc = join(root, 'native', 'android', 'res');
if (existsSync(resSrc)) {
  cpSync(resSrc, join(androidDir, 'app', 'src', 'main', 'res'), { recursive: true });
  console.log('[patch-android] notification icon/colour resources copied');
}

// Safety net: Capacitor's template normally has these two Gradle lines already; add them only if they are missing.
const rootGradle = join(androidDir, 'build.gradle');
if (existsSync(rootGradle)) {
  let g = readFileSync(rootGradle, 'utf8');
  if (!g.includes('com.google.gms:google-services')) {
    g = g.replace(/(buildscript\s*\{[\s\S]*?dependencies\s*\{)/, "$1\n        classpath 'com.google.gms:google-services:4.4.2'");
    writeFileSync(rootGradle, g);
    console.log('[patch-android] google-services classpath added to android/build.gradle');
  }
}
const appGradle = join(androidDir, 'app', 'build.gradle');
if (existsSync(appGradle)) {
  let g = readFileSync(appGradle, 'utf8');
  if (!/apply plugin:\s*['"]com\.google\.gms\.google-services['"]/.test(g)) {
    g += "\ntry {\n    def servicesJSON = file('google-services.json')\n    if (servicesJSON.text) {\n        apply plugin: 'com.google.gms.google-services'\n    }\n} catch (Exception e) {\n    logger.info('google-services.json not found, google-services plugin not applied. Push Notifications will not work')\n}\n";
    writeFileSync(appGradle, g);
    console.log('[patch-android] google-services plugin applied in android/app/build.gradle');
  }
}

// Our FirebaseMessagingService subclass needs firebase-messaging on the app module's own compile classpath
// (the Capacitor push plugin declares it as "implementation", which is not visible to the app module).
if (existsSync(appGradle)) {
  let g = readFileSync(appGradle, 'utf8');
  if (!g.includes('uip-firebase-messaging')) {
    g += "\n// uip-firebase-messaging\ndependencies {\n    implementation 'com.google.firebase:firebase-messaging:25.0.1'\n}\n";
    writeFileSync(appGradle, g);
    console.log('[patch-android] firebase-messaging dependency added to android/app/build.gradle');
  }
}

// ---- Smaller APK: R8 code shrinking + unused resource removal + only the UI languages we ship (release builds) ---------------
// Marker-guarded so it is applied once. The keep rules protect the Capacitor plugins and our own native classes from being stripped.
if (existsSync(appGradle)) {
  let g = readFileSync(appGradle, 'utf8');
  if (!g.includes('uip-shrink')) {
    g = g.replace(/minifyEnabled\s+false/, 'minifyEnabled true\n            shrinkResources true // uip-shrink');
    g = g.replace(/defaultConfig\s*\{/, "defaultConfig {\n        resourceConfigurations += ['en', 'ar'] // uip-shrink: drop the other languages bundled by libraries");
    writeFileSync(appGradle, g);
    console.log('[patch-android] release shrinking enabled (minify + shrinkResources + en/ar resources)');
  }
  const pro = join(androidDir, 'app', 'proguard-rules.pro');
  const rules = `
# uip-shrink: keep Capacitor plugins + our native code (they are reached by reflection from the WebView bridge)
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { @com.getcapacitor.annotation.PluginMethod public <methods>; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }
-keep class ${appId()}.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-dontwarn com.google.errorprone.annotations.**
`;
  const cur = existsSync(pro) ? readFileSync(pro, 'utf8') : '';
  if (!cur.includes('uip-shrink')) { writeFileSync(pro, cur + rules); console.log('[patch-android] proguard keep rules added'); }
}
