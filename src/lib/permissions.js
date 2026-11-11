/**
 * One place that knows every permission the app can use, on the website and in the Android app:
 * location, camera, microphone, notifications.
 *
 *   permissionStates()      -> { location, camera, microphone, notifications }  each 'granted' | 'denied' | 'prompt' | 'unsupported'
 *   requestPermission(key)  -> asks (system dialog / browser prompt) and returns the new state
 *   openAppSettings()       -> Android: this app's settings page (for a permission refused for good)
 *
 * Files / photos need no permission: they go through the system picker (like WhatsApp does on Android 13+).
 */
import { isNative, openAppSettings, recheckPermissions } from '../native';
import { getPosition, ensureNativePermission } from './geo';

export { openAppSettings };
export const PERMISSION_KEYS = ['location', 'camera', 'microphone', 'notifications'];

const fromQuery = (state) => (state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt');

async function webQuery(name) {
  try {
    if (!navigator.permissions?.query) return 'prompt';
    return fromQuery((await navigator.permissions.query({ name })).state);
  } catch { return 'prompt'; }
}

async function check(key) {
  switch (key) {
    case 'location': {
      if (isNative) {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const p = await Geolocation.checkPermissions();
          if (p.location === 'granted' || p.coarseLocation === 'granted') return 'granted';
          return p.location === 'denied' ? 'denied' : 'prompt';
        } catch { return 'unsupported'; }
      }
      return navigator.geolocation ? webQuery('geolocation') : 'unsupported';
    }
    case 'camera':
    case 'microphone':
      return navigator.mediaDevices?.getUserMedia ? webQuery(key) : 'unsupported';
    case 'notifications': {
      if (isNative) {
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          return fromQuery((await LocalNotifications.checkPermissions()).display);
        } catch { return 'unsupported'; }
      }
      if (typeof Notification === 'undefined') return 'unsupported';
      return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt';
    }
    default:
      return 'unsupported';
  }
}

export async function permissionStates() {
  const out = {};
  await Promise.all(PERMISSION_KEYS.map(async (k) => { out[k] = await check(k); }));
  return out;
}

async function askMedia(constraints) {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  stream.getTracks().forEach((t) => t.stop());
}

export async function requestPermission(key) {
  try {
    switch (key) {
      case 'location':
        if (isNative) await ensureNativePermission(); else await getPosition();
        break;
      case 'camera': await askMedia({ video: true }); break;
      case 'microphone': await askMedia({ audio: true }); break;
      case 'notifications':
        if (isNative) {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          await LocalNotifications.requestPermissions();
          recheckPermissions(); // creates the channels + registers for push now that it is granted
        } else if (typeof Notification !== 'undefined') {
          await Notification.requestPermission();
        }
        break;
      default: break;
    }
  } catch { /* refused: the state below says so */ }
  return check(key);
}
