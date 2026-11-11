import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { ConfirmModal } from '../adminUi';
import { Skeleton } from '../AdminPage';
import { BASE, GROUP_META, ROLE_LABELS, SEARCH_PROVIDER_LABELS, SETTING_META, Switch, useBanner, useL } from './shared';

const UNIT = { MB: ['MB', 'ميجا'], KB: ['KB', 'ك.ب'], day: ['days', 'يوم'] };
const WIDE = ['list_role', 'list_ext', 'map_int'];
const FULL = ['secret', 'enum']; // text-like controls that need room: full-width row, label above
const isFull = (k, m) => FULL.includes(m.type) || (m.type === 'string' && k.startsWith('web_search_'));
const parseExt = (t) => [...new Set(String(t || '').split(/[\s,;]+/).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean))];

/** Renders the My PC settings catalog (GET /control/settings) for the given groups. One Save; each override can be reset alone.
 *  `footer` = { [group]: (ctx) => node } renders extra UI under a group (ctx has the live draft values). Secrets are write-only: the API never returns them. */
export default function SettingsTab({ groups, footer }) {
  const { ar, L } = useL();
  const { banner, setNotice, setError, clear } = useBanner();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [extText, setExtText] = useState(null);

  const apply = (d) => { setData(d); setDraft({}); setExtText(null); };
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

  async function run(fn, okMsg) {
    clear();
    try { const j = await fn(); apply(j.data); setNotice(okMsg || j.message); } catch (e) { setError(errorMessage(e)); }
  }
  async function save() {
    if (!dirty) return;
    setSaving(true);
    await run(() => api.put(`${BASE}/settings`, { values: draft }), L('Settings saved. They apply immediately.', 'تم الحفظ. التغيير بيسري فورًا.'));
    setSaving(false);
  }
  const resetOne = (k) => run(() => api.put(`${BASE}/settings`, { values: { [k]: null } }), L('Reset to default.', 'تم الرجوع للافتراضي.'));
  function resetAll() {
    setConfirm({
      title: L('Reset ALL My PC settings?', 'إرجاع كل إعدادات جهازي للافتراضي؟'),
      message: L('Every override goes back to the default values. Per-user limits are not touched.', 'كل التعديلات هترجع للقيم الافتراضية. حدود المستخدمين الفردية مش هتتأثر.'),
      danger: true,
      run: async () => { setConfirm(null); setSaving(true); await run(() => api.del(`${BASE}/settings`)); setSaving(false); },
    });
  }

  function defaultText(k) {
    const m = meta(k);
    if (m.type === 'bool') return m.default ? L('On', 'مفعّل') : L('Off', 'مقفول');
    if (m.type === 'list_role' || m.type === 'list_ext') return (m.default || []).length ? m.default.join(', ') : (m.type === 'list_role' ? L('Everyone', 'الكل') : L('none', 'لا شيء'));
    if (m.type === 'map_int') return L('none', 'لا شيء');
    if (m.type === 'secret') return L('the .env value', 'قيمة .env');
    return m.default === '' ? L('empty', 'فاضي') : String(m.default);
  }

  function renderControl(k) {
    const m = meta(k);
    const v = val(k);
    const sm = SETTING_META[k] || {};
    if (m.type === 'bool') return <Switch id={`dvs-${k}`} checked={!!v} onChange={(x) => set(k, x)} label={sm.en} />;
    if (m.type === 'int') {
      const u = UNIT[sm.unit];
      return (
        <div className="mtc-inline">
          <input id={`dvs-${k}`} className="form-input mtc-num" type="number" min={m.min ?? undefined} max={m.max ?? undefined} value={v}
            onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
          {u && <span className="mtc-muted">{ar ? u[1] : u[0]}</span>}
          <span className="mtc-muted mtc-range">{m.min}–{m.max}</span>
        </div>
      );
    }
    if (m.type === 'enum') {
      return (
        <select id={`dvs-${k}`} className="form-input" value={v} onChange={(e) => set(k, e.target.value)}>
          {(m.options || []).map((o) => <option key={o} value={o}>{SEARCH_PROVIDER_LABELS[o] ? SEARCH_PROVIDER_LABELS[o][ar ? 1 : 0] : o}</option>)}
        </select>
      );
    }
    if (m.type === 'secret') {
      const status = m.overridden ? L('Saved in the database', 'محفوظ في الداتابيز') : m.default_set ? L('Using the .env value', 'بيستخدم قيمة .env') : L('Not set', 'غير مظبوط');
      return (
        <div className="dvc-secret">
          <input id={`dvs-${k}`} className="form-input" type="password" dir="ltr" autoComplete="off" data-allow-clipboard maxLength={m.max_length || 500} value={v}
            placeholder={m.hint || L('Paste a new key…', 'الصق مفتاح جديد…')} onChange={(e) => set(k, e.target.value)} />
          <small className="mtc-muted">{status}{m.hint ? ` · ${m.hint}` : ''}</small>
        </div>
      );
    }
    if (m.type === 'string') return <input id={`dvs-${k}`} className="form-input" dir={sm.placeholder ? 'ltr' : undefined} maxLength={m.max_length || 300} placeholder={sm.placeholder} value={v} onChange={(e) => set(k, e.target.value)} />;
    if (m.type === 'list_ext') {
      const text = extText ?? (v || []).join(', ');
      return (
        <textarea id={`dvs-${k}`} className="form-input" rows={3} dir="ltr" value={text} placeholder="exe, bat, apk"
          onChange={(e) => { setExtText(e.target.value); set(k, parseExt(e.target.value)); }} />
      );
    }
    if (m.type === 'map_int') {
      const roles = data.available_roles || [];
      const cur = v || {};
      return (
        <div className="dvc-rolemap">
          {roles.map((r) => (
            <label key={r} className="dvc-rolemap__row">
              <span>{ROLE_LABELS[r] ? ROLE_LABELS[r][ar ? 1 : 0] : r}</span>
              <input className="form-input mtc-num" type="number" min={0} placeholder={L('default', 'افتراضي')} value={cur[r] ?? ''}
                onChange={(e) => {
                  const next = { ...cur };
                  if (e.target.value === '') delete next[r]; else next[r] = Math.max(0, Number(e.target.value));
                  set(k, next);
                }} />
              <span className="mtc-muted">MB</span>
            </label>
          ))}
        </div>
      );
    }
    // list_role
    const roles = data.available_roles || [];
    return (
      <div className="mtc-checks">
        {roles.map((r) => {
          const on = (v || []).includes(r);
          return (
            <label key={r} className={`mtc-check${on ? ' is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => set(k, on ? v.filter((x) => x !== r) : [...v, r])} /> {ROLE_LABELS[r] ? ROLE_LABELS[r][ar ? 1 : 0] : r}
            </label>
          );
        })}
      </div>
    );
  }

  if (loading || !data) return <>{banner}<Skeleton rows={6} cols={3} /></>;

  const masterOn = groups.includes('system') ? !!val('feature_drive') : true;

  return (
    <div className="mtc-stack">
      {banner}
      {!masterOn && <div className="st-alert st-alert--danger mtc-banner"><Icon name="alert-triangle" size={16} /><span>{L('My PC is OFF for everyone (after you save).', 'جهازي مقفول للجميع (بعد ما تحفظ).')}</span></div>}

      <div className="mtc-savebar">
        <span className="mtc-muted">{dirty ? L(`${Object.keys(draft).length} unsaved change(s)`, `${Object.keys(draft).length} تغيير غير محفوظ`) : L('All changes saved', 'مفيش تغييرات غير محفوظة')}</span>
        <div className="mtc-actions">
          <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={resetAll}><Icon name="refresh" size={14} /> {L('Reset all to default', 'إرجاع الكل للافتراضي')}</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={!dirty || saving} onClick={() => { setDraft({}); setExtText(null); }}>{L('Discard', 'تجاهل')}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}><Icon name="save" size={14} /> {saving ? '…' : L('Save', 'حفظ')}</button>
        </div>
      </div>

      {groups.map((g) => {
        const keys = Object.keys(data.values).filter((k) => data.values[k].group === g)
          .filter((k) => { const sw = SETTING_META[k]?.showWhen; return !sw || sw.includes(val('web_search_provider')); });
        if (!keys.length) return null;
        const gm = GROUP_META[g] || { en: g, ar: g, icon: 'settings' };
        return (
          <section key={g} className="sa-card mtc-card">
            <h2 className="mtc-card__title"><Icon name={gm.icon} size={16} /> {ar ? gm.ar : gm.en}</h2>
            <div className="mtc-settings">
              {keys.map((k) => {
                const sm = SETTING_META[k] || { en: k, ar: k };
                const m = meta(k);
                const changed = k in draft;
                return (
                  <div key={k} className={`mtc-setting${changed ? ' is-changed' : ''}${WIDE.includes(m.type) ? ' mtc-setting--wide' : ''}${isFull(k, m) ? ' mtc-setting--field' : ''}`}>
                    <div className="mtc-setting__text">
                      <label htmlFor={`dvs-${k}`} className="mtc-setting__label">{ar ? sm.ar : sm.en}</label>
                      {(ar ? sm.hint_ar : sm.hint_en) && <small className="mtc-muted">{ar ? sm.hint_ar : sm.hint_en}</small>}
                      {m.overridden && !changed && (
                        <button type="button" className="mtc-link" onClick={() => resetOne(k)}><Icon name="refresh" size={11} /> {L('Default', 'الافتراضي')}: {defaultText(k)}</button>
                      )}
                    </div>
                    <div className="mtc-setting__control">{renderControl(k)}</div>
                  </div>
                );
              })}
            </div>
            {footer?.[g]?.({ val, draft, data })}
          </section>
        );
      })}

      {data.disk && <p className="mtc-muted"><Icon name="hard-drive" size={12} /> {L('Storage disk', 'قرص التخزين')}: <b dir="ltr">{data.disk.name}</b> ({data.disk.driver})</p>}
      {confirm && <ConfirmModal title={confirm.title} message={confirm.message} danger={confirm.danger} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}
