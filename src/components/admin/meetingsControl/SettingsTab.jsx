import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import { Skeleton } from '../AdminPage';
import { BASE, GROUP_META, ROLE_LABELS, SETTING_META, Switch, useBanner, useL } from './shared';

const UNIT = { min: ['min', 'دقيقة'], sec: ['sec', 'ثانية'], hour: ['hours', 'ساعة'], day: ['days', 'يوم'], KB: ['KB', 'كيلوبايت'], people: ['people', 'شخص'], video: ['videos', 'فيديو'] };

const SFU_TEST_TEXT = {
  ok: ['Connected to Cloudflare successfully.', 'الاتصال بـ Cloudflare شغّال.'],
  bad_secret: ['Cloudflare rejected the secret. Check the App Secret.', 'Cloudflare رفض السر. راجع الـ App Secret.'],
  bad_app_id: ['App ID not found. Check the App ID.', 'الـ App ID مش موجود. راجعه.'],
  unreachable: ['Could not reach Cloudflare from the server.', 'السيرفر ماقدرش يوصل لـ Cloudflare.'],
  disabled: ['The video server is switched off. Turn it on and save first.', 'سيرفر الفيديو مقفول. شغّله واحفظ الأول.'],
  missing_credentials: ['App ID or secret is missing. Save them first.', 'الـ App ID أو السر ناقص. احفظهم الأول.'],
  error: ['Cloudflare returned an error.', 'Cloudflare رجّع خطأ.'],
};

/**
 * Renders the settings catalog (GET /control/settings) for the given groups.
 * Used twice: "Features & system" (system + features) and "Rules & limits" (the rest).
 * Everything saves at once with the Save button; each overridden value can be reset on its own.
 */
export default function SettingsTab({ groups }) {
  const { ar, L } = useL();
  const { banner, setNotice, setError, clear } = useBanner();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, message, danger, run }
  const [sfuTest, setSfuTest] = useState(null); // { ok, text } | 'busy'

  const apply = (d) => { setData(d); setDraft({}); };
  const load = useCallback(() => api.get(`${BASE}/settings`).then((j) => apply(j.data)), []);
  useEffect(() => { load().catch((e) => setError(errorMessage(e))).finally(() => setLoading(false)); }, [load, setError]);

  const meta = (k) => data.values[k];
  const val = (k) => (k in draft ? draft[k] : meta(k).value);
  const set = (k, v) => setDraft((d) => {
    const next = { ...d };
    if (JSON.stringify(v) === JSON.stringify(meta(k).value)) delete next[k]; else next[k] = v;
    return next;
  });
  const dirty = Object.keys(draft).length > 0;

  async function run(fn, done) {
    clear();
    try { const j = await fn(); apply(j.data); setNotice(done || j.message); } catch (e) { setError(errorMessage(e)); }
  }

  const keysIn = (g) => (data ? Object.keys(data.values).filter((k) => data.values[k].group === g && data.values[k].type !== 'list_int') : []);

  // Turning the master switch off (or a feature off) asks for confirmation; everything else is just a draft change.
  function toggle(k, v) {
    if (k === 'feature_meetings' && v === false) {
      setConfirm({
        title: L('Turn the whole meetings system off?', 'قفل نظام الاجتماعات بالكامل؟'),
        message: L('Nobody will be able to create, start or join meetings after you save. Meetings already live keep running until you end them from the Meetings tab.', 'محدش هيقدر ينشئ أو يبدأ أو يدخل اجتماعات بعد الحفظ. الاجتماعات الشغالة هتكمل لحد ما تنهيها من تاب الاجتماعات.'),
        danger: true,
        run: () => { set(k, false); setConfirm(null); },
      });
      return;
    }
    set(k, v);
  }

  async function save() {
    setSaving(true);
    await run(() => api.put(`${BASE}/settings`, { values: draft }), L('Settings saved. They apply immediately.', 'تم الحفظ. التغيير بيسري فورًا.'));
    setSaving(false);
  }

  async function testSfu() {
    setSfuTest('busy');
    try {
      const j = await api.post(`${BASE}/sfu/test`, {});
      const code = j.data?.code || 'error';
      const msg = SFU_TEST_TEXT[code] || SFU_TEST_TEXT.error;
      let text = msg[ar ? 1 : 0];
      if (!j.data?.ok && code === 'error') {
        const extra = [j.data?.status ? `HTTP ${j.data.status}` : '', j.data?.detail || ''].filter(Boolean).join(' — ');
        if (extra) text += ` (${extra})`;
      }
      setSfuTest({ ok: !!j.data?.ok, text });
    } catch (e) { setSfuTest({ ok: false, text: errorMessage(e) }); }
  }

  const resetOne = (k) => run(() => api.put(`${BASE}/settings`, { values: { [k]: null } }), L('Reset to default.', 'تم الرجوع للافتراضي.'));

  function resetAll() {
    setConfirm({
      title: L('Reset ALL meeting settings?', 'إرجاع كل إعدادات الاجتماعات للافتراضي؟'),
      message: L('Every override (including the block list) goes back to the default values.', 'كل التعديلات (بما فيها قايمة الحظر) هترجع للقيم الافتراضية.'),
      danger: true,
      run: async () => { setConfirm(null); setSaving(true); await run(() => api.del(`${BASE}/settings`)); setSaving(false); },
    });
  }

  function renderControl(k) {
    const m = meta(k);
    const v = val(k);
    if (m.type === 'bool') {
      return <Switch id={`mtc-${k}`} checked={!!v} onChange={(x) => toggle(k, x)} label={(SETTING_META[k] || {}).en} />;
    }
    if (m.type === 'int') {
      const u = UNIT[(SETTING_META[k] || {}).unit];
      return (
        <div className="mtc-inline">
          <input id={`mtc-${k}`} className="form-input mtc-num" type="number" min={m.min} max={m.max} value={v}
            onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
          {u && <span className="mtc-muted">{ar ? u[1] : u[0]}</span>}
          <span className="mtc-muted mtc-range">{m.min}–{m.max}</span>
        </div>
      );
    }
    if (m.type === 'string') {
      return <input id={`mtc-${k}`} className="form-input" maxLength={m.max_length || 300} value={v} onChange={(e) => set(k, e.target.value)} />;
    }
    if (m.type === 'enum') {
      const labels = (SETTING_META[k] || {}).options || {};
      return (
        <select id={`mtc-${k}`} className="form-select" value={v} onChange={(e) => set(k, e.target.value)}>
          {(m.options || []).map((o) => <option key={o} value={o}>{labels[o] ? labels[o][ar ? 'ar' : 'en'] : o}</option>)}
        </select>
      );
    }
    if (m.type === 'secret') {
      const src = m.source === 'panel' ? L('saved from this panel', 'محفوظ من اللوحة') : m.source === 'env' ? L('from .env', 'من ملف .env') : L('not set', 'مش متحدد');
      return (
        <div className="mtc-secret">
          <input id={`mtc-${k}`} className="form-input" type="password" autoComplete="new-password" spellCheck="false" data-allow-clipboard maxLength={m.max_length || 200}
            placeholder={m.masked ? `${m.masked}` : ''} value={v} onChange={(e) => set(k, e.target.value)} />
          <small className="mtc-muted">{src}</small>
        </div>
      );
    }
    // list_str = roles
    const roles = data.available_roles || [];
    return (
      <div className="mtc-checks">
        {roles.map((r) => {
          const on = (v || []).includes(r);
          const lbl = ROLE_LABELS[r] ? ROLE_LABELS[r][ar ? 1 : 0] : r;
          return (
            <label key={r} className={`mtc-check${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => set(k, on ? v.filter((x) => x !== r) : [...v, r])} /> {lbl}
            </label>
          );
        })}
      </div>
    );
  }

  function defaultText(k) {
    const m = meta(k);
    if (m.type === 'bool') return m.default ? L('On', 'مفعّل') : L('Off', 'مقفول');
    if (m.type === 'list_str') return (m.default || []).length ? m.default.join(', ') : L('Everyone', 'الكل');
    if (m.type === 'secret') return L('the .env value', 'قيمة ملف .env');
    if (m.type === 'enum') { const o = (SETTING_META[k] || {}).options || {}; return o[m.default] ? o[m.default][ar ? 'ar' : 'en'] : String(m.default); }
    return m.default === '' ? L('empty', 'فاضي') : String(m.default);
  }

  if (loading || !data) return <>{banner}<Skeleton rows={6} cols={3} /></>;

  const master = groups.includes('system') && meta('feature_meetings');
  const masterOn = master ? !!val('feature_meetings') : true;

  return (
    <div className="mtc-stack">
      {banner}
      {master && !masterOn && (
        <div className="st-alert st-alert--danger mtc-banner"><Icon name="alert-triangle" size={16} /><span>{L('The meetings system is OFF (after you save).', 'نظام الاجتماعات مقفول (بعد ما تحفظ).')}</span></div>
      )}

      <div className="mtc-savebar">
        <span className="mtc-muted">{dirty ? L(`${Object.keys(draft).length} unsaved change(s)`, `${Object.keys(draft).length} تغيير غير محفوظ`) : L('All changes saved', 'مفيش تغييرات غير محفوظة')}</span>
        <div className="mtc-actions">
          <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={resetAll}><Icon name="refresh" size={14} /> {L('Reset all to default', 'إرجاع الكل للافتراضي')}</button>
          {dirty && <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={() => setDraft({})}>{L('Discard', 'تجاهل')}</button>}
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}><Icon name="check" size={14} /> {saving ? L('Saving…', 'جارٍ الحفظ…') : L('Save', 'حفظ')}</button>
        </div>
      </div>

      {groups.map((g) => {
        const keys = keysIn(g);
        if (!keys.length) return null;
        const gm = GROUP_META[g];
        return (
          <section className="sa-card mtc-card" key={g}>
            <h2 className="mtc-card__title"><Icon name={gm.icon} size={16} /> {ar ? gm.ar : gm.en}</h2>
            {g === 'video' && (
              <div className="mtc-sfu-bar">
                <small className="mtc-muted">{L('Values saved here override the server .env. Resetting a value goes back to the .env one.', 'القيم اللي بتتحفظ هنا بتغلب ملف .env. لو رجّعت قيمة للافتراضي بترجع لقيمة .env.')}</small>
                <div className="mtc-inline">
                  <button type="button" className="btn btn-outline btn-sm" disabled={sfuTest === 'busy' || dirty} onClick={testSfu} title={dirty ? L('Save first', 'احفظ الأول') : undefined}>
                    <Icon name="check" size={14} /> {sfuTest === 'busy' ? L('Testing…', 'جارٍ الاختبار…') : L('Test connection', 'اختبار الاتصال')}
                  </button>
                  {sfuTest && sfuTest !== 'busy' && <span className={sfuTest.ok ? 'mtc-ok' : 'mtc-bad'} role="status">{sfuTest.text}</span>}
                </div>
              </div>
            )}
            <div className="mtc-settings">
              {keys.map((k) => {
                const sm = SETTING_META[k] || { en: k, ar: k };
                const m = meta(k);
                const changed = k in draft;
                const wide = m.type === 'string' || m.type === 'list_str' || m.type === 'secret';
                return (
                  <div key={k} className={`mtc-setting${wide ? ' mtc-setting--wide' : ''}${changed ? ' is-changed' : ''}`}>
                    <div className="mtc-setting__text">
                      <label htmlFor={`mtc-${k}`} className="mtc-setting__label">{ar ? sm.ar : sm.en}</label>
                      {(ar ? sm.hint_ar : sm.hint_en) && <small className="mtc-muted">{ar ? sm.hint_ar : sm.hint_en}</small>}
                      {m.overridden && !changed && (
                        <button type="button" className="mtc-link" onClick={() => resetOne(k)}>
                          <Icon name="refresh" size={11} /> {L('Default', 'الافتراضي')}: {defaultText(k)}
                        </button>
                      )}
                    </div>
                    <div className="mtc-setting__control">{renderControl(k)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} danger={confirm.danger} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}
