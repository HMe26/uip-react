import { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { isNative } from '../../native';
import { PERMISSION_KEYS, openAppSettings, permissionStates, requestPermission } from '../../lib/permissions';

const ITEMS = {
  location: { icon: 'pin', en: ['Location', 'Share your current or live location in chats.'], ar: ['الموقع', 'مشاركة موقعك الحالي أو المباشر في المحادثات.'] },
  camera: { icon: 'image', en: ['Camera', 'Take photos and videos, join meetings and exams with video.'], ar: ['الكاميرا', 'التقاط الصور والفيديو والانضمام للاجتماعات والامتحانات بالفيديو.'] },
  microphone: { icon: 'mic', en: ['Microphone', 'Voice messages and calls in meetings.'], ar: ['الميكروفون', 'الرسائل الصوتية والمكالمات في الاجتماعات.'] },
  notifications: { icon: 'bell', en: ['Notifications', 'Get new messages and updates even when the app is closed.'], ar: ['الإشعارات', 'استلام الرسائل والتحديثات حتى والتطبيق مغلق.'] },
};

/** Shows every permission with its state and lets the person allow it (or jump to Android settings if it was refused for good). */
export default function PermissionsCard() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, a) => (ar ? a : en);
  const [states, setStates] = useState(null);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(() => permissionStates().then(setStates), []);
  useEffect(() => {
    refresh();
    const on = () => { if (!document.hidden) refresh(); }; // back from Android settings / the browser's site settings
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); };
  }, [refresh]);

  const allow = async (key) => {
    setBusy(key);
    const next = await requestPermission(key);
    setStates((s) => ({ ...s, [key]: next }));
    setBusy('');
  };
  const allowAll = async () => {
    for (const k of PERMISSION_KEYS) {
      if (states?.[k] === 'prompt') await allow(k); // one at a time: Android shows one dialog per permission
    }
  };

  const pending = states ? PERMISSION_KEYS.filter((k) => states[k] === 'prompt').length : 0;
  const badge = (s) => {
    const map = { granted: ['#1fa855', t('Allowed', 'مسموح')], denied: ['#e5484d', t('Blocked', 'محظور')], prompt: ['#d98a00', t('Not set', 'غير مفعّل')], unsupported: ['#8a90a8', t('Not supported', 'غير مدعوم')] };
    const [c, l] = map[s] || map.prompt;
    return <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: `${c}22`, color: c, whiteSpace: 'nowrap' }}>{l}</span>;
  };

  return (
    <section className="card" style={{ padding: 'var(--space-5, 20px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>{t('App permissions', 'أذونات التطبيق')}</h3>
        {pending > 1 ? <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={allowAll}>{t('Allow all', 'السماح للكل')}</button> : null}
      </div>
      <p className="text-small" style={{ margin: '0 0 12px', opacity: 0.75 }}>
        {t('Allow only what you need. You can change any of these at any time.', 'اسمح بما تحتاجه فقط. تقدر تغيّر أي إذن في أي وقت.')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {PERMISSION_KEYS.map((k) => {
          const it = ITEMS[k];
          const [name, why] = ar ? it.ar : it.en;
          const s = states?.[k];
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border-subtle, rgba(0,0,0,.08))' }}>
              <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(79,91,232,.12)', color: 'var(--color-primary, #4F5BE8)', flexShrink: 0 }}>
                <Icon name={it.icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 14 }}>{name}</strong>
                <span className="text-small" style={{ opacity: 0.7 }}>{why}</span>
                {s === 'denied' && !isNative ? (
                  <span className="text-small" style={{ display: 'block', marginTop: 4, color: '#e5484d' }}>
                    {t('Blocked in the browser: click the lock icon next to the address bar, allow it, then reload.', 'محظور من المتصفح: اضغط على أيقونة القفل بجانب شريط العنوان واسمح به ثم أعد تحميل الصفحة.')}
                  </span>
                ) : null}
              </span>
              {s ? badge(s) : null}
              {s === 'prompt' ? (
                <button type="button" className="btn btn-outline btn-sm" disabled={busy === k} onClick={() => allow(k)}>{t('Allow', 'سماح')}</button>
              ) : null}
              {s === 'denied' && isNative ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openAppSettings()}>{t('Open settings', 'فتح الإعدادات')}</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
