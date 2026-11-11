import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/platform-policy';
import { Skeleton, ErrorState } from '../../components/admin/AdminPage';
import { ConfirmModal } from '../../components/admin/adminUi';
import JsonViewer from '../../components/admin/JsonViewer';
import { resetSecureChannel } from '../../api/secureTransport';
import { applyMotion } from '../../lib/motionPolicy';

const translations = { ...i18nCommon, ...i18nPage };

const BASE = '/api/v1/admin/platform-policy';

/** Switches shown as cards. `risky` ones ask for confirmation before being turned OFF. */
const SWITCHES = [
  { group: 'email', key: 'email_block_enabled', icon: 'x-circle', title: 'Custom block list', hint: 'Refuse sign-ups and email changes that match the blocked emails / domains below.' },
  { group: 'email', key: 'disposable_check', icon: 'mail', title: 'Block temporary-mail providers', hint: 'Built-in list of throw-away providers (mailinator, 10minutemail, …).' },
  { group: 'email', key: 'plus_addressing_check', icon: 'plus-circle', title: 'Block "+tag" aliases', hint: 'Refuse name+anything@domain addresses.' },
  { group: 'email', key: 'suspicious_gmail_check', icon: 'alert-triangle', title: 'Block random-looking Gmail', hint: 'Refuse Gmail addresses padded with dots / digit groups.' },
  { group: 'email', key: 'email_dns_check', icon: 'globe', title: 'Require a mail-capable domain', hint: 'The domain must have an MX or A record (checked at sign-up only).' },
  { group: 'access', key: 'persistent_login', icon: 'lock', title: 'Stay signed in (persistent sign-in)', hint: 'People are never signed out because of inactivity or because they closed the browser / app. They stay signed in until they sign out themselves, you remove the device, or the device limit below pushes it out. Turn off to bring back the inactivity timeout and a 14-day login.', risky: true },
  { group: 'platform', key: 'registration_enabled', icon: 'users', title: 'Public registration', hint: 'When off, nobody can create a new account (form or Google). Existing users are unaffected.', risky: true },
  { group: 'platform', key: 'animations_enabled', icon: 'sparkles', title: 'Platform animations', hint: 'Soft background shapes, pill / card / page-enter motion across the whole platform. Turn off if the platform feels slow: every page becomes static for everyone within a few minutes (right away for you).' },
  { group: 'platform', key: 'messaging_restricted', icon: 'mail', title: 'Restrict student messaging', hint: 'Off: anyone can message anyone. On: a student can only start chats with their own project group, university, faculty, staff and assigned supervisor (or with an approved permission request).' },
  { group: 'platform', key: 'require_university_link', icon: 'building', title: 'Require a university link', hint: 'On: a student account with no university can only use the profile and notifications until a university or faculty approves it, or an admin / university / faculty grants it access (Access & Pricing). Off: no restriction.' },
  { group: 'platform', key: 'calls_enabled', icon: 'phone', title: 'Calls', hint: 'Voice (and video, if enabled) calls inside chats. Off: the call buttons stop working for everyone. Same as CALLS_ENABLED in the server .env — whichever you set here wins.' },
  { group: 'platform', key: 'calls_video_enabled', icon: 'video', title: 'Video calls', hint: 'Allow video in calls (needs Calls on). Same as CALLS_VIDEO_ENABLED in the server .env.' },
  { group: 'platform', key: 'drive_direct', icon: 'upload', title: 'Direct cloud uploads', hint: 'Browsers upload to / download from the storage bucket directly with signed links, so the server does not carry the files. Same as DRIVE_DIRECT in the server .env.' },
  { group: 'platform', key: 'response_encryption', icon: 'lock', title: 'API response encryption', hint: 'AES-GCM envelope on every JSON response. When off, responses are plain JSON (easier to debug, visible in the browser Network tab).', risky: true },
  { group: 'platform', key: 'response_enc_enforce', icon: 'shield', title: 'Require encrypted responses', hint: 'Clients that cannot negotiate an encryption key are refused instead of getting plain JSON. Needs response encryption to be on.', riskyOn: true, needsEncryption: true },
  { group: 'platform', key: 'request_enc_enforce', icon: 'shield', title: 'Require encrypted requests', hint: 'JSON request bodies must arrive encrypted (uploads are exempt). Needs response encryption to be on.', riskyOn: true, needsEncryption: true },
];

const RISKY_CONFIRM = {
  response_enc_enforce: {
    title: 'Require encrypted responses?',
    message: 'Any client that cannot encrypt (old app versions, scripts, integrations) will be refused. If something breaks, come back here and turn this off.',
    confirm: 'Require encryption',
    on: true,
  },
  request_enc_enforce: {
    title: 'Require encrypted requests?',
    message: 'Any JSON request that is not encrypted will be refused. If something breaks, come back here and turn this off.',
    confirm: 'Require encryption',
    on: true,
  },
  registration_enabled: {
    title: 'Close public registration?',
    message: 'Nobody will be able to create a new account until you open it again. Existing users can still sign in.',
    confirm: 'Close registration',
  },
  persistent_login: {
    title: 'Turn off persistent sign-in?',
    message: 'People will be signed out after the inactivity timeout (Security → Policies → Sessions) and logins will last 14 days instead of a year. Sessions that are already open follow the new rules from their next refresh.',
    confirm: 'Turn off',
  },
  response_encryption: {
    title: 'Turn off response encryption?',
    message: 'API responses will travel as plain JSON — anyone who can see the traffic (browser Network tab, a proxy) can read them. Only do this for debugging or if encryption causes problems.',
    confirm: 'Turn off encryption',
  },
};

const TYPE_LABEL = { domain: 'Domain', email: 'Email', pattern: 'Pattern' };

function Switch({ checked, disabled, onChange, label }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
    </label>
  );
}

function SwitchRow({ def, value, busy, locked, lockedNote, onToggle, t }) {
  return (
    <div className="adm-policy">
      <div className="adm-policy__head">
        <div className="adm-policy__title"><span className="adm-policy__icon"><Icon name={def.icon} size={16} /></span>{t(def.title)}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className={`badge ${value ? 'badge-success' : 'badge-neutral'}`}>{value ? t('On') : t('Off')}</span>
          <Switch checked={value} disabled={busy || locked} label={t(def.title)} onChange={(v) => onToggle(def, v)} />
        </div>
      </div>
      <span className="adm-field__hint">{t(def.hint)}</span>
      {locked && lockedNote && <span className="adm-note" style={{ color: 'var(--color-warning)' }}><Icon name="alert" size={15} /> {lockedNote}</span>}
    </div>
  );
}

function RulesPanel({ list, title, hint, rules, onChanged, t }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone: 'ok' | 'err', text }
  const [q, setQ] = useState('');
  const [removing, setRemoving] = useState(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rules.filter((r) => r.value.includes(needle) || (r.note || '').toLowerCase().includes(needle)) : rules;
  }, [rules, q]);

  async function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const json = await api.post(`${BASE}/rules`, { list, values: text, note: note.trim() || undefined });
      const r = json.data?.result || {};
      onChanged(json.data);
      const parts = [];
      if (r.added?.length) parts.push(t('{n} added').replace('{n}', r.added.length));
      if (r.duplicates?.length) parts.push(t('{n} already in the list').replace('{n}', r.duplicates.length));
      if (r.protected?.length) parts.push(t('{n} skipped — would block your own account').replace('{n}', r.protected.length));
      if (r.invalid?.length) parts.push(t('{n} not valid: {list}').replace('{n}', r.invalid.length).replace('{list}', `\u2066${r.invalid.slice(0, 3).join(', ')}\u2069`));
      if (r.full) parts.push(t('List is full'));
      setMsg({ tone: r.added?.length ? 'ok' : 'err', text: parts.join(' · ') || t('Nothing to add') });
      if (!r.invalid?.length && !r.protected?.length) { setText(''); setNote(''); }
      else setText((r.invalid || []).join('\n'));
    } catch (err) {
      setMsg({ tone: 'err', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const rule = removing;
    setBusy(true);
    try {
      const json = await api.del(`${BASE}/rules`, { list, value: rule.value });
      onChanged(json.data);
      setMsg(null);
    } catch (err) {
      setMsg({ tone: 'err', text: errorMessage(err) });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel__head">
        <div><h2>{title} <span className="badge badge-neutral">{rules.length}</span></h2><p>{hint}</p></div>
      </div>

      <form onSubmit={add} className="pp-add">
        <label className="adm-field__label" htmlFor={`pp-${list}-values`}>{t('Emails or domains')}</label>
        <textarea id={`pp-${list}-values`} className="form-input pp-textarea" dir="ltr" rows={3} value={text}
          onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={'spam.com\nbad@example.com\nbot*@*.xyz'} />
        <input className="form-input" value={note} maxLength={190} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (optional)')} />
        <div className="pp-add__foot">
          <span className="grow">
            {msg && <span className={`adm-note ${msg.tone === 'ok' ? 'adm-note--ok' : 'adm-note--err'}`}><Icon name={msg.tone === 'ok' ? 'check-circle' : 'alert'} size={15} /> {msg.text}</span>}
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
            <Icon name="plus" size={16} /> {busy ? t('Saving…') : t('Add')}
          </button>
        </div>
        <span className="adm-field__hint">{t('One per line or separated by commas. "spam.com" covers every sub-domain; use * for patterns.')}</span>
      </form>

      {rules.length > 6 && (
        <input className="form-input pp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} aria-label={t('Search')} />
      )}

      {rules.length === 0 ? (
        <p className="text-small pp-empty">{t('Nothing here yet.')}</p>
      ) : (
        <ul className="pp-rules">
          {shown.map((r) => (
            <li key={r.value} className="pp-rule">
              <div className="pp-rule__main">
                <code dir="ltr" className="pp-rule__value">{r.value}</code>
                <div className="pp-rule__meta">
                  <span className="badge badge-neutral">{t(TYPE_LABEL[r.type] || r.type)}</span>
                  {r.added_at && <span>{r.added_at.slice(0, 10)}</span>}
                  {r.note && <span className="pp-rule__note">{r.note}</span>}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" title={t('Remove')} aria-label={t('Remove')} onClick={() => setRemoving(r)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="text-small pp-empty">{t('No match.')}</li>}
        </ul>
      )}

      {removing && (
        <ConfirmModal
          title={t('Remove rule?')}
          message={t('Remove "{rule}" from the list?').replace('{rule}', removing.value)}
          confirmLabel={t('Remove')}
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

const GATE_GROUPS = {
  admin: { icon: 'settings', title: 'Platform administrators', hint: 'Opens the admin sign-in only.' },
  security: { icon: 'shield', title: 'Security team', hint: 'Opens the security admin and security officer sign-in.' },
  data_analyst: { icon: 'chart', title: 'Data analysts', hint: 'Opens the data analyst sign-in only.' },
};

/** 6 random digits from the browser's CSPRNG. */
function randomCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n % 10).join('');
}

function StaffCodeModal({ group, info, limits, onClose, onSaved, t }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const meta = GATE_GROUPS[group];
  const tooShort = code.length > 0 && code.length < limits.code_min;

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const json = await api.put(`${BASE}/staff-gate/${group}`, { code: code.trim(), password });
      onSaved(json.data);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const json = await api.del(`${BASE}/staff-gate/${group}`, { password });
      onSaved(json.data);
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 className="modal-box__title text-h3">{t(meta.title)}</h2>
        <p className="adm-modal-text">{t('The current code is never shown. Set a new one — the old one stops working and open access sessions of this group must enter the new code.')}</p>
        <div className="adm-field" style={{ marginBottom: 'var(--space-3)' }}>
          <label className="adm-field__label" htmlFor="pp-gate-code">{t('New access code')}</label>
          <div className="ppol-code">
            <input id="pp-gate-code" className="form-input" dir="ltr" type={show ? 'text' : 'password'} value={code} autoComplete="off" spellCheck={false}
              maxLength={limits.code_max} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} autoFocus />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide code') : t('Show code')}><Icon name={show ? 'eye-off' : 'eye'} size={16} /></button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { setCode(randomCode()); setShow(true); }}>{t('Generate')}</button>
          </div>
          <span className="adm-field__hint">{t('{min}–{max} letters or digits. Longer is safer — 6 or more is recommended.').replace('{min}', limits.code_min).replace('{max}', limits.code_max)}</span>
          {tooShort && <span className="adm-note adm-note--err"><Icon name="alert" size={15} /> {t('Too short')}</span>}
        </div>
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="pp-gate-pass">{t('Your password')}</label>
          <input id="pp-gate-pass" className="form-input" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="adm-field__hint">{t('Re-enter your own password to confirm.')}</span>
        </div>
        {err && <p className="adm-note adm-note--err" style={{ marginTop: 'var(--space-3)' }}><Icon name="alert" size={15} /> {err}</p>}
        <div className="modal-box__actions">
          {info.source === 'dashboard' && (
            <button type="button" className="btn btn-ghost" style={{ marginInlineEnd: 'auto' }} disabled={busy || !password} onClick={reset}>{t('Reset to server default')}</button>
          )}
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || code.length < limits.code_min || !password}>{busy ? t('Saving…') : t('Save')}</button>
        </div>
      </form>
    </div>
  );
}

/** Access codes of the hidden staff sign-in (/staff-access). Stored hashed; never readable. */
function StaffCodesPanel({ t }) {
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    api.get(`${BASE}/staff-gate`).then((json) => setGate(json.data)).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <section className="adm-panel"><p className="adm-note adm-note--err"><Icon name="alert" size={15} /> {error}</p></section>;
  if (!gate) return null;

  const srcLabel = { dashboard: t('Set from dashboard'), server: t('Server default'), none: t('No code — nobody can enter') };

  return (
    <section className="adm-panel">
      <div className="adm-panel__head">
        <div><h2>{t('Staff access codes')}</h2><p>{t('The code asked before the hidden staff sign-in. Each code opens only its own kind of account.')}</p></div>
        <span className={`badge ${gate.enabled ? 'badge-success' : 'badge-neutral'}`}>{gate.enabled ? t('On') : t('Off')}</span>
      </div>
      {!gate.enabled && <p className="adm-note" style={{ color: 'var(--color-warning)' }}><Icon name="alert" size={15} /> {t('The gate is switched off on the server (STAFF_GATE_ENABLED=false).')}</p>}
      {flash && <p className="adm-note adm-note--ok"><Icon name="check-circle" size={15} /> {flash}</p>}
      {gate.groups.map((g) => {
        const meta = GATE_GROUPS[g.group] || { icon: 'lock', title: g.group, hint: '' };
        return (
          <div className="adm-policy" key={g.group}>
            <div className="adm-policy__head">
              <div className="adm-policy__title"><span className="adm-policy__icon"><Icon name={meta.icon} size={16} /></span>{t(meta.title)}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span className={`badge ${g.source === 'dashboard' ? 'badge-primary' : 'badge-neutral'}`}>{srcLabel[g.source]}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { setFlash(null); setEditing(g); }}><Icon name="lock" size={15} /> {t('Change code')}</button>
              </div>
            </div>
            <span className="adm-field__hint">{t(meta.hint)}{g.changed_at ? ` · ${t('Changed')} ${g.changed_at.slice(0, 10)}` : ''}</span>
          </div>
        );
      })}
      {editing && (
        <StaffCodeModal group={editing.group} info={editing} limits={gate} t={t} onClose={() => setEditing(null)}
          onSaved={(data) => { setGate(data); setEditing(null); setFlash(t('Access code saved.')); }} />
      )}
    </section>
  );
}

/** Devices-per-account policy: how many devices each kind of account may stay signed in on (0 = unlimited). */
function DevicesPanel({ devices, onSaved, t, lead }) {
  const { locale } = useLanguage();
  const roles = devices?.roles || [];
  const initial = useMemo(() => {
    const o = { default: String(devices?.default ?? 1), defaultUnlimited: Number(devices?.default) === 0, mode: devices?.mode || 'replace_oldest', roles: {} };
    roles.forEach((r) => {
      o.roles[r.slug] = r.overridden ? { value: r.limit === 0 ? '' : String(r.limit), unlimited: r.limit === 0 } : { value: '', unlimited: false };
    });
    return o;
  }, [devices]); // eslint-disable-line react-hooks/exhaustive-deps
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setForm(initial); }, [initial]);

  const payload = useMemo(() => {
    const rolesOut = {};
    Object.entries(form.roles).forEach(([slug, r]) => {
      if (r.unlimited) rolesOut[slug] = 0;
      else if (String(r.value).trim() !== '') rolesOut[slug] = Number(r.value);
    });
    return { default: form.defaultUnlimited ? 0 : Number(form.default), mode: form.mode, roles: rolesOut };
  }, [form]);
  const initialPayload = useMemo(() => {
    const rolesOut = {};
    Object.entries(initial.roles).forEach(([slug, r]) => {
      if (r.unlimited) rolesOut[slug] = 0;
      else if (String(r.value).trim() !== '') rolesOut[slug] = Number(r.value);
    });
    return { default: initial.defaultUnlimited ? 0 : Number(initial.default), mode: initial.mode, roles: rolesOut };
  }, [initial]);
  const dirty = JSON.stringify(payload) !== JSON.stringify(initialPayload);
  const invalid = !form.defaultUnlimited && !(Number.isInteger(Number(form.default)) && String(form.default).trim() !== '' && Number(form.default) >= 1);
  const badRole = Object.values(form.roles).some((r) => !r.unlimited && String(r.value).trim() !== '' && !(Number.isInteger(Number(r.value)) && Number(r.value) >= 1));

  const setRole = (slug, patch) => setForm((f) => ({ ...f, roles: { ...f.roles, [slug]: { ...f.roles[slug], ...patch } } }));
  const defaultLabel = form.defaultUnlimited ? t('Unlimited') : form.default;

  async function save(e) {
    e.preventDefault();
    if (!dirty || invalid || badRole) return;
    setBusy(true); setMsg(null);
    try {
      const json = await api.put(`${BASE}/devices`, payload);
      onSaved(json.data);
      setMsg({ tone: 'ok', text: t('Saved.') });
    } catch (err) {
      setMsg({ tone: 'err', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true); setMsg(null);
    try {
      const json = await api.del(`${BASE}/devices`);
      onSaved(json.data);
      setMsg({ tone: 'ok', text: t('Back to the server default.') });
    } catch (err) {
      setMsg({ tone: 'err', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const cell = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' };
  const num = { width: 110 };

  return (
    <section className="adm-panel">
      <div className="adm-panel__head">
        <div>
          <h2>{t('Devices per account')}</h2>
          <p>{t('How many devices each kind of account may stay signed in on at the same time. Set any number, or Unlimited. The same browser or app never counts twice. A change applies from the next sign-in; devices that are already signed in are not touched.')}</p>
        </div>
        <span className={`badge ${devices?.overridden ? 'badge-primary' : 'badge-neutral'}`}>{devices?.overridden ? t('Set from dashboard') : t('Server default')}</span>
      </div>

      {lead}

      <form onSubmit={save}>
        <div className="adm-policy">
          <div className="adm-policy__head"><div className="adm-policy__title"><span className="adm-policy__icon"><Icon name="shield" size={16} /></span>{t('When the limit is reached')}</div></div>
          <select className="form-input" value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))} aria-label={t('When the limit is reached')}>
            <option value="replace_oldest">{t('Sign the oldest device out and let the new one in')}</option>
            <option value="block">{t('Refuse the new sign-in (the owner can sign a device out from the login page)')}</option>
          </select>
        </div>

        <div className="adm-policy">
          <div className="adm-policy__head"><div className="adm-policy__title"><span className="adm-policy__icon"><Icon name="users" size={16} /></span>{t('Default for every account type')}</div></div>
          <div style={cell}>
            <input className="form-input" style={num} type="number" min={1} max={devices?.max || 1000000} dir="ltr" disabled={form.defaultUnlimited}
              value={form.defaultUnlimited ? '' : form.default} placeholder="∞" aria-label={t('Default for every account type')}
              onChange={(e) => setForm((f) => ({ ...f, default: e.target.value }))} />
            <label style={cell}><input type="checkbox" checked={form.defaultUnlimited} onChange={(e) => setForm((f) => ({ ...f, defaultUnlimited: e.target.checked }))} /> {t('Unlimited')}</label>
          </div>
          <span className="adm-field__hint">{t('Used by every account type below that has no number of its own.')}</span>
        </div>

        <div className="adm-policy">
          <div className="adm-policy__head"><div className="adm-policy__title"><span className="adm-policy__icon"><Icon name="user" size={16} /></span>{t('Per account type')}</div></div>
          {roles.length === 0 && <span className="adm-field__hint">{t('No account types found.')}</span>}
          {roles.map((r) => {
            const st = form.roles[r.slug] || { value: '', unlimited: false };
            const name = (locale === 'ar' ? r.name_ar : r.name_en) || r.name_en || r.slug;
            return (
              <div key={r.slug} style={{ ...cell, justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ minWidth: 150 }}><strong>{name}</strong> <code dir="ltr" style={{ opacity: 0.6 }}>{r.slug}</code></span>
                <span style={cell}>
                  <input className="form-input" style={num} type="number" min={1} max={devices?.max || 1000000} dir="ltr" disabled={st.unlimited}
                    value={st.unlimited ? '' : st.value} placeholder={st.unlimited ? '∞' : `${t('Default')}: ${defaultLabel}`} aria-label={name}
                    onChange={(e) => setRole(r.slug, { value: e.target.value })} />
                  <label style={cell}><input type="checkbox" checked={st.unlimited} onChange={(e) => setRole(r.slug, { unlimited: e.target.checked })} /> {t('Unlimited')}</label>
                </span>
              </div>
            );
          })}
          <span className="adm-field__hint">{t('Leave a box empty to use the default. For example: students 2, university 1, admin 5.')}</span>
        </div>

        <div className="pp-add__foot">
          <span className="grow">
            {msg && <span className={`adm-note ${msg.tone === 'ok' ? 'adm-note--ok' : 'adm-note--err'}`}><Icon name={msg.tone === 'ok' ? 'check-circle' : 'alert'} size={15} /> {msg.text}</span>}
            {(invalid || badRole) && <span className="adm-note adm-note--err"><Icon name="alert" size={15} /> {t('Use a whole number of 1 or more, or tick Unlimited.')}</span>}
          </span>
          {devices?.overridden && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={reset}>{t('Reset to server default')}</button>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !dirty || invalid || badRole}>{busy ? t('Saving…') : t('Save changes')}</button>
        </div>
      </form>
    </section>
  );
}

const VALUE_FIELDS = [
  { key: 'platform_name', icon: 'edit', title: 'Platform name', hint: 'Shown in the header and footer of every email the platform sends.', type: 'text', maxLength: 60 },
  { key: 'app_token', icon: 'lock', title: 'Android app token', hint: 'The API token the official Android app sends (issue one in Mobile App Management). The app fetches it at launch, so no VITE_APP_TOKEN / rebuild is needed. Stored encrypted — only a masked preview is shown; paste a new one to replace it.', type: 'password', maxLength: 200, ltr: true, secret: true, placeholder: 'Paste the token here' },
  { key: 'google_client_ids', icon: 'globe', title: 'Google sign-in client IDs', hint: 'Public Web client ID(s), comma-separated. Leave empty to turn Google sign-in off.', type: 'text', maxLength: 700, ltr: true, placeholder: '123456789-abc.apps.googleusercontent.com' },
];

const GITHUB_FIELDS = [
  { key: 'github_client_id', icon: 'github', title: 'GitHub Client ID', hint: 'From GitHub → Settings → Developer settings → OAuth Apps. Public value.', type: 'text', maxLength: 100, ltr: true, placeholder: 'Ov23li…' },
  { key: 'github_client_secret', icon: 'lock', title: 'GitHub Client Secret', hint: 'Stored encrypted — only a masked preview is shown. Paste a new one to replace it.', type: 'password', maxLength: 200, ltr: true, secret: true, placeholder: 'Paste the client secret here' },
  { key: 'github_oauth_redirect', icon: 'link', title: 'GitHub callback URL', hint: 'Must match the “Authorization callback URL” of your OAuth App exactly, and end with /api/v1/github/callback.', type: 'text', maxLength: 300, ltr: true, placeholder: 'https://your-site.com/api/v1/github/callback' },
];

const LINK_FIELDS = [
  { key: 'frontend_url', icon: 'link', title: 'Website address (FRONTEND_URL)', hint: 'Used for the links inside e-mails, push notifications and password-reset pages, for example https://uip-nub.vercel.app. Leave empty to use the server .env value.', type: 'text', maxLength: 300, ltr: true, placeholder: 'https://your-site.com' },
  { key: 'cors_allowed_origins', icon: 'globe', title: 'Allowed websites (CORS)', hint: 'Websites allowed to call the API, comma-separated, for example https://uip-nub.vercel.app,https://localhost. Leave empty to use the server .env value.', type: 'text', maxLength: 1500, ltr: true, placeholder: 'https://app.example.com,https://localhost' },
];

const CLOUD_FIELDS = [
  { key: 'google_drive_redirect', icon: 'link', title: 'Google Drive callback URL', hint: 'https://<api-domain>/api/v1/cloud/google/callback — must also be listed in the Google OAuth client. (GOOGLE_DRIVE_REDIRECT)', type: 'text', maxLength: 300, ltr: true, placeholder: 'https://api.example.com/api/v1/cloud/google/callback' },
  { key: 'ms_client_id', icon: 'globe', title: 'Microsoft (OneDrive) client ID', hint: 'Application (client) ID from Entra ID / Azure. Public value. (MS_CLIENT_ID)', type: 'text', maxLength: 100, ltr: true, placeholder: '00000000-0000-0000-0000-000000000000' },
  { key: 'ms_authority', icon: 'link', title: 'Microsoft authority', hint: 'https://login.microsoftonline.com/common for personal + university accounts, or …/<tenant-id>. (MS_AUTHORITY)', type: 'text', maxLength: 300, ltr: true, placeholder: 'https://login.microsoftonline.com/common' },
  { key: 'drive_direct_ttl_min', icon: 'clock', title: 'Signed upload/download link lifetime (minutes)', hint: 'How long a direct-to-bucket link stays valid. (DRIVE_DIRECT_TTL_MIN)', type: 'number', min: 1, max: 1440 },
];

const CALL_FIELDS = [
  { key: 'cf_turn_key_id', icon: 'phone', title: 'Cloudflare TURN key ID', hint: 'Cloudflare ▸ Realtime ▸ TURN. Helps calls connect on strict networks. (CF_TURN_KEY_ID)', type: 'text', maxLength: 100, ltr: true, placeholder: 'Key ID' },
  { key: 'cf_turn_api_token', icon: 'lock', title: 'Cloudflare TURN API token', hint: 'Stored encrypted — only a masked preview is shown. Paste a new one to replace it. (CF_TURN_API_TOKEN)', type: 'password', maxLength: 300, ltr: true, secret: true, placeholder: 'Paste the API token here' },
];

const SANDBOX_FIELDS = [
  { key: 'sandbox_url', icon: 'globe', title: 'Project sandbox address', hint: 'Address of the separate sandbox service that runs students’ projects. (SANDBOX_URL)', type: 'text', maxLength: 300, ltr: true, placeholder: 'https://sandbox.example.com' },
  { key: 'sandbox_jwt_secret', icon: 'lock', title: 'Sandbox shared secret', hint: 'Must be identical on the sandbox service. Stored encrypted — only a masked preview is shown. (SANDBOX_JWT_SECRET)', type: 'password', maxLength: 300, ltr: true, secret: true, placeholder: 'Paste the secret here' },
];

const APP_FIELDS = [
  { key: 'app_download_url', icon: 'download', title: 'APK download link', hint: 'The https:// link people tap to download the Android app (Google Drive, GitHub Releases, your own file host…). Change it any time — it updates on the site instantly, no rebuild. Leave empty to hide every download button.', type: 'text', maxLength: 500, ltr: true, placeholder: 'https://…/uip.apk' },
  { key: 'app_download_version', icon: 'info', title: 'App version (optional)', hint: 'Shown next to “Mobile app” on the landing page, for example 1.4.0.', type: 'text', maxLength: 30, ltr: true, placeholder: '1.0.0' },
];

const PUSH_FIELDS = [
  { key: 'fcm_credentials_json', icon: 'lock', title: 'Firebase service-account key', hint: 'Open the downloaded .json file, copy everything inside it and paste it here (base64 also works). Stored encrypted — only the service-account email is shown afterwards. Leave empty to use the server .env (FCM_CREDENTIALS_JSON / FCM_CREDENTIALS_PATH).', type: 'text', textarea: true, maxLength: 12000, ltr: true, secret: true, placeholder: '{ "type": "service_account", "project_id": "…", … }' },
  { key: 'fcm_project_id', icon: 'globe', title: 'Firebase project ID', hint: 'Optional. Leave empty to take it from the key above (for example uip-nub).', type: 'text', maxLength: 100, ltr: true, placeholder: 'uip-nub' },
];

const OTP_FIELDS = [
  { key: 'otp_max_wrong', icon: 'shield', title: 'Wrong codes before a block', hint: 'Wrong guesses (on any code) for the same account before it is blocked. A new code does not reset the count.', type: 'number', min: 1, max: 20 },
  { key: 'otp_block_minutes', icon: 'clock', title: 'Block duration (minutes)', hint: 'How long the account is blocked from requesting or checking codes. Applies to blocks that start after you save.', type: 'number', min: 1, max: 1440 },
  { key: 'otp_max_sends', icon: 'mail', title: 'Codes per window', hint: 'More codes than this inside the window below triggers the same block. The 60-second wait between two requests still applies.', type: 'number', min: 1, max: 50 },
  { key: 'otp_send_window_minutes', icon: 'clock', title: 'Send window (minutes)', hint: 'The period in which the codes above are counted. A window that already started finishes with its old length.', type: 'number', min: 1, max: 1440 },
];

/** Settings that used to need an .env edit. Reset = go back to the server (.env) value. */
function ValuesPanel({ values, onSaved, t, fields = VALUE_FIELDS, title = 'General settings', subtitle = 'Values that used to be edited in the server .env file. Resetting a value brings back the server default.' }) {
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : String(values?.[f.key]?.value ?? '')])), [values, fields]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setForm(initial); }, [initial]);

  const dirty = fields.filter((f) => form[f.key] !== initial[f.key]);

  async function send(payload) {
    setBusy(true); setMsg(null);
    try {
      const json = await api.put(`${BASE}/values`, { values: payload });
      onSaved(json.data);
      setMsg({ tone: 'ok', text: t('Saved.') });
    } catch (err) {
      setMsg({ tone: 'err', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function save(e) {
    e.preventDefault();
    if (!dirty.length) return;
    send(Object.fromEntries(dirty.map((f) => [f.key, form[f.key]])));
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel__head"><div><h2>{t(title)}</h2><p>{t(subtitle)}</p></div></div>
      <form onSubmit={save}>
        {fields.map((f) => {
          const meta = values?.[f.key] || {};
          return (
            <div className="adm-policy" key={f.key}>
              <div className="adm-policy__head">
                <label className="adm-policy__title" htmlFor={`pp-val-${f.key}`}><span className="adm-policy__icon"><Icon name={f.icon} size={16} /></span>{t(f.title)}</label>
                <span className={`badge ${meta.overridden ? 'badge-primary' : 'badge-neutral'}`}>{meta.overridden ? t('Set from dashboard') : (f.secret ? t('Not set') : t('Server default'))}</span>
              </div>
              <div className="ppol-code">
                {f.textarea ? (
                  <textarea id={`pp-val-${f.key}`} className="form-input pp-textarea" dir="ltr" rows={4}
                    value={form[f.key] ?? ''} maxLength={f.maxLength} spellCheck={false}
                    placeholder={f.secret && meta.overridden ? meta.value : f.placeholder} autoComplete="off"
                    name={`pp-${f.key}-field`} autoCapitalize="off" autoCorrect="off"
                    data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-allow-clipboard=""
                    style={f.secret && form[f.key] ? { WebkitTextSecurity: 'disc' } : undefined}
                    onChange={(e) => setForm((o) => ({ ...o, [f.key]: e.target.value }))} />
                ) : (
                <input id={`pp-val-${f.key}`} className="form-input" type={f.secret ? 'text' : f.type} dir={f.ltr || f.type === 'number' ? 'ltr' : undefined}
                  value={form[f.key] ?? ''} min={f.min} max={f.max} maxLength={f.maxLength} spellCheck={false}
                  placeholder={f.secret && meta.overridden ? meta.value : f.placeholder} autoComplete={f.secret ? 'off' : undefined}
                  name={f.secret ? `pp-${f.key}-field` : undefined} autoCapitalize="off" autoCorrect="off"
                  data-lpignore={f.secret ? 'true' : undefined} data-1p-ignore={f.secret ? 'true' : undefined} data-form-type={f.secret ? 'other' : undefined} data-allow-clipboard={f.secret ? '' : undefined}
                  style={f.secret ? { WebkitTextSecurity: 'disc' } : undefined}
                  onChange={(e) => setForm((o) => ({ ...o, [f.key]: e.target.value }))} />
                )}
                {meta.overridden && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => send({ [f.key]: null })}>{t('Reset to server default')}</button>
                )}
              </div>
              <span className="adm-field__hint">{t(f.hint)}</span>
            </div>
          );
        })}
        <div className="pp-add__foot">
          <span className="grow">
            {msg && <span className={`adm-note ${msg.tone === 'ok' ? 'adm-note--ok' : 'adm-note--err'}`}><Icon name={msg.tone === 'ok' ? 'check-circle' : 'alert'} size={15} /> {msg.text}</span>}
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !dirty.length}>{busy ? t('Saving…') : t('Save changes')}</button>
        </div>
      </form>
    </section>
  );
}

function TestPanel({ t }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);

  async function run(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setRes(null);
    try {
      const json = await api.post(`${BASE}/test`, { email: email.trim() });
      setRes(json.data);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  const reason = res && !res.allowed ? {
    custom_block: t('Matches your block list'),
    disposable: t('Temporary-mail provider'),
    pattern: t('Looks like an alias / generated address'),
    dns: t('Domain cannot receive mail'),
  }[res.code] : null;

  return (
    <section className="adm-panel">
      <div className="adm-panel__head"><div><h2>{t('Test an address')}</h2><p>{t('See what the sign-up form would say for an email, using the current rules.')}</p></div></div>
      <form onSubmit={run} className="pp-test">
        <input className="form-input" dir="ltr" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" aria-label={t('Email')} />
        <button type="submit" className="btn btn-outline" disabled={busy || !email.includes('@')}><Icon name="search" size={16} /> {busy ? '…' : t('Test')}</button>
      </form>
      {err && <p className="adm-note adm-note--err" style={{ marginTop: 'var(--space-3)' }}><Icon name="alert" size={15} /> {err}</p>}
      {res && (
        <div className={`pp-verdict ${res.allowed ? 'pp-verdict--ok' : 'pp-verdict--no'}`}>
          <Icon name={res.allowed ? 'check-circle' : 'x-circle'} size={18} />
          <div>
            <strong>{res.allowed ? (res.code === 'allow_list' ? t('Accepted — on the allow list') : t('Accepted')) : t('Refused')}</strong>
            {reason && <div>{reason}{res.rule ? <> · <code dir="ltr">{res.rule}</code></> : null}</div>}
            {!res.allowed && res.message && <div className="adm-field__hint">{res.message}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Paste a captured encrypted response ({"enc":"v1","kid":…,"d":…}) → readable JSON. The key never leaves the server. */
function DecryptPanel({ t }) {
  const [text, setText] = useState('');
  const [kid, setKid] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState(null);

  async function run(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setOut(null);
    try {
      const json = await api.post(`${BASE}/decrypt`, { envelope: text.trim(), kid: kid.trim() || undefined });
      setOut(json.data);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adm-panel">
      <div className="adm-panel__head"><div><h2>{t('Decrypt a response')}</h2><p>{t('Paste an encrypted API response copied from the browser Network tab to read it. Works only while its session key is still alive (a couple of hours after the page was opened). The key itself is never shown.')}</p></div></div>
      <form onSubmit={run}>
        <textarea className="form-input pp-textarea" dir="ltr" rows={4} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          placeholder={'{"enc":"v1","kid":"…","d":"…"}'} aria-label={t('Encrypted response')} />
        <div className="pp-test" style={{ marginTop: 'var(--space-3)' }}>
          <input className="form-input" dir="ltr" type="text" value={kid} onChange={(e) => setKid(e.target.value)} placeholder={t('Key ID (kid) — only if you pasted just the "d" value')} aria-label="kid" />
          <button type="submit" className="btn btn-outline" disabled={busy || !text.trim()}><Icon name="lock" size={16} /> {busy ? '…' : t('Decrypt')}</button>
        </div>
      </form>
      {err && <p className="adm-note adm-note--err" style={{ marginTop: 'var(--space-3)' }}><Icon name="alert" size={15} /> {err}</p>}
      {out && (
        <div>
          <JsonViewer value={out.json} text={out.text} filename={`response-${out.status}.json`} meta={`HTTP ${out.status}`}
            labels={{ tree: t('Tree'), outline: t('Outline'), theme: t('Theme'), dark: t('Dark'), light: t('Light'), code: t('Code'), search: t('Search keys & values…'), expand: t('Expand all'), collapse: t('Collapse all'), copy: t('Copy'), copied: t('Copied'), download: t('Download'), full: t('Full screen'), exit: t('Exit full screen'), nodes: t('nodes'), lines: t('lines'), path: t('Click a node to see its path'), matches: t('matches'), wrap: t('Wrap'), zoomIn: t('Zoom in'), zoomOut: t('Zoom out'), zoomHint: t('Ctrl + mouse wheel to zoom'), fit: t('Fit to screen'), resetLayout: t('Reset layout'), dragHint: t('drag to move'), resize: t('Drag to resize') }} />
        </div>
      )}
    </section>
  );
}

/**
 * Admin → Platform Policy. Everything here is live (stored in the `settings` table, no redeploy):
 * sign-up e-mail rules, public registration, and API response encryption.
 * Talks to AdminPlatformPolicyApiController (/api/v1/admin/platform-policy).
 */
export default function AdminPlatformPolicy() {
  const t = useTranslations(translations);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { def }

  const load = useCallback(() => {
    setLoading(true); setError(null);
    return api.get(BASE)
      .then((json) => setData(json.data))
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function applyFlag(def, value) {
    setBusyKey(def.key); setActionError(null);
    try {
      const json = await api.patch(`${BASE}/flags`, { flags: { [def.key]: value } });
      setData(json.data);
      if (def.key === 'animations_enabled') applyMotion(value);
      // The channel mode changed: drop the cached session so the very next call re-negotiates it.
      if (['response_encryption', 'response_enc_enforce', 'request_enc_enforce'].includes(def.key)) resetSecureChannel();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyKey(null);
      setConfirm(null);
    }
  }

  function toggle(def, value) {
    if ((def.risky && !value) || (def.riskyOn && value)) setConfirm({ def, value });
    else applyFlag(def, value);
  }

  if (loading && !data) return <><PageHead t={t} /><Skeleton rows={6} cols={4} /></>;
  if (error && !data) return <><PageHead t={t} /><ErrorState error={error} onRetry={load} /></>;

  const server = data.server || {};
  const flags = data.flags || {};
  const emailMasterOff = server.email_checks_master === false;
  const encMasterOff = server.encryption_master === false;
  const row = (def) => (
    <SwitchRow key={def.key} def={def} t={t} value={!!flags[def.key]} busy={busyKey === def.key}
      locked={(def.group === 'email' && emailMasterOff) || (def.key === 'response_encryption' && encMasterOff) || (def.needsEncryption && (encMasterOff || !flags.response_encryption))}
      lockedNote={def.needsEncryption ? t('Turn on API response encryption first.') : def.key === 'response_encryption' ? t('Disabled in the server settings (RESPONSE_ENC_ENABLED=false) — encryption stays off.') : t('Disabled in the server settings (MAIL_BLOCK_DISPOSABLE=false) — email checks are off.')}
      onToggle={toggle} />
  );
  const conf = confirm && RISKY_CONFIRM[confirm.def.key];

  return (
    <>
      <PageHead t={t} />
      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-grid adm-grid--even">
        <section className="adm-panel">
          <div className="adm-panel__head"><div><h2>{t('Platform')}</h2><p>{t('Changes apply immediately, no deploy needed.')}</p></div></div>
          {SWITCHES.filter((s) => s.group === 'platform').map(row)}
          {server.encryption_selftest && server.encryption_selftest.ok === false && (
            <p className="adm-note" style={{ color: 'var(--color-warning)', marginTop: 'var(--space-3)' }}><Icon name="alert" size={15} /> {t('The server self-test for encryption failed — check OpenSSL / cache on the server.')}</p>
          )}
        </section>

        <section className="adm-panel">
          <div className="adm-panel__head"><div><h2>{t('Email checks')}</h2><p>{t('What the sign-up and email-change forms refuse.')}</p></div></div>
          {SWITCHES.filter((s) => s.group === 'email').map(row)}
        </section>
      </div>

      <div className="adm-grid adm-grid--even" style={{ marginTop: 'var(--space-4)' }}>
        <RulesPanel list="block" t={t} title={t('Blocked emails & domains')} hint={t('Matching addresses cannot sign up or be used when changing an email. Existing accounts are not affected.')}
          rules={data.rules?.block || []} onChanged={setData} />
        <RulesPanel list="allow" t={t} title={t('Always allowed')} hint={t('Matching addresses skip every email check, even the block list. Use it for false positives.')}
          rules={data.rules?.allow || []} onChanged={setData} />
      </div>

      <section className="adm-panel" style={{ marginTop: 'var(--space-4)' }}>
        <div className="adm-panel__head"><div><h2>{t('Persistent sign-in')}</h2><p>{t('Turn the "never signed out" behaviour on or off for everyone — live, no deploy.')}</p></div></div>
        {SWITCHES.filter((s) => s.group === 'access').map(row)}
      </section>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <DevicesPanel devices={data.devices} onSaved={setData} t={t} />
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={GITHUB_FIELDS} title="GitHub connection" subtitle="Lets students connect their GitHub account (OAuth) and import their repositories. Resetting a value brings back the server (.env) value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={APP_FIELDS} title="Mobile app download" subtitle="The Android app download link shown on the landing page and footer. Update it here whenever you publish a new APK." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={PUSH_FIELDS} title="Push notifications (Firebase)" subtitle="Lets the platform send mobile push notifications through Firebase Cloud Messaging — no .env edit or redeploy. Resetting a value brings back the server (.env) value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={LINK_FIELDS} title="Website address & CORS" subtitle="Where the site lives and which websites may call the API. Set here or in the server .env — either works; a value saved here wins, and Reset brings back the .env value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={CLOUD_FIELDS} title="Cloud drives (Google Drive & OneDrive)" subtitle="Backup connections from My PC. Set here or in the server .env — either works; Reset brings back the .env value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={CALL_FIELDS} title="Calls relay (Cloudflare TURN)" subtitle="Lets calls connect through strict networks. Set here or in the server .env — either works; Reset brings back the .env value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={SANDBOX_FIELDS} title="Project sandbox" subtitle="Connection to the separate sandbox service. Set here or in the server .env — either works; Reset brings back the .env value." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><ValuesPanel values={data.values} onSaved={setData} t={t} fields={OTP_FIELDS} title="OTP protection" subtitle="Limits for email-confirmation, forgot-password, account-recovery and “not me” codes. Resetting a value brings back the server default." /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><TestPanel t={t} /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><DecryptPanel t={t} /></div>
      <div style={{ marginTop: 'var(--space-4)' }}><StaffCodesPanel t={t} /></div>

      {confirm && conf && (
        <ConfirmModal title={t(conf.title)} message={t(conf.message)} confirmLabel={t(conf.confirm)} danger
          busy={busyKey === confirm.def.key} onConfirm={() => applyFlag(confirm.def, !!conf.on)} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

function PageHead({ t }) {
  return (
    <div className="page-header animate-rise-in">
      <div className="page-header__title">
        <h1 className="text-h1">{t('Platform Policy')}</h1>
        <p className="text-small">{t('Block emails and domains, close registration and control response encryption — live, from here.')}</p>
      </div>
    </div>
  );
}
