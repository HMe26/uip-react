import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { Modal, ErrorNote, fmtDateTime } from '../../components/security/ui';
import i18nCommon from '../../i18n/common';
import i18nSecurity from '../../i18n/security/common';
import i18nPage from '../../i18n/security/policies';
import i18nDesign from '../../i18n/security/design';
import '../../styles/css/security-policies.css';

const translations = {
  ...i18nCommon, ...i18nSecurity, ...i18nPage, ...i18nDesign,
  'Password rules, session timeouts, and lockout thresholds.': 'قواعد كلمات المرور ومهلة الجلسات وحدود القفل.',
  'Unsaved changes': 'تغييرات غير محفوظة', 'Discard': 'تجاهل', 'Confirm high-impact change': 'تأكيد تغيير عالي التأثير',
  'This policy applies platform-wide and affects every signed-in user. Are you sure you want to save it?': 'هذه السياسة تُطبَّق على المنصة كلها وتؤثر على كل المستخدمين. هل أنت متأكد من حفظها؟',
  'Confirm': 'تأكيد', 'Unlock account': 'فك قفل الحساب', 'The user will be able to sign in again immediately.': 'سيتمكن المستخدم من تسجيل الدخول مجددًا فورًا.',
  'Authentication': 'المصادقة', 'Sessions': 'الجلسات', 'Network access': 'الوصول للشبكة', 'Limits & uploads': 'الحدود والرفع', 'Advanced': 'متقدمة',
  'Saved.': 'تم الحفظ.', 'On': 'مفعّل', 'Off': 'معطّل',
};

/**
 * Security Policies — /api/v1/security/policies/* (SecurityPoliciesApiController).
 * Same endpoints and payloads as before; the redesign groups the panels into
 * sections (sub-nav), adds an unsaved-changes bar with Discard, a confirm step
 * for high-impact policies, and replaces window.confirm with a dialog.
 * `can_edit` (security_admin/admin) still gates every write.
 */

const BASE = '/api/v1/security/policies';

const SECTIONS = [
  { key: 'auth', icon: 'key', en: 'Authentication', ar: 'المصادقة' },
  { key: 'session', icon: 'clock', en: 'Sessions', ar: 'الجلسات' },
  { key: 'network', icon: 'globe', en: 'Network access', ar: 'الوصول للشبكة' },
  { key: 'limits', icon: 'trend', en: 'Limits & uploads', ar: 'الحدود والرفع' },
  { key: 'advanced', icon: 'settings', en: 'Advanced', ar: 'متقدمة' },
];
const CATEGORY_ICON = { authentication: 'key', session: 'clock', access_control: 'shield', monitoring: 'eye' };
const CATEGORY_LABEL = {
  authentication: { en: 'Authentication', ar: 'المصادقة' },
  session: { en: 'Session', ar: 'الجلسات' },
  access_control: { en: 'Access Control', ar: 'التحكم بالوصول' },
  monitoring: { en: 'Monitoring', ar: 'المراقبة' },
};
const MFA_ROLE_LABELS = {
  student: { en: 'Student', ar: 'طالب' },
  admin: { en: 'Administrator', ar: 'مسؤول النظام' },
  security_admin: { en: 'Security Administrator', ar: 'مسؤول الأمان' },
  security_officer: { en: 'Security Officer', ar: 'ضابط أمان' },
  data_analyst: { en: 'Data Analyst', ar: 'محلل بيانات' },
};
const DEVICE_ROLE_LABELS = {
  student: { en: 'Student', ar: 'طالب' },
  university: { en: 'University', ar: 'جامعة' },
  faculty: { en: 'Faculty', ar: 'كلية' },
  academic_staff: { en: 'Academic staff', ar: 'عضو هيئة تدريس' },
  supervisor: { en: 'Supervisor', ar: 'مشرف' },
  admin: { en: 'Administrator', ar: 'مسؤول النظام' },
  security_admin: { en: 'Security Administrator', ar: 'مسؤول الأمان' },
  security_officer: { en: 'Security Officer', ar: 'ضابط أمان' },
  data_analyst: { en: 'Data Analyst', ar: 'محلل بيانات' },
};
const DEVICE_ROLE_ICONS = {
  student: 'user', university: 'building', faculty: 'layers', academic_staff: 'briefcase', supervisor: 'users',
  admin: 'shield', security_admin: 'lock', security_officer: 'key', data_analyst: 'chart',
};
const DEVICE_ROLES_PRIMARY = ['student', 'university', 'admin'];
const DEVICE_TYPE_ICONS = { desktop: 'monitor', mobile: 'smartphone', tablet: 'tablet', unknown: 'info' };
const DEVICE_TYPE_LABELS = {
  desktop: { en: 'Desktop', ar: 'كمبيوتر مكتبي' },
  mobile: { en: 'Mobile', ar: 'هاتف محمول' },
  tablet: { en: 'Tablet', ar: 'جهاز لوحي' },
  unknown: { en: 'Unknown/Other', ar: 'غير معروف/آخر' },
};

/** Lets a panel ask its host to remount it (= discard local edits). */
const PanelCtx = createContext({ discard: () => {}, notify: () => {} });

function PanelHost({ notify, children }) {
  const [gen, setGen] = useState(0);
  const value = useRef({ discard: () => setGen((g) => g + 1), notify });
  value.current.notify = notify;
  return <PanelCtx.Provider value={value.current}><div key={gen}>{children}</div></PanelCtx.Provider>;
}

function Field({ children, style }) {
  return <div className="sec-field" style={style}>{children}</div>;
}

function LegacyPolicyCard({ icon, title, description, onSubmit, canEdit, saveLabel, saving, error, highImpact, t, children }) {
  const ctx = useContext(PanelCtx);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wasSaving = useRef(false);

  // saving true → false with no error means the PATCH succeeded.
  useEffect(() => {
    if (wasSaving.current && !saving && !error) { setDirty(false); ctx.notify(t('Saved.')); }
    wasSaving.current = saving;
  }, [saving, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    if (!canEdit) return;
    if (highImpact) { setConfirming(e); return; }
    onSubmit(e);
  };

  return (
    <section className="sec-card" style={{ marginBottom: 16 }}>
      <div className="sec-card__head">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={icon} size={17} /> {title}</h2>
          {description && <p style={{ maxWidth: '70ch' }}>{description}</p>}
        </div>
      </div>
      <form onSubmit={submit} onChange={() => canEdit && setDirty(true)}>
        <div className="sec-card__body">
          {children}
          <ErrorNote>{error}</ErrorNote>
        </div>
        {canEdit && (
          <div className="sec-savebar">
            <span className="grow">{dirty && <span className="sec-unsaved"><Icon name="alert" size={14} /> {t('Unsaved changes')}</span>}</span>
            <button type="button" className="btn btn-outline" disabled={!dirty || saving} onClick={ctx.discard}>{t('Discard')}</button>
            <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>{saving ? t('Saving…') : saveLabel}</button>
          </div>
        )}
      </form>
      <Modal open={!!confirming} tone="danger" onClose={() => setConfirming(false)} title={t('Confirm high-impact change')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { const ev = confirming; setConfirming(false); onSubmit(ev); }}>{t('Confirm')}</button></>)}>
        <div className="sec-modal__notice">{t('This policy applies platform-wide and affects every signed-in user. Are you sure you want to save it?')}</div>
        <strong>{title}</strong>
      </Modal>
    </section>
  );
}

function usePanelSave(path) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const save = useCallback(async (payload) => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`${BASE}${path}`, payload);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [path]);
  return { saving, error, save };
}

/* ==========================================================================
   Redesigned building blocks (pol-*). Device Restrictions keeps LegacyPolicyCard.
   ========================================================================== */

function useL() {
  const { locale } = useLanguage();
  return useCallback((en, ar) => (locale === 'ar' ? ar : en), [locale]);
}

const parseList = (s) => String(s || '').split(/[,\n،;\s]+/).map((x) => x.trim()).filter(Boolean);

function PolicyCard({ icon, title, description, onSubmit, canEdit, saveLabel, saving, error, highImpact, t, children }) {
  const ctx = useContext(PanelCtx);
  const L = useL();
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const wasSaving = useRef(false);

  // saving true → false with no error means the PATCH succeeded.
  useEffect(() => {
    if (wasSaving.current && !saving && !error) { setDirty(false); ctx.notify(t('Saved.')); }
    wasSaving.current = saving;
  }, [saving, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    if (!canEdit) return;
    if (highImpact) { setConfirming(e); return; }
    onSubmit(e);
  };

  return (
    <section className="pol-card">
      <header className="pol-card__head">
        <span className="pol-card__icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
        <div className="pol-card__titles">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {highImpact && <span className="pol-tag pol-tag--warn"><Icon name="alert-triangle" size={13} /> {L('High impact', 'عالي التأثير')}</span>}
      </header>
      <form onSubmit={submit} onChange={() => canEdit && setDirty(true)}>
        <div className="pol-card__body">
          {children}
          <ErrorNote>{error}</ErrorNote>
        </div>
        <footer className="pol-card__foot">
          {canEdit ? (
            <>
              <span className="grow">
                {dirty
                  ? <span className="pol-unsaved">{t('Unsaved changes')}</span>
                  : <span className="pol-saved"><Icon name="check-circle" size={14} /> {L('All changes saved', 'كل التغييرات محفوظة')}</span>}
              </span>
              <button type="button" className="btn btn-outline" disabled={!dirty || saving} onClick={ctx.discard}>{t('Discard')}</button>
              <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>{saving ? t('Saving…') : saveLabel}</button>
            </>
          ) : (
            <span className="grow"><Icon name="eye" size={14} /> {L('You have read-only access to this policy.', 'عندك صلاحية عرض فقط لهذه السياسة.')}</span>
          )}
        </footer>
      </form>
      <Modal open={!!confirming} tone="danger" onClose={() => setConfirming(false)} title={t('Confirm high-impact change')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { const ev = confirming; setConfirming(false); onSubmit(ev); }}>{t('Confirm')}</button></>)}>
        <div className="sec-modal__notice">{t('This policy applies platform-wide and affects every signed-in user. Are you sure you want to save it?')}</div>
        <strong>{title}</strong>
      </Modal>
    </section>
  );
}

function Group({ title, hint, children }) {
  return (
    <div className="pol-group">
      {(title || hint) && (
        <div className="pol-group__head">
          {title && <span className="pol-group__title">{title}</span>}
          {hint && <span className="pol-group__hint">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function PField({ label, hint, htmlFor, children }) {
  return (
    <div className="pol-field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="pol-hint">{hint}</span>}
    </div>
  );
}

/** Number input with an inline unit badge. */
function NumField({ id, label, hint, unit, value, onChange, min, max, disabled }) {
  const auto = useId();
  const fid = id || auto;
  return (
    <PField label={label} hint={hint} htmlFor={fid}>
      <div className="pol-unit">
        <input id={fid} type="number" inputMode="numeric" min={min} max={max} className="pol-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        {unit && <span className="pol-unit__label">{unit}</span>}
      </div>
    </PField>
  );
}

/** Switch tile: optional glyph (text/icon), title and one-line hint. */
function ToggleTile({ checked, onChange, title, hint, glyph, disabled }) {
  return (
    <label className="pol-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {glyph != null && <span className="pol-toggle__glyph" aria-hidden="true">{glyph}</span>}
      <span className="pol-toggle__text">
        <span className="pol-toggle__title">{title}</span>
        {hint && <span className="pol-toggle__hint">{hint}</span>}
      </span>
      <span className="pol-switch" aria-hidden="true" />
    </label>
  );
}

/** Radio cards (single choice). options: [{ value, title, desc, icon }] */
function Segmented({ name, value, onChange, options, disabled }) {
  return (
    <div className="pol-seg" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="pol-seg__opt">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} disabled={disabled} />
          <span className="pol-seg__icon" aria-hidden="true"><Icon name={o.icon} size={17} /></span>
          <span>
            <span className="pol-seg__title">{o.title}</span>
            {o.desc && <span className="pol-seg__desc">{o.desc}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Quick-pick chips + a free "custom" number. */
function Presets({ name, value, onChange, options, format, customUnit, min, max, disabled, label }) {
  const n = Number(value);
  return (
    <div className="pol-presets" role="radiogroup" aria-label={label}>
      {options.map((v) => (
        <label key={v} className="pol-preset">
          <input type="radio" name={name} checked={n === v} onChange={() => onChange(v)} disabled={disabled} />
          <span>{format ? format(v) : v}</span>
        </label>
      ))}
      <span className="pol-custom">
        <input type="number" inputMode="numeric" min={min} max={max} className="pol-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label} />
        {customUnit && <span>{customUnit}</span>}
      </span>
    </div>
  );
}

function Callout({ tone, icon = 'info', children }) {
  return (
    <div className={`pol-callout${tone ? ` pol-callout--${tone}` : ''}`} aria-live="polite">
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </div>
  );
}

/** Textarea of comma-separated entries, with a count and a chip preview. */
function ListBox({ title, tone, active, muted, value, onChange, placeholder, disabled, rows = 3, L }) {
  const items = parseList(value);
  return (
    <div className={`pol-list pol-list--${tone}${muted ? ' is-muted' : ''}${active ? ' is-active' : ''}`}>
      <div className="pol-list__head">
        <span className="pol-list__title"><span className="dot" /> {title}</span>
        <span className="pol-count">{items.length} {L('entries', 'عنصر')}</span>
      </div>
      <textarea className="pol-textarea is-mono" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} dir="ltr" />
      {items.length > 0 && <div className="pol-chips">{items.slice(0, 40).map((x, i) => <span key={`${x}-${i}`} className="pol-chip">{x}</span>)}{items.length > 40 && <span className="pol-chip">+{items.length - 40}</span>}</div>}
    </div>
  );
}

export default function SecurityPolicies() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const L = useL();
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((x) => x.key === params.get('section')) ? params.get('section') : 'auth';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    return api.get(BASE)
      .then((json) => setData(json.data))
      .catch((err) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(() => setToast(null), 2600); return () => clearTimeout(id); }, [toast]);

  const hero = (
    <header className="pol-hero">
      <span className="pol-hero__icon" aria-hidden="true"><Icon name="shield" size={26} /></span>
      <div className="pol-hero__text">
        <div className="pol-hero__eyebrow">{t('Account / Configuration')}</div>
        <h1>{t('Security Policies')}</h1>
        <p>{L('Control how people sign in, how long sessions last, who can reach the platform and how much traffic it accepts. Changes apply platform-wide.', 'تحكّم في طريقة تسجيل الدخول، ومدة الجلسات، ومن يستطيع الوصول للمنصة، وحجم الطلبات المسموح بها. التغييرات تُطبَّق على المنصة كلها.')}</p>
      </div>
      <div className="pol-hero__side">
        {data && !data.can_edit && <span className="pol-tag pol-tag--neutral"><Icon name="eye" size={13} /> {t('Read-only')}</span>}
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="sec-page pol-page">
        {hero}
        {[60, 80, 45].map((w) => <div key={w} className="pol-skel-card"><span className="sec-skel" style={{ width: `${w}%`, height: 16 }} /><span className="sec-skel" style={{ width: '90%' }} /><span className="sec-skel" style={{ width: '70%' }} /></div>)}
      </div>
    );
  }
  if (loadError) return <div className="sec-page pol-page">{hero}<ErrorNote>{loadError}</ErrorNote></div>;
  if (!data) return null;

  const canEdit = !!data.can_edit;
  const notify = (msg) => setToast(msg);
  const locked = data.locked_accounts || [];
  const host = (id, node) => <PanelHost key={id} notify={notify}>{node}</PanelHost>;
  const goto = (key) => { const n = new URLSearchParams(params); n.set('section', key); setParams(n); };

  const grouped = {};
  (data.generic_policies || []).forEach((p) => {
    const cat = p.category || 'uncategorized';
    grouped[cat] = grouped[cat] || [];
    grouped[cat].push(p);
  });

  // ---- Overview tiles (read from the live policies) ----
  const lk = data.lockout_policy || {};
  const pw = data.password_policy || {};
  const mf = data.mfa_policy || {};
  const ss = data.session_policy || {};
  const rl = data.rate_limit_policy || {};
  const netActive = [data.ip_restriction_policy, data.country_restriction_policy, data.device_restriction_policy].filter((x) => x && x.mode && x.mode !== 'disabled').length;
  const unitLabel = { minutes: L('min', 'دقيقة'), hours: L('h', 'ساعة'), days: L('d', 'يوم') };
  const stats = [
    { key: 'auth', icon: 'lock', label: L('Account lockout', 'قفل الحساب'), value: L(`${lk.max_attempts ?? 5} attempts`, `${lk.max_attempts ?? 5} محاولات`),
      meta: lk.permanent_lock ? L('Permanent lock', 'قفل دائم') : L(`Locks for ${lk.duration_value ?? 15} ${unitLabel[lk.duration_unit || 'minutes']}`, `قفل ${lk.duration_value ?? 15} ${unitLabel[lk.duration_unit || 'minutes']}`) },
    { key: 'auth', icon: 'key', label: L('Passwords', 'كلمات المرور'), value: L(`${pw.min_length ?? 8}+ chars`, `${pw.min_length ?? 8}+ حرف`),
      meta: Number(pw.expire_days) > 0 ? L(`Expire every ${pw.expire_days} d`, `تنتهي كل ${pw.expire_days} يوم`) : L('No expiry', 'بدون انتهاء') },
    { key: 'auth', icon: 'shield', label: L('Required 2FA', 'المصادقة الثنائية'), off: !(mf.enforced_roles || []).length,
      value: (mf.enforced_roles || []).length ? L(`${mf.enforced_roles.length} roles`, `${mf.enforced_roles.length} أدوار`) : L('Off', 'متوقفة'),
      meta: (mf.enforced_roles || []).length ? (Number(mf.grace_period_days) === 0 ? L('No grace period', 'بدون مهلة') : L(`${mf.grace_period_days ?? 7} d grace`, `مهلة ${mf.grace_period_days ?? 7} يوم`)) : L('Not enforced', 'غير مُلزِمة') },
    { key: 'session', icon: 'clock', label: L('Idle timeout', 'مهلة الخمول'), value: L(`${ss.timeout_minutes ?? 60} min`, `${ss.timeout_minutes ?? 60} دقيقة`),
      meta: ss.enforce_concurrent_limit && Number(ss.concurrent_limit) > 0 ? L(`Max ${ss.concurrent_limit} sessions`, `حد أقصى ${ss.concurrent_limit} جلسات`) : L('Sessions not capped', 'الجلسات بلا حد') },
    { key: 'network', icon: 'globe', label: L('Network rules', 'قواعد الشبكة'), off: netActive === 0,
      value: netActive ? L(`${netActive} of 3 active`, `${netActive} من 3 مفعّلة`) : L('Open access', 'وصول مفتوح'), meta: L('IP · Country · Device', 'IP · دولة · جهاز') },
    { key: 'limits', icon: 'trend', label: L('API rate limit', 'حد طلبات API'), off: rl.enabled === false,
      value: rl.enabled === false ? L('Off', 'متوقف') : L(`${rl.requests_per_minute ?? 60}/min`, `${rl.requests_per_minute ?? 60}/د`), meta: L('Per user / IP', 'لكل مستخدم / IP') },
  ];

  return (
    <div className="sec-page pol-page">
      {hero}

      <div className="pol-overview">
        {stats.map((s) => (
          <button key={s.label} type="button" className={`pol-stat${s.off ? ' is-off' : ''}`} onClick={() => goto(s.key)}>
            <span className="pol-stat__top"><span className="pol-stat__dot"><Icon name={s.icon} size={14} /></span>{s.label}</span>
            <span className="pol-stat__value">{s.value}</span>
            <span className="pol-stat__meta">{s.meta}</span>
          </button>
        ))}
      </div>

      <nav className="pol-tabs" role="tablist" aria-label={t('Security Policies')}>
        {SECTIONS.filter((x) => x.key !== 'advanced' || Object.keys(grouped).length > 0 || section === 'advanced').map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={section === x.key} className={`pol-tab${section === x.key ? ' is-active' : ''}`} onClick={() => goto(x.key)}>
            <Icon name={x.icon} size={16} /> {x[locale] || x.en}
            {x.key === 'auth' && locked.length > 0 && <span className="pol-tab__badge">{locked.length}</span>}
          </button>
        ))}
      </nav>

      <div className="pol-stack">
        {section === 'auth' && (<>
          {host('lockout', <LockoutPanel t={t} canEdit={canEdit} initial={data.lockout_policy} />)}
          <LockedAccountsCard t={t} canEdit={canEdit} locked={locked} onUnlocked={load} />
          {host('password', <PasswordPanel t={t} canEdit={canEdit} initial={data.password_policy} />)}
          {host('mfa', <MfaPanel t={t} canEdit={canEdit} initial={data.mfa_policy} roles={data.mfa_enforceable_roles || []} locale={locale} />)}
        </>)}
        {section === 'session' && host('session', <SessionPanel t={t} canEdit={canEdit} initial={data.session_policy} />)}
        {section === 'network' && (<>
          {host('ip', <IpRestrictionPanel t={t} canEdit={canEdit} initial={data.ip_restriction_policy} />)}
          {host('country', <CountryRestrictionPanel t={t} canEdit={canEdit} initial={data.country_restriction_policy} />)}
          {host('device', <DeviceRestrictionPanel t={t} canEdit={canEdit} initial={data.device_restriction_policy} locale={locale} />)}
        </>)}
        {section === 'limits' && (<>
          {host('rate', <RateLimitPanel t={t} canEdit={canEdit} initial={data.rate_limit_policy} />)}
          {host('upload', <UploadPanel t={t} canEdit={canEdit} initial={data.upload_policy} />)}
        </>)}
        {section === 'advanced' && (Object.keys(grouped).length === 0
          ? <section className="pol-card"><div className="pol-empty"><span className="pol-empty__icon"><Icon name="settings" size={22} /></span>{t('No policies defined yet.')}</div></section>
          : Object.entries(grouped).map(([cat, items]) => (
            <GenericCategoryCard key={cat} t={t} locale={locale} cat={cat} items={items} canEdit={canEdit} onSaved={() => { notify(t('Saved.')); load(); }} />
          )))}
      </div>
      {toast && <div className="sec-toast" role="status"><Icon name="check-circle" size={18} /> {toast}</div>}
    </div>
  );
}

function LockoutPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { max_attempts: 5, duration_unit: 'minutes', duration_value: 15, permanent_lock: false, auto_unlock: true, notify_inapp: true, notify_email: true, lock_message_ar: '', lock_message_en: '', support_email: '', support_phone: '', ...initial };
  const [maxAttempts, setMaxAttempts] = useState(p.max_attempts);
  const [durationValue, setDurationValue] = useState(p.duration_value);
  const [durationUnit, setDurationUnit] = useState(p.duration_unit);
  const [permanentLock, setPermanentLock] = useState(!!p.permanent_lock);
  const [autoUnlock, setAutoUnlock] = useState(!!p.auto_unlock);
  const [notifyInapp, setNotifyInapp] = useState(!!p.notify_inapp);
  const [notifyEmail, setNotifyEmail] = useState(!!p.notify_email);
  const [supportEmail, setSupportEmail] = useState(p.support_email);
  const [supportPhone, setSupportPhone] = useState(p.support_phone);
  const [lockMessageAr, setLockMessageAr] = useState(p.lock_message_ar);
  const [lockMessageEn, setLockMessageEn] = useState(p.lock_message_en);
  const { saving, error, save } = usePanelSave('/lockout');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({
      max_attempts: maxAttempts, duration_value: durationValue, duration_unit: durationUnit,
      permanent_lock: permanentLock, auto_unlock: autoUnlock, notify_inapp: notifyInapp, notify_email: notifyEmail,
      support_email: supportEmail, support_phone: supportPhone, lock_message_ar: lockMessageAr, lock_message_en: lockMessageEn,
    });
  };

  const unitWord = { minutes: L('minutes', 'دقيقة'), hours: L('hours', 'ساعة'), days: L('days', 'يوم') }[durationUnit];
  const summary = permanentLock
    ? L(`After ${maxAttempts} failed sign-in attempts the account is locked permanently until a security administrator unlocks it.`, `بعد ${maxAttempts} محاولات دخول فاشلة يُقفل الحساب بشكل دائم إلى أن يفتحه مسؤول الأمان.`)
    : L(`After ${maxAttempts} failed sign-in attempts the account is locked for ${durationValue} ${unitWord}${autoUnlock ? ' and unlocks by itself.' : ' and then needs a manual unlock.'}`,
        `بعد ${maxAttempts} محاولات دخول فاشلة يُقفل الحساب لمدة ${durationValue} ${unitWord}${autoUnlock ? ' ثم يُفتح تلقائيًا.' : ' ثم يحتاج فتحًا يدويًا.'}`);

  return (
    <PolicyCard t={t} highImpact icon="lock" title={t('Failed Login / Account Lockout Policy')} description={t('The system automatically locks an account after the number of failed login attempts below, and notifies the user in-app and by email.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save lockout policy')} saving={saving} error={error}>
      <Group title={L('Threshold', 'حد القفل')}>
        <div className="pol-grid">
          <NumField label={t('Maximum failed login attempts')} unit={L('attempts', 'محاولات')} min={1} max={50} value={maxAttempts} onChange={setMaxAttempts} disabled={!canEdit} />
          <PField label={t('Temporary lock duration')}>
            <div className="pol-unit__select">
              <input type="number" inputMode="numeric" min={1} max={3650} className="pol-input" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} disabled={!canEdit} aria-label={t('Temporary lock duration')} />
              <select className="pol-select" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)} disabled={!canEdit} aria-label={L('Unit', 'الوحدة')}>
                <option value="minutes">{t('Minutes')}</option>
                <option value="hours">{t('Hours')}</option>
                <option value="days">{t('Days')}</option>
              </select>
            </div>
          </PField>
        </div>
        <Callout icon="info">{summary}</Callout>
      </Group>

      <Group title={L('Lock behavior & alerts', 'سلوك القفل والتنبيهات')}>
        <div className="pol-grid pol-grid--tight">
          <ToggleTile glyph={<Icon name="lock" size={17} />} checked={permanentLock} onChange={setPermanentLock} disabled={!canEdit} title={t('Permanent lock instead of temporary (requires manual unlock)')} />
          <ToggleTile glyph={<Icon name="refresh" size={17} />} checked={autoUnlock} onChange={setAutoUnlock} disabled={!canEdit} title={t('Automatic unlock after the configured time')} />
          <ToggleTile glyph={<Icon name="bell" size={17} />} checked={notifyInapp} onChange={setNotifyInapp} disabled={!canEdit} title={t('Notify security team in-app')} />
          <ToggleTile glyph={<Icon name="mail" size={17} />} checked={notifyEmail} onChange={setNotifyEmail} disabled={!canEdit} title={t('Send an email to the locked-out user')} />
        </div>
      </Group>

      <Group title={L('Support contact', 'بيانات الدعم')} hint={L('Shown to locked-out users so they know who to reach.', 'تظهر للمستخدم المقفول ليعرف بمن يتواصل.')}>
        <div className="pol-grid">
          <PField label={t('Support email')}>
            <input type="email" className="pol-input" dir="ltr" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} disabled={!canEdit} placeholder="support@university.edu" />
          </PField>
          <PField label={t('Support phone')}>
            <input type="text" className="pol-input" dir="ltr" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} disabled={!canEdit} placeholder="+20 100 000 0000" />
          </PField>
        </div>
      </Group>

      <Group title={L('Lock message', 'رسالة القفل')}>
        <div className="pol-grid pol-grid--tight">
          <PField label={t('Friendly lock message (Arabic)')}>
            <textarea className="pol-textarea" rows={3} dir="rtl" value={lockMessageAr} onChange={(e) => setLockMessageAr(e.target.value)} disabled={!canEdit} />
          </PField>
          <PField label={t('Friendly lock message (English)')}>
            <textarea className="pol-textarea" rows={3} dir="ltr" value={lockMessageEn} onChange={(e) => setLockMessageEn(e.target.value)} disabled={!canEdit} />
          </PField>
        </div>
      </Group>
    </PolicyCard>
  );
}

function PasswordPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { min_length: 8, require_upper: true, require_lower: true, require_number: true, require_special: true, expire_days: 0, reuse_prevent_count: 3, warn_days_before_expiry: 7, ...initial };
  const [minLength, setMinLength] = useState(p.min_length);
  const [expireDays, setExpireDays] = useState(p.expire_days);
  const [reuseCount, setReuseCount] = useState(p.reuse_prevent_count);
  const [warnDays, setWarnDays] = useState(p.warn_days_before_expiry);
  const [reqUpper, setReqUpper] = useState(!!p.require_upper);
  const [reqLower, setReqLower] = useState(!!p.require_lower);
  const [reqNumber, setReqNumber] = useState(!!p.require_number);
  const [reqSpecial, setReqSpecial] = useState(!!p.require_special);
  const { saving, error, save } = usePanelSave('/password');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ min_length: minLength, expire_days: expireDays, reuse_prevent_count: reuseCount, warn_days_before_expiry: warnDays, require_upper: reqUpper, require_lower: reqLower, require_number: reqNumber, require_special: reqSpecial });
  };

  const rules = [
    L(`At least ${minLength || 0} characters`, `${minLength || 0} أحرف على الأقل`),
    reqUpper && L('Uppercase letter', 'حرف كبير'),
    reqLower && L('Lowercase letter', 'حرف صغير'),
    reqNumber && L('Number', 'رقم'),
    reqSpecial && L('Special character', 'رمز خاص'),
  ].filter(Boolean);

  return (
    <PolicyCard t={t} highImpact icon="key" title={t('Password Complexity & Expiration Policy')} description={t('These rules apply at registration, password change, and password reset, across every portal.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save password policy')} saving={saving} error={error}>
      <Group title={L('Complexity', 'التعقيد')}>
        <div className="pol-grid" style={{ maxWidth: 360 }}>
          <NumField label={t('Minimum password length')} unit={L('chars', 'حرف')} min={6} max={64} value={minLength} onChange={setMinLength} disabled={!canEdit} />
        </div>
        <div className="pol-grid pol-grid--tight">
          <ToggleTile glyph="A" checked={reqUpper} onChange={setReqUpper} disabled={!canEdit} title={t('Require an uppercase letter')} />
          <ToggleTile glyph="a" checked={reqLower} onChange={setReqLower} disabled={!canEdit} title={t('Require a lowercase letter')} />
          <ToggleTile glyph="123" checked={reqNumber} onChange={setReqNumber} disabled={!canEdit} title={t('Require a number')} />
          <ToggleTile glyph="#!" checked={reqSpecial} onChange={setReqSpecial} disabled={!canEdit} title={t('Require a special character')} />
        </div>
        <div>
          <span className="pol-hint" style={{ display: 'block', marginBottom: 8 }}>{L('A valid password must have:', 'كلمة المرور الصحيحة يجب أن تحتوي على:')}</span>
          <div className="pol-rules">{rules.map((r) => <span key={r} className="pol-rule"><Icon name="check" size={13} /> {r}</span>)}</div>
        </div>
      </Group>

      <Group title={L('Lifecycle', 'دورة الحياة')}>
        <div className="pol-grid">
          <NumField label={t('Password expiration (days)')} hint={t('0 = never expires')} unit={L('days', 'يوم')} min={0} max={3650} value={expireDays} onChange={setExpireDays} disabled={!canEdit} />
          <NumField label={t('Warn before expiry (days)')} unit={L('days', 'يوم')} min={0} max={90} value={warnDays} onChange={setWarnDays} disabled={!canEdit} />
          <NumField label={t('Prevent reuse of last N passwords')} hint={t('0 = no reuse check')} unit={L('passwords', 'كلمات')} min={0} max={24} value={reuseCount} onChange={setReuseCount} disabled={!canEdit} />
        </div>
      </Group>
    </PolicyCard>
  );
}

const MFA_ROLE_ICON = { student: 'user', admin: 'settings', security_admin: 'shield', security_officer: 'lock', data_analyst: 'bar-chart' };
const MFA_GRACE_PRESETS = [0, 3, 7, 14, 30];

function MfaPanel({ t, canEdit, initial, roles, locale }) {
  const L = useL();
  const p = { enforced_roles: [], grace_period_days: 7, ...initial };
  const [enforced, setEnforced] = useState(new Set(p.enforced_roles));
  const [graceDays, setGraceDays] = useState(Number(p.grace_period_days) || 0);
  const { saving, error, save } = usePanelSave('/mfa');
  const roleName = (slug) => MFA_ROLE_LABELS[slug]?.[locale] ?? MFA_ROLE_LABELS[slug]?.en ?? slug;

  function toggleRole(role, on) {
    setEnforced((prev) => {
      const next = new Set(prev);
      if (on) next.add(role); else next.delete(role);
      return next;
    });
  }

  const days = Math.min(90, Math.max(0, Number(graceDays) || 0));
  const handleSubmit = (e) => {
    e.preventDefault();
    save({ enforced_roles: Array.from(enforced), grace_period_days: days });
  };

  if (!roles.length) {
    return (
      <section className="pol-card">
        <header className="pol-card__head"><span className="pol-card__icon"><Icon name="shield" size={20} /></span><div className="pol-card__titles"><h2>{t('MFA Requirements Policy')}</h2></div></header>
        <div className="pol-empty">{t('No enforceable roles are configured.')}</div>
      </section>
    );
  }

  const names = roles.filter((r) => enforced.has(r)).map(roleName).join(L(', ', '، '));
  const summary = enforced.size === 0
    ? L('No role is required to use two-factor authentication.', 'مفيش أي دور ملزم بالمصادقة الثنائية حاليًا.')
    : days === 0
      ? L(`${names}: anyone without 2FA is restricted to the 2FA setup page immediately — from their next sign-in or request.`,
          `${names}: أي حساب من غير 2FA بيتحصر على صفحة التفعيل فورًا — من أول دخول أو طلب جاي.`)
      : L(`${names}: anyone without 2FA has ${days} day${days === 1 ? '' : 's'} to enroll (counted from their first sign-in after this policy), then access is restricted to the 2FA setup page.`,
          `${names}: أي حساب من غير 2FA معاه ${days} يوم يفعّلها (من أول دخول بعد السياسة)، وبعدها الوصول بيتحصر على صفحة التفعيل.`);

  return (
    <PolicyCard t={t} highImpact icon="shield" title={t('MFA Requirements Policy')} description={t('Choose which roles must have two-factor authentication enabled. A user without it gets a grace period to enroll; once it elapses, their access is restricted to the 2FA setup page until they enroll.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save MFA policy')} saving={saving} error={error}>
      <Group title={t('Roles required to use MFA')} hint={L(`${enforced.size} of ${roles.length} roles selected`, `تم اختيار ${enforced.size} من ${roles.length} أدوار`)}>
        <div className="pol-grid">
          {roles.map((roleSlug) => (
            <ToggleTile key={roleSlug} glyph={<Icon name={MFA_ROLE_ICON[roleSlug] || 'user'} size={17} />} title={roleName(roleSlug)}
              checked={enforced.has(roleSlug)} onChange={(on) => toggleRole(roleSlug, on)} disabled={!canEdit} />
          ))}
        </div>
      </Group>

      <Group title={t('Enrollment grace period (days)')} hint={t('0 = required immediately, no grace')}>
        <Presets name="mfa-grace" label={t('Enrollment grace period (days)')} value={graceDays} onChange={setGraceDays} options={MFA_GRACE_PRESETS}
          format={(d) => (d === 0 ? L('Immediately', 'فورًا') : L(`${d} days`, `${d} يوم`))} customUnit={L('days', 'يوم')} min={0} max={90} disabled={!canEdit} />
      </Group>

      <Callout icon={enforced.size ? 'info' : 'shield'} tone={enforced.size ? undefined : 'muted'}>{summary}</Callout>
    </PolicyCard>
  );
}

function SessionPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { timeout_minutes: 60, concurrent_limit: 0, enforce_concurrent_limit: false, ...initial };
  const [timeoutMinutes, setTimeoutMinutes] = useState(p.timeout_minutes);
  const [concurrentLimit, setConcurrentLimit] = useState(p.concurrent_limit);
  const [enforce, setEnforce] = useState(!!p.enforce_concurrent_limit);
  const { saving, error, save } = usePanelSave('/session');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ timeout_minutes: timeoutMinutes, concurrent_limit: concurrentLimit, enforce_concurrent_limit: enforce });
  };

  const mins = Number(timeoutMinutes) || 0;
  const human = mins >= 1440 && mins % 1440 === 0 ? L(`${mins / 1440} day(s)`, `${mins / 1440} يوم`) : mins >= 60 && mins % 60 === 0 ? L(`${mins / 60} hour(s)`, `${mins / 60} ساعة`) : L(`${mins} minutes`, `${mins} دقيقة`);

  return (
    <PolicyCard t={t} icon="clock" title={t('Session Timeout & Concurrent Session Policy')} description={t('The system automatically ends any idle session after the configured time, and can also cap how many sessions a single user may have active at once.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save session policy')} saving={saving} error={error}>
      <Group title={t('Session idle timeout (minutes)')} hint={L(`Idle sessions end after ${human} without activity.`, `تنتهي الجلسة الخاملة بعد ${human} بدون نشاط.`)}>
        <Presets name="sess-timeout" label={t('Session idle timeout (minutes)')} value={timeoutMinutes} onChange={setTimeoutMinutes} options={[15, 30, 60, 120, 480]}
          format={(m) => (m >= 60 ? L(`${m / 60} h`, `${m / 60} ساعة`) : L(`${m} min`, `${m} د`))} customUnit={L('min', 'دقيقة')} min={1} max={43200} disabled={!canEdit} />
      </Group>

      <Group title={L('Concurrent sessions', 'الجلسات المتزامنة')}>
        <div className="pol-grid pol-grid--tight">
          <NumField label={t('Maximum concurrent sessions')} hint={t('0 = unlimited')} unit={L('sessions', 'جلسات')} min={0} max={50} value={concurrentLimit} onChange={setConcurrentLimit} disabled={!canEdit} />
          <ToggleTile glyph={<Icon name="users" size={17} />} checked={enforce} onChange={setEnforce} disabled={!canEdit} title={L('Enforce the limit', 'تطبيق الحد')}
            hint={t('Enforce the concurrent session limit (auto-signs out the oldest sessions on a new login)')} />
        </div>
      </Group>
    </PolicyCard>
  );
}

const MODE_OPTIONS = (t) => [
  { value: 'disabled', icon: 'x-circle', title: t('Disabled'), desc: null },
  { value: 'allowlist', icon: 'check-circle', title: t('Allowlist only'), desc: null },
  { value: 'denylist', icon: 'stop', title: t('Denylist'), desc: null },
];

function IpRestrictionPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { mode: 'disabled', allowlist: [], denylist: [], ...initial };
  const [mode, setMode] = useState(p.mode);
  const [allowlist, setAllowlist] = useState((p.allowlist || []).join(', '));
  const [denylist, setDenylist] = useState((p.denylist || []).join(', '));
  const { saving, error, save } = usePanelSave('/ip-restriction');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ mode, allowlist, denylist });
  };

  const opts = MODE_OPTIONS(t).map((o) => ({
    ...o,
    desc: { disabled: L('Any address can sign in.', 'أي عنوان يمكنه الدخول.'), allowlist: L('Only listed addresses can sign in.', 'العناوين المدرجة فقط يمكنها الدخول.'), denylist: L('Listed addresses are blocked.', 'العناوين المدرجة محجوبة.') }[o.value],
  }));

  return (
    <PolicyCard t={t} highImpact icon="monitor" title={t('IP Restrictions Policy')} description={t('A broader allow/deny list with CIDR support (e.g. 41.32.0.0/16), separate from the single-address "Blocked IPs" list below. Applied at login.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save IP restriction policy')} saving={saving} error={error}>
      <Group title={t('Mode')}>
        <Segmented name="ip-mode" value={mode} onChange={setMode} options={opts} disabled={!canEdit} />
      </Group>
      <Group title={L('Address lists', 'قوائم العناوين')} hint={L('Single IPs or CIDR ranges, separated by commas or new lines.', 'عناوين مفردة أو نطاقات CIDR، مفصولة بفواصل أو أسطر.')}>
        <div className="pol-grid pol-grid--tight">
          <ListBox L={L} tone="allow" title={t('Allowlist (comma-separated)')} value={allowlist} onChange={setAllowlist} disabled={!canEdit} placeholder="41.32.0.0/16, 197.0.0.0/8, 102.44.1.1" active={mode === 'allowlist'} muted={mode !== 'allowlist'} />
          <ListBox L={L} tone="deny" title={t('Denylist (comma-separated)')} value={denylist} onChange={setDenylist} disabled={!canEdit} placeholder="203.0.113.0/24" active={mode === 'denylist'} muted={mode !== 'denylist'} />
        </div>
      </Group>
      {mode === 'allowlist' && <Callout tone="warn" icon="alert-triangle">{L('With "Allowlist only", anyone outside the list — including you — can no longer sign in. Make sure your own address is included.', 'مع "قائمة السماح فقط" أي شخص خارج القائمة — بمن فيهم أنت — لن يستطيع الدخول. تأكد من إضافة عنوانك.')}</Callout>}
    </PolicyCard>
  );
}

function CountryRestrictionPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { mode: 'disabled', allowed_countries: [], blocked_countries: [], fail_open: true, ...initial };
  const [mode, setMode] = useState(p.mode);
  const [failOpen, setFailOpen] = useState(!!p.fail_open);
  const [allowed, setAllowed] = useState((p.allowed_countries || []).join(', '));
  const [blocked, setBlocked] = useState((p.blocked_countries || []).join(', '));
  const { saving, error, save } = usePanelSave('/country-restriction');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ mode, fail_open: failOpen, allowed_countries: allowed, blocked_countries: blocked });
  };

  const opts = MODE_OPTIONS(t).map((o) => ({
    ...o,
    desc: { disabled: L('Sign-in from any country.', 'الدخول من أي دولة.'), allowlist: L('Only listed countries can sign in.', 'الدول المدرجة فقط يمكنها الدخول.'), denylist: L('Listed countries are blocked.', 'الدول المدرجة محجوبة.') }[o.value],
  }));

  return (
    <PolicyCard t={t} highImpact icon="globe" title={t('Country Restrictions Policy')} description={t('Restricts login to (or from) specific countries, backed by a real IP → country lookup (GeoIpService) with result caching. When the country can\'t be determined (lookup provider down, or a private/local address), "fail open" decides whether the login is allowed or denied.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save country restriction policy')} saving={saving} error={error}>
      <Group title={t('Mode')}>
        <Segmented name="cr-mode" value={mode} onChange={setMode} options={opts} disabled={!canEdit} />
      </Group>
      <Group title={L('Countries', 'الدول')} hint={L('Two-letter ISO codes, e.g. EG, SA, AE.', 'رموز ISO من حرفين، مثل EG وSA وAE.')}>
        <div className="pol-grid pol-grid--tight">
          <ListBox L={L} rows={2} tone="allow" title={t('Allowed countries (comma-separated ISO codes)')} value={allowed} onChange={setAllowed} disabled={!canEdit} placeholder="EG, SA, AE" active={mode === 'allowlist'} muted={mode !== 'allowlist'} />
          <ListBox L={L} rows={2} tone="deny" title={t('Blocked countries (comma-separated ISO codes)')} value={blocked} onChange={setBlocked} disabled={!canEdit} placeholder="KP" active={mode === 'denylist'} muted={mode !== 'denylist'} />
        </div>
      </Group>
      <Group title={L('When the country is unknown', 'عند تعذّر تحديد الدولة')}>
        <ToggleTile glyph={<Icon name="map-pin" size={17} />} checked={failOpen} onChange={setFailOpen} disabled={!canEdit} title={t('Allow login when country can\'t be resolved (fail open)')}
          hint={failOpen ? L('Sign-in is allowed if the lookup fails.', 'يُسمح بالدخول إذا فشل التحديد.') : L('Sign-in is denied if the lookup fails.', 'يُرفض الدخول إذا فشل التحديد.')} />
      </Group>
    </PolicyCard>
  );
}

function RateLimitPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { enabled: true, requests_per_minute: 60, ...initial };
  const [enabled, setEnabled] = useState(!!p.enabled);
  const [rpm, setRpm] = useState(p.requests_per_minute);
  const { saving, error, save } = usePanelSave('/rate-limit');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ enabled, requests_per_minute: rpm });
  };

  return (
    <PolicyCard t={t} icon="trend" title={t('API Rate Limits Policy')} description={t('Caps how many requests a single signed-in user (or an IP address when signed out) may make per minute across every /api route. Turning it off removes the limit completely.')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save rate limit policy')} saving={saving} error={error}>
      <ToggleTile glyph={<Icon name="pulse" size={17} />} checked={enabled} onChange={setEnabled} disabled={!canEdit} title={t('Enable rate limiting')}
        hint={enabled ? L('Requests above the limit are rejected until the minute resets.', 'الطلبات فوق الحد تُرفض حتى تنتهي الدقيقة.') : L('Traffic is not limited.', 'لا يوجد حد للطلبات.')} />
      <Group title={t('Max requests per minute (per IP)')}>
        <Presets name="rl-rpm" label={t('Max requests per minute (per IP)')} value={rpm} onChange={setRpm} options={[30, 60, 120, 300, 600]} format={(v) => `${v}`} customUnit={L('/ min', '/ دقيقة')} min={1} max={10000} disabled={!canEdit} />
      </Group>
    </PolicyCard>
  );
}

function UploadPanel({ t, canEdit, initial }) {
  const L = useL();
  const p = { max_size_kb: 10240, restrict_extensions: false, allowed_extensions: 'pdf,doc,docx,xls,xlsx,ppt,pptx,jpg,jpeg,png,webp,gif,svg,zip,csv,json,xml', ...initial };
  const [maxSizeKb, setMaxSizeKb] = useState(p.max_size_kb);
  const [restrict, setRestrict] = useState(!!p.restrict_extensions);
  const [allowed, setAllowed] = useState(p.allowed_extensions);
  const { saving, error, save } = usePanelSave('/upload');

  const handleSubmit = (e) => {
    e.preventDefault();
    save({ max_size_kb: maxSizeKb, restrict_extensions: restrict, allowed_extensions: allowed });
  };

  const exts = parseList(allowed);
  const mb = (Number(maxSizeKb || 0) / 1024).toFixed(1);

  return (
    <PolicyCard t={t} icon="upload" title={t('File Upload Restrictions')} description={t('The default maximum file size and allowed file types, applied across every upload (avatars, logos, project files, reports, attachments).')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save upload policy')} saving={saving} error={error}>
      <Group title={t('Maximum file size (KB)')} hint={L(`≈ ${mb} MB per file`, `≈ ${mb} ميجابايت للملف`)}>
        <Presets name="up-size" label={t('Maximum file size (KB)')} value={maxSizeKb} onChange={setMaxSizeKb} options={[2048, 5120, 10240, 25600, 51200]} format={(kb) => `${kb / 1024} MB`} customUnit="KB" min={1} max={512000} disabled={!canEdit} />
      </Group>
      <Group title={L('File types', 'أنواع الملفات')}>
        <ToggleTile glyph={<Icon name="file" size={17} />} checked={restrict} onChange={setRestrict} disabled={!canEdit} title={t('Restrict to the allowed types below')}
          hint={t('Applied as an extra restriction on top of each category\'s own types, only when the option above is on — it can only narrow, never widen, what a category already allows.')} />
        <div className={`pol-list pol-list--allow${restrict ? ' is-active' : ' is-muted'}`}>
          <div className="pol-list__head">
            <span className="pol-list__title"><span className="dot" /> {t('Allowed file types (comma-separated)')}</span>
            <span className="pol-count">{exts.length} {L('types', 'نوع')}</span>
          </div>
          <input type="text" className="pol-input is-mono" dir="ltr" value={allowed} onChange={(e) => setAllowed(e.target.value)} disabled={!canEdit} placeholder="pdf,docx,jpg,png,zip" />
          {exts.length > 0 && <div className="pol-chips">{exts.map((x, i) => <span key={`${x}-${i}`} className="pol-chip">.{x.replace(/^\./, '')}</span>)}</div>}
        </div>
      </Group>
    </PolicyCard>
  );
}

function DeviceRestrictionPanel({ t, canEdit, initial, locale }) {
  const p = { mode: 'disabled', allowed_device_types: [], blocked_device_types: [], role_rules: {}, ...initial };
  const [mode, setMode] = useState(p.mode);
  const [allowedTypes, setAllowedTypes] = useState(new Set(p.allowed_device_types || []));
  const [blockedTypes, setBlockedTypes] = useState(new Set(p.blocked_device_types || []));
  // role -> Set of device types that account type is BLOCKED on (only used in "By account type" mode).
  const [roleRules, setRoleRules] = useState(() => {
    const m = {};
    Object.entries(p.role_rules || {}).forEach(([role, types]) => { m[role] = new Set(types); });
    return m;
  });
  // Rarely-restricted roles stay folded away unless one of them already has a rule.
  const [showMore, setShowMore] = useState(() => Object.keys(p.role_rules || {}).some((r) => !DEVICE_ROLES_PRIMARY.includes(r)));
  const { saving, error, save } = usePanelSave('/device-restriction');

  function toggle(setFn, type) {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  function toggleRole(role, type) {
    setRoleRules((prev) => {
      const next = new Set(prev[role] || []);
      if (next.has(type)) next.delete(type); else next.add(type);
      return { ...prev, [role]: next };
    });
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    const role_rules = {};
    Object.entries(roleRules).forEach(([role, set]) => { if (set.size) role_rules[role] = Array.from(set); });
    save({ mode, allowed_device_types: Array.from(allowedTypes), blocked_device_types: Array.from(blockedTypes), role_rules });
  };

  return (
    <LegacyPolicyCard t={t} highImpact icon="smartphone" title={t('Device Restrictions Policy')} description={t('Restricts login by device type (desktop / mobile / tablet), classified from the request\'s User-Agent — either for everyone, or per account type (e.g. block Students on mobile but keep Administrators allowed). Separate from the upcoming "Trusted Devices" feature (a single user remembering one specific device to skip repeat MFA).')} onSubmit={handleSubmit} canEdit={canEdit} saveLabel={t('Save device restriction policy')} saving={saving} error={error}>
      <Field style={{ maxWidth: 420, marginBottom: 'var(--space-3)' }}>
        <label>{t('Mode')}</label>
        <select className="sec-input" value={mode} onChange={(e) => setMode(e.target.value)} disabled={!canEdit}>
          <option value="disabled">{t('Disabled')}</option>
          <option value="by_role">{t('By account type')}</option>
          <option value="allowlist">{t('Everyone — allowlist only')}</option>
          <option value="denylist">{t('Everyone — denylist')}</option>
        </select>
      </Field>

      {mode === 'by_role' && (
        <div className="dr-roles">
          <p className="dr-hint">{t('Tap a device to block that account type from it. Red = blocked.')}</p>
          {[...DEVICE_ROLES_PRIMARY, ...(showMore ? Object.keys(DEVICE_ROLE_LABELS).filter((r) => !DEVICE_ROLES_PRIMARY.includes(r)) : [])].map((role) => {
            const rl = DEVICE_ROLE_LABELS[role];
            const blockedList = Object.keys(DEVICE_TYPE_LABELS).filter((type) => roleRules[role]?.has(type));
            return (
              <div key={role} className="dr-row">
                <span className="dr-who">
                  <span className="dr-av"><Icon name={DEVICE_ROLE_ICONS[role] || 'user'} size={16} /></span>
                  {rl[locale] || rl.en}
                </span>
                <div className="dr-chips">
                  {Object.entries(DEVICE_TYPE_LABELS).map(([type, lbl]) => {
                    const on = !!roleRules[role]?.has(type);
                    return (
                      <label key={type} className={`dr-chip${on ? ' is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleRole(role, type)}
                          disabled={!canEdit}
                        />
                        <Icon name={DEVICE_TYPE_ICONS[type]} size={15} />
                        {lbl[locale] || lbl.en}
                      </label>
                    );
                  })}
                </div>
                <span className={`dr-sum${blockedList.length ? ' is-blocked' : ''}`}>
                  {blockedList.length
                    ? `${t('Blocked: ')}${blockedList.map((type) => DEVICE_TYPE_LABELS[type][locale] || DEVICE_TYPE_LABELS[type].en).join(locale === 'ar' ? '، ' : ', ')}`
                    : t('Allowed everywhere')}
                </span>
              </div>
            );
          })}
          <button type="button" className="dr-more" onClick={() => setShowMore((v) => !v)}>
            {showMore ? t('Fewer account types') : t('More account types')}
          </button>
        </div>
      )}

      {(mode === 'allowlist' || mode === 'denylist') && (() => {
        const isAllow = mode === 'allowlist';
        const set = isAllow ? allowedTypes : blockedTypes;
        const setFn = isAllow ? setAllowedTypes : setBlockedTypes;
        const listed = Object.keys(DEVICE_TYPE_LABELS).filter((type) => set.has(type));
        const names = listed.map((type) => DEVICE_TYPE_LABELS[type][locale] || DEVICE_TYPE_LABELS[type].en).join(locale === 'ar' ? '، ' : ', ');
        return (
          <div className="dr-roles">
            <p className="dr-hint">
              {isAllow
                ? t('Tap a device to allow it for everyone. Green = allowed; every other device type is blocked.')
                : t('Tap a device to block it for everyone. Red = blocked.')}
            </p>
            <div className="dr-row">
              <span className="dr-who">
                <span className="dr-av"><Icon name="users" size={16} /></span>
                {t('Everyone')}
              </span>
              <div className="dr-chips">
                {Object.entries(DEVICE_TYPE_LABELS).map(([type, lbl]) => {
                  const on = set.has(type);
                  return (
                    <label key={type} className={`dr-chip${on ? (isAllow ? ' is-allow' : ' is-on') : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(setFn, type)} disabled={!canEdit} />
                      <Icon name={DEVICE_TYPE_ICONS[type]} size={15} />
                      {lbl[locale] || lbl.en}
                    </label>
                  );
                })}
              </div>
              <span className={`dr-sum${listed.length ? (isAllow ? ' is-allowed' : ' is-blocked') : ''}`}>
                {listed.length
                  ? `${isAllow ? t('Allowed only: ') : t('Blocked: ')}${names}`
                  : (isAllow ? t('Nothing allowed yet') : t('Nothing blocked yet'))}
              </span>
            </div>
          </div>
        );
      })()}
    </LegacyPolicyCard>
  );
}

function LockedAccountsCard({ t, canEdit, locked, onUnlocked }) {
  const L = useL();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null);

  function unlock() {
    setBusyId(target.id);
    setError(null);
    api.post(`${BASE}/unlock/${target.id}`)
      .then(() => { setTarget(null); onUnlocked(); })
      .catch((err) => { setError(errorMessage(err)); setTarget(null); })
      .finally(() => setBusyId(null));
  }

  return (
    <section className="pol-card pol-card--flush">
      <header className="pol-card__head">
        <span className="pol-card__icon" aria-hidden="true"><Icon name="alert-triangle" size={20} /></span>
        <div className="pol-card__titles">
          <h2>{t('Currently Locked Accounts')}</h2>
          <p>{L('Accounts locked by the lockout policy. Unlocking lets the user sign in again immediately.', 'الحسابات المقفولة بسياسة القفل. فتح الحساب يسمح للمستخدم بالدخول فورًا.')}</p>
        </div>
        <span className={`pol-tag ${locked.length ? 'pol-tag--warn' : 'pol-tag--neutral'}`}>{locked.length}</span>
      </header>
      {error && <div style={{ padding: '12px 24px 0' }}><ErrorNote>{error}</ErrorNote></div>}
      <div className="pol-card__body">
        {locked.length === 0 ? (
          <div className="pol-empty">
            <span className="pol-empty__icon"><Icon name="check-circle" size={24} /></span>
            {t('No accounts are currently locked.')}
          </div>
        ) : (
          <div className="pol-table-wrap">
            <table className="pol-table">
              <thead><tr><th>{t('User')}</th><th>{t('Reason')}</th><th>{t('Locked at')}</th><th>{t('Status')}</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {locked.map((u) => (
                  <tr key={u.id}>
                    <td className="pol-td-user">
                      <div className="pol-user">
                        <span className="pol-user__av"><Icon name="lock" size={16} /></span>
                        <div style={{ minWidth: 0 }}><strong>{u.full_name}</strong><span className="sub">{u.email}</span></div>
                      </div>
                    </td>
                    <td data-label={t('Reason')}>{u.lock_reason || '—'}</td>
                    <td data-label={t('Locked at')} className="muted">{fmtDateTime(u.locked_at)}</td>
                    <td data-label={t('Status')}>{Number(u.lock_permanent) === 1 ? <span className="pill pill--danger">{t('Permanent')}</span> : <span className="pill pill--warn">{t('Until ')}{fmtDateTime(u.locked_until)}</span>}</td>
                    {canEdit && <td className="col-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busyId === u.id} onClick={() => setTarget(u)}>{t('Unlock')}</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={!!target} onClose={() => setTarget(null)} title={t('Unlock account')}
        footer={(<><button type="button" className="btn btn-outline" onClick={() => setTarget(null)}>{t('Cancel')}</button><button type="button" className="btn btn-primary" disabled={!!busyId} onClick={unlock}>{t('Unlock')}</button></>)}>
        {target && (<><div className="sec-modal__notice">{t('The user will be able to sign in again immediately.')}</div><strong>{target.full_name}</strong> <span className="muted mono">{target.email}</span></>)}
      </Modal>
    </section>
  );
}

function GenericCategoryCard({ t, locale, cat, items, canEdit, onSaved }) {
  const L = useL();
  return (
    <section className="pol-card pol-card--flush">
      <header className="pol-card__head">
        <span className="pol-card__icon" aria-hidden="true"><Icon name={CATEGORY_ICON[cat] || 'settings'} size={20} /></span>
        <div className="pol-card__titles"><h2>{CATEGORY_LABEL[cat]?.[locale] ?? CATEGORY_LABEL[cat]?.en ?? cat}</h2></div>
        <span className="pol-tag pol-tag--primary">{items.length} {L('settings', 'إعدادات')}</span>
      </header>
      <div className="pol-card__body pol-settings">
        {items.map((p) => <GenericPolicyRow key={p.policy_key} t={t} locale={locale} policy={p} canEdit={canEdit} onSaved={onSaved} />)}
      </div>
    </section>
  );
}

function GenericPolicyRow({ t, locale, policy, canEdit, onSaved }) {
  const [value, setValue] = useState(policy.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    api.patch(BASE, { policy_key: policy.policy_key, value })
      .then(() => onSaved())
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setSaving(false));
  }

  return (
    <form onSubmit={handleSubmit} className="pol-setting">
      <div style={{ minWidth: 0 }}>
        <span className="pol-setting__name">{(locale === 'ar' && policy.name_ar) || policy.name_en}</span>
        <span className="pol-setting__key">{policy.policy_key}</span>
        {error && <span className="pol-setting__err">{error}</span>}
      </div>
      {canEdit ? (
        <div className="pol-setting__edit">
          <input type="text" className="pol-input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={policy.policy_key} />
          <button type="submit" className="btn btn-primary" disabled={saving || String(value) === String(policy.value)} aria-label={t('Save')}><Icon name="check" size={15} /></button>
        </div>
      ) : (
        <span className="pol-tag pol-tag--primary">{policy.value}</span>
      )}
    </form>
  );
}

