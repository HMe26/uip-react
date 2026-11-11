import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.uipe.platform',
  appName: 'UIPE',
  webDir: 'dist',
  backgroundColor: '#F4F6FF',
  android: {
    backgroundColor: '#F4F6FF',
    allowMixedContent: false,
  },
  plugins: {
    // Native HTTP: calls to the Laravel API go through Android's network stack, so no CORS setup is
    // needed on the backend and the HttpOnly refresh cookie is kept by the native cookie store.
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
    // Push (Firebase Cloud Messaging) + local notifications share the status-bar icon and colour from native/android/res
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    LocalNotifications: { smallIcon: 'ic_stat_uip', iconColor: '#4F5BE8' },
    // Screenshot blocking is switched on/off by the app (exam attempt pages only) - see src/native.js
    PrivacyScreen: { enable: false },
    SplashScreen: {
      launchShowDuration: 0,     // we hide it ourselves once the app has really rendered
      launchAutoHide: false,
      backgroundColor: '#F4F6FF',
      androidScaleType: 'CENTER_INSIDE',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
  },
};

export default config;
