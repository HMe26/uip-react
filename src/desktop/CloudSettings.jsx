import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { cloud, useCloud } from '../lib/cloud/engine';
import { saveCenter, useSaveCenter } from '../lib/saveCenter';

const Section = ({ title, children }) => (
  <section className="os-set__sec"><h3>{title}</h3>{children}</section>
);
const LOGO = { google: 'G', microsoft: 'O' };

/** The linked account's profile photo; falls back to the first letter of its email (or the provider letter when not linked). */
function CloudAvatar({ id, link }) {
  const [bad, setBad] = useState(false);
  const pic = link?.picture;
  useEffect(() => { setBad(false); }, [pic]);
  const letter = (link?.account || '').trim().charAt(0).toUpperCase() || LOGO[id];
  return (
    <span className={`sc-logo sc-logo--${id}`}>
      {pic && !bad ? <img className="sc-logo__img" src={pic} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : letter}
    </span>
  );
}

export function ago(ts, tt) {
  if (!ts) return tt('never', 'لسه');
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return tt('just now', 'دلوقتي');
  const m = Math.round(s / 60);
  if (m < 60) return tt(`${m} min ago`, `من ${m} دقيقة`);
  const h = Math.round(m / 60);
  if (h < 24) return tt(`${h} h ago`, `من ${h} ساعة`);
  return tt(`${Math.round(h / 24)} d ago`, `من ${Math.round(h / 24)} يوم`);
}

/** Short status line + tone for the tray icon, the toasts and the settings page. */
export function cloudSummary(cl, tt) {
  if (!cl.provider) return { tone: 'off', text: tt('No cloud backup', 'مفيش نسخ احتياطي سحابي') };
  const name = cl.providers.map((i) => cloud.providers[i].label).join(' + ');
  if (!cl.auto) return { tone: 'off', text: tt(`${name}: auto-backup is off`, `${name}: النسخ التلقائي متوقف`) };
  if (cl.status === 'needs-auth') return { tone: 'warn', text: tt(`${name}: sign in again`, `${name}: سجّل الدخول تاني`) };
  if (cl.status === 'offline') return { tone: 'warn', text: tt(`${name}: offline — will resume`, `${name}: أوفلاين — هيكمل بعدين`) };
  if (cl.status === 'running') return { tone: 'busy', text: tt(`${name}: backing up ${cl.progress.done}/${cl.progress.total}`, `${name}: جاري النسخ ${cl.progress.done}/${cl.progress.total}`) };
  if (cl.status === 'error') return { tone: 'bad', text: `${cl.providers.filter((i) => cl.links[i].status === 'error').map((i) => cloud.providers[i].label).join(' + ') || name}: ${cl.lastError || tt('problem', 'مشكلة')}` };
  return { tone: 'ok', text: tt(`${name}: backed up ${ago(cl.lastOk, tt)}`, `${name}: آخر نسخة ${ago(cl.lastOk, tt)}`) };
}

/** Settings ▸ Storage & backup (also shown in a dialog when there is no desktop shell). */
export function CloudPanel({ tt, usage }) {
  const cl = useCloud();
  const sc = useSaveCenter();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const connect = async (id) => {
    setBusy(id); setErr('');
    try { await cloud.connect(id); } catch (e) { setErr(e?.message || tt('Could not connect.', 'تعذّر الربط.')); } finally { setBusy(''); }
  };
  const sum = cloudSummary(cl, tt);
  const linkedKey = cl.providers.join(',');
  useEffect(() => { if (linkedKey) cloud.ensureAvatars(); }, [linkedKey]);
  const ids = ['google', 'microsoft'];
  const anyAvailable = ids.some((i) => cloud.available(i));
  const REMIND = [[60, tt('1 min', 'دقيقة')], [120, tt('2 min', 'دقيقتين')], [300, tt('5 min', '5 دقايق')]];

  return (
    <>
      <Section title={tt('Where your work is saved', 'فين شغلك بيتحفظ')}>
        <div className="sc-where">
          <div><Icon name="hard-drive" size={18} /><div><b>{tt('Final copy — My PC', 'النسخة النهائية — جهازي')}</b>
            <span>{usage ? tt(`On the university server · ${usage.used_human} of ${usage.quota_human} used`, `على سيرفر الجامعة · ${usage.used_human} من ${usage.quota_human}`) : tt('On the university server', 'على سيرفر الجامعة')}</span></div></div>
          <div><Icon name={cl.provider ? 'cloud-check' : 'cloud-off'} size={18} /><div><b>{tt('Backup copy', 'النسخة الاحتياطية')}</b><span className={`sc-tone sc-tone--${sum.tone}`}>{sum.text}</span></div></div>
        </div>
      </Section>

      <Section title={tt('Cloud backup', 'النسخ الاحتياطي السحابي')}>
        <p className="os-set__hint">{tt('A copy of your My PC files is kept in your own Google Drive or OneDrive, in a folder called “UIPE My PC”. Exams, submissions and results never leave the university server.', 'نسخة من ملفات جهازي بتتحفظ في Google Drive أو OneDrive بتاعك، في فولدر اسمه “UIPE My PC”. الامتحانات والتسليمات والنتائج بتفضل على سيرفر الجامعة بس.')}</p>
        {!anyAvailable && <p className="os-set__hint">{cl.ready ? tt('Cloud backup is not available here yet (it has to be enabled by the platform admin, and it does not run inside the Android app).', 'النسخ السحابي مش متاح هنا لسه (لازم الأدمن يفعّله، ومش بيشتغل جوه تطبيق الأندرويد).') : tt('Loading…', 'جارٍ التحميل…')}</p>}
        <div className="sc-prov">
          {ids.filter((i) => cloud.available(i) || cl.links[i]).map((id) => {
            const lk = cl.links[id];
            const on = !!lk;
            const name = cloud.providers[id].label;
            return (
              <div key={id} className={`sc-card${on ? ' is-on' : ''}`}>
                <CloudAvatar id={id} link={lk} />
                <div className="sc-card__txt"><b>{name}</b>
                  <span>{on ? (lk.account || tt('Connected', 'متصل')) : tt('Not connected', 'غير متصل')}</span>
                  {on && lk.status === 'error' && <span className="sc-tone sc-tone--bad">{lk.lastError}</span>}</div>
                {!on && <button type="button" className="os-btn os-btn--primary" disabled={!!busy} onClick={() => connect(id)}>{busy === id ? tt('Connecting…', 'جارٍ الربط…') : tt('Connect', 'ربط')}</button>}
                {on && lk.status === 'needs-auth' && <button type="button" className="os-btn os-btn--primary" disabled={!!busy} onClick={() => connect(id)}>{tt('Sign in again', 'سجّل الدخول')}</button>}
                {on && lk.status !== 'needs-auth' && <button type="button" className="os-btn" onClick={() => cloud.disconnect(id)}>{tt('Disconnect', 'فصل')}</button>}
              </div>
            );
          })}
        </div>
        {err && <p className="os-set__err">{err}</p>}
        {cl.provider && (
          <div className="sc-actions">
            <label className="sc-check"><input type="checkbox" checked={cl.auto} onChange={(e) => cloud.setAuto(e.target.checked)} />{tt('Back up automatically after every save', 'نسخ احتياطي تلقائي بعد كل حفظ')}</label>
            <button type="button" className="os-btn" disabled={cl.status === 'running'} onClick={() => cloud.runNow()}>
              <Icon name="cloud-up" size={14} /> {cl.status === 'running' ? `${cl.progress.done}/${cl.progress.total}` : tt('Back up now', 'انسخ دلوقتي')}
            </button>
          </div>
        )}
                {cl.provider && <p className="os-set__hint">{tt('Deleting a file in My PC does not delete its backup. Sign-in lasts for this browser session; you may be asked to sign in again.', 'مسح ملف من جهازي مبيمسحش نسخته الاحتياطية. تسجيل الدخول بيفضل طول جلسة المتصفح، وممكن يطلب منك تسجّل تاني.')}</p>}
      </Section>

      <Section title={tt('Unsaved changes', 'التعديلات غير المحفوظة')}>
        <div className="os-seg">
          {[['ask', tt('Remind me', 'ذكّرني')], ['auto', tt('Save automatically', 'احفظ تلقائيًا')], ['off', tt('Off', 'إيقاف')]].map(([k, l]) => (
            <button key={k} type="button" className={sc.settings.mode === k ? 'is-on' : ''} onClick={() => saveCenter.setSettings({ mode: k })}>{l}</button>
          ))}
        </div>
        {sc.settings.mode !== 'off' && (
          <>
            <p className="os-set__hint">{sc.settings.mode === 'auto' ? tt('Save after changes stay unsaved for:', 'يحفظ لو التعديلات فضلت من غير حفظ لمدة:') : tt('Remind me after changes stay unsaved for:', 'ذكّرني لو التعديلات فضلت من غير حفظ لمدة:')}</p>
            <div className="os-seg">
              {REMIND.map(([sec, l]) => <button key={sec} type="button" className={sc.settings.remindAfter === sec ? 'is-on' : ''} onClick={() => saveCenter.setSettings({ remindAfter: sec })}>{l}</button>)}
            </div>
          </>
        )}
        <p className="os-set__hint">{tt('Closing a file with unsaved changes always asks first. A draft is also kept on this device in case the page closes by accident.', 'قفل ملف فيه تعديلات غير محفوظة بيسألك دايمًا الأول. وكمان بتتحفظ مسودة على جهازك لو الصفحة اتقفلت بالغلط.')}</p>
      </Section>
    </>
  );
}
