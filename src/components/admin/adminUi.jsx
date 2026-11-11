import { useEffect, useRef, useState } from 'react';
import { validateNames, hasArabic, NAME_MAX } from '../../utils/bilingualName';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { avatarUrl } from '../messaging/format';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/users';

const translations = { ...i18nCommon, ...i18nPage };

export const STATUS_BADGE = { active: 'badge-success', suspended: 'badge-danger', pending: 'badge-warning' };

export function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, large, src }) {
  const [failed, setFailed] = useState(false);
  const url = !failed ? avatarUrl(src) : null;
  // A changed photo should get another chance to load.
  useEffect(() => { setFailed(false); }, [src]);
  return (
    <span className={`adm-avatar${large ? ' adm-avatar--lg' : ''}`}>
      {url ? <img src={url} alt="" onError={() => setFailed(true)} /> : initialsOf(name)}
    </span>
  );
}

export function StatusBadge({ status }) {
  const t = useTranslations(translations);
  const label = status ? t(status.charAt(0).toUpperCase() + status.slice(1)) : '—';
  return <span className={`badge ${STATUS_BADGE[status] || 'badge-neutral'}`}>{label}</span>;
}

export function roleLabel(roles, slug, t) {
  const r = (roles || []).find((x) => x.slug === slug);
  return (r && L(t, r.name_en, r.name_ar)) || slug || '—';
}

export function RoleBadge({ roles, slug }) {
  const t = useTranslations(translations);
  return <span className="badge badge-primary">{roleLabel(roles, slug, t)}</span>;
}

/** In-page replacement for window.confirm() — matches the design's "Confirm action" dialog. */
export function ConfirmModal({ title, message, confirmLabel, danger, busy, onConfirm, onClose }) {
  const t = useTranslations(translations);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{title || t('Confirm action')}</h2>
        <p className="adm-modal-text">{message}</p>
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}
            style={danger ? { background: 'var(--color-danger)', borderColor: 'var(--color-danger)', color: '#fff' } : undefined}>
            {busy ? '…' : (confirmLabel || t('Confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Add / Edit user dialog. Same endpoints and payloads the page used before the
 * redesign (POST /api/v1/admin/users, PATCH /api/v1/admin/users/{uuid}, secondary
 * roles via POST/DELETE /api/v1/admin/users/{uuid}/roles[/{slug}]).
 */
// digits only, with an optional single leading '+'
const cleanPhone = (v) => { const raw = String(v || ''); return (raw.trim().startsWith('+') ? '+' : '') + raw.replace(/\D/g, ''); };
const FIELD_KEYS = ['name_ar', 'name_en', 'email', 'phone', 'password'];

export function Field({ id, label, required, hint, error, children }) {
  return (
    <div className={`um-field${error ? ' has-error' : ''}`}>
      <label className="um-label" htmlFor={id}>{label}{required && <span className="um-req" aria-hidden="true"> *</span>}</label>
      {children}
      {error
        ? <p className="um-msg um-msg--error" id={`${id}-msg`} role="alert"><Icon name="alert-triangle" size={13} /> {error}</p>
        : hint ? <p className="um-msg" id={`${id}-msg`}>{hint}</p> : null}
    </div>
  );
}

export function UserModal({ user, roles, onClose, onSaved }) {
  const t = useTranslations(translations);
  const isNew = !user;
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);

  // Old records mirror the Arabic name into name_en; never pre-fill the English box with Arabic letters.
  const rawEn = user?.name_en || '';
  const enWasArabic = !isNew && (hasArabic(rawEn) || (!rawEn && hasArabic(user?.full_name || '')));
  const [names, setNames] = useState({ name_ar: user?.name_ar || (hasArabic(user?.full_name || '') ? user.full_name : '') || '', name_en: enWasArabic ? '' : (rawEn || user?.full_name || '') });
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState(user?.role || roles[0]?.slug || '');
  const [status, setStatus] = useState(user?.status || 'active');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);

  const [joker, setJoker] = useState(false);
  const [jokerInitial, setJokerInitial] = useState(false);
  const [additionalRoles, setAdditionalRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(!isNew);
  const [grantRole, setGrantRole] = useState('');
  const [roleActionError, setRoleActionError] = useState(null);
  const [roleActionBusy, setRoleActionBusy] = useState(false);
  const bodyRef = useRef(null);

  // University / faculty / department link (students, supervisors, academic staff).
  const [aff, setAff] = useState({ uni: '', faculty: '', dept: '' });
  const [affInitial, setAffInitial] = useState({ uni: '', faculty: '', dept: '' });
  const [affOptions, setAffOptions] = useState([]);
  const [affLoading, setAffLoading] = useState(true);
  const [affError, setAffError] = useState(null);
  const [createdUuid, setCreatedUuid] = useState(null);

  useEffect(() => {
    api.get('/api/v1/admin/users/affiliation-options')
      .then((j) => setAffOptions(j.data || []))
      .catch((err) => setAffError(errorMessage(err)))
      .finally(() => setAffLoading(false));
  }, []);

  useEffect(() => {
    if (isNew) return;
    setRolesLoading(true);
    api.get(`/api/v1/admin/users/${user.uuid}`)
      .then((json) => {
        setAdditionalRoles(json.data?.additional_roles || []);
        setJoker(!!json.data?.is_joker); setJokerInitial(!!json.data?.is_joker);
        const a = json.data?.affiliation || {};
        const cur = { uni: a.university?.id ? String(a.university.id) : '', faculty: a.faculty?.id ? String(a.faculty.id) : '', dept: a.department?.id ? String(a.department.id) : '' };
        setAff(cur); setAffInitial(cur);
      })
      .catch(() => {})
      .finally(() => setRolesLoading(false));
  }, [isNew, user?.uuid]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  const clearError = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  function focusFirst(errs) {
    const k = FIELD_KEYS.find((key) => errs[key]);
    if (!k) return;
    requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(`#um-${k}`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
    });
  }

  function validate() {
    const v = validateNames(names.name_ar, names.name_en, locale);
    const errs = { ...v.errors };
    if (!email.trim()) errs.email = tr('Email is required.', 'البريد الإلكتروني مطلوب.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = tr('Enter a valid email address.', 'اكتب بريدًا إلكترونيًا صحيحًا.');
    if (phone && !/^\+?\d{7,15}$/.test(phone)) errs.phone = tr('Enter a valid phone number (digits only).', 'اكتب رقم هاتف صحيح (أرقام فقط).');
    if (isNew && password.length < 8) errs.password = tr('Password must be at least 8 characters.', 'كلمة المرور لازم تكون 8 أحرف على الأقل.');
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setFormError(tr('Please fix the highlighted fields.', 'من فضلك صحّح الحقول المحددة بالأحمر.'));
      focusFirst(errs);
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    setAffError(null);
    const body = { name_ar: names.name_ar.trim(), name_en: names.name_en.trim(), email: email.trim(), phone: phone.trim(), role };
    let uuid = user?.uuid || createdUuid;
    try {
      if (!uuid) {
        const res = await api.post('/api/v1/admin/users', { ...body, password, is_joker: joker });
        uuid = res?.data?.uuid;
        setCreatedUuid(uuid || null);
      } else {
        await api.patch(`/api/v1/admin/users/${uuid}`, { ...body, status });
      }
    } catch (err) {
      // Show server-side validation next to the field it belongs to.
      const server = err?.payload?.errors;
      const mapped = {};
      if (server && typeof server === 'object') {
        FIELD_KEYS.forEach((k) => { if (server[k]) mapped[k] = [].concat(server[k]).join(' '); });
      }
      setErrors(mapped);
      setFormError(Object.keys(mapped).length ? tr('The server rejected some fields — see below.', 'السيرفر رفض بعض الحقول — راجعها بالأسفل.') : errorMessage(err));
      focusFirst(mapped);
      bodyRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
      setSaving(false);
      return;
    }

    // Joker access on an existing account: toggle only when it changed.
    if (user?.uuid && joker !== jokerInitial) {
      try { await api.put(`/api/v1/admin/users/${user.uuid}/joker`, { enabled: joker }); setJokerInitial(joker); }
      catch (err) { setFormError(errorMessage(err)); setSaving(false); return; }
    }

    // Step 2: the university link (only when it applies to this role and was set / changed).
    const affChanged = ['uni', 'faculty', 'dept'].some((k) => aff[k] !== affInitial[k]);
    if (affApplies && aff.uni && uuid && affChanged) {
      try {
        await api.put(`/api/v1/admin/users/${uuid}/affiliation`, {
          university_id: Number(aff.uni),
          faculty_id: showFaculty && aff.faculty ? Number(aff.faculty) : null,
          department_id: showFaculty && aff.dept ? Number(aff.dept) : null,
        });
        setAffInitial(aff);
      } catch (err) {
        setAffError(errorMessage(err));
        setFormError(tr('Account saved, but the university link failed — fix it below and save again.', 'اتحفظ الحساب، لكن ربط الجامعة فشل — صحّحه بالأسفل واحفظ تاني.'));
        setSaving(false);
        requestAnimationFrame(() => bodyRef.current?.querySelector('#um-aff')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  async function refreshRoles() {
    const json = await api.get(`/api/v1/admin/users/${user.uuid}`);
    setAdditionalRoles(json.data?.additional_roles || []);
  }
  async function handleGrantRole() {
    if (!grantRole) return;
    setRoleActionError(null); setRoleActionBusy(true);
    try {
      const targets = grantRole === '__all__' ? grantableRoles.map((r) => r.slug) : [grantRole];
      for (const slug of targets) await api.post(`/api/v1/admin/users/${user.uuid}/roles`, { role: slug });
      await refreshRoles(); setGrantRole('');
    }
    catch (err) { setRoleActionError(errorMessage(err)); await refreshRoles().catch(() => {}); }
    finally { setRoleActionBusy(false); }
  }
  async function handleRevokeRole(slug) {
    setRoleActionError(null); setRoleActionBusy(true);
    try { await api.del(`/api/v1/admin/users/${user.uuid}/roles/${slug}`); await refreshRoles(); }
    catch (err) { setRoleActionError(errorMessage(err)); }
    finally { setRoleActionBusy(false); }
  }

  const grantableRoles = roles.filter((r) => r.slug !== role && !additionalRoles.includes(r.slug));
  const isUni = role === 'university';
  const affApplies = ['student', 'supervisor', 'academic_staff'].includes(role);
  const showFaculty = role === 'student' || role === 'academic_staff';
  const uniOpt = affOptions.find((u) => String(u.id) === aff.uni);
  const facOpt = uniOpt?.faculties?.find((f) => String(f.id) === aff.faculty);
  const optEl = (o) => <option key={o.id} value={o.id}>{L(t, o.name_en, o.name_ar)}</option>;
  const displayName = names.name_ar || names.name_en || user?.full_name || '';
  const STATUS_OPTS = [
    ['active', t('Active'), 'check-circle'],
    ['pending', t('Pending'), 'clock'],
    ['suspended', t('Suspended'), 'x-circle'],
  ];

  return (
    <div className="modal-overlay um-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="um" role="dialog" aria-modal="true" aria-labelledby="um-title">
        <header className="um-head">
          <span className="um-head__avatar">{isNew ? <Icon name="plus" size={20} /> : initialsOf(displayName)}</span>
          <div className="um-head__text">
            <h2 id="um-title">{isNew ? t('Add User') : tr('Edit user', 'تعديل المستخدم')}</h2>
            <p>
              {isNew
                ? tr('Create a new platform account.', 'إنشاء حساب جديد على المنصة.')
                : <><span dir="ltr">{user.email}</span> <StatusBadge status={user.status} /></>}
            </p>
          </div>
          <button type="button" className="um-close" onClick={onClose} disabled={saving} aria-label={tr('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>

        <form className="um-form" onSubmit={handleSubmit} noValidate>
          <div className="um-body" ref={bodyRef}>
            {formError && (
              <div className="um-alert" role="alert"><Icon name="alert-triangle" size={16} /><span>{formError}</span></div>
            )}
            {enWasArabic && !errors.name_en && !names.name_en && (
              <div className="um-alert um-alert--info" role="status">
                <Icon name="alert-triangle" size={16} />
                <span>{tr('The English name was saved in Arabic letters. Please type it in English letters.', 'الاسم الإنجليزي متسجل بحروف عربية. من فضلك اكتبه بحروف إنجليزية.')}</span>
              </div>
            )}

            <section className="um-section">
              <h3 className="um-section__title">{isUni ? tr('University name', 'اسم الجامعة') : tr('Personal information', 'البيانات الشخصية')}</h3>
              <div className="um-grid">
                <Field id="um-name_ar" label={isUni ? 'اسم الجامعة (بالعربي)' : tr('Name (Arabic)', 'الاسم بالعربي')} required error={errors.name_ar}>
                  <input id="um-name_ar" className="um-input" dir="rtl" lang="ar" maxLength={NAME_MAX} value={names.name_ar} placeholder={isUni ? 'جامعة القاهرة' : 'هيثم محمد كامل'}
                    aria-invalid={errors.name_ar ? 'true' : undefined} onChange={(e) => { setNames((n) => ({ ...n, name_ar: e.target.value })); clearError('name_ar'); }} />
                </Field>
                <Field id="um-name_en" label={isUni ? 'University name (English)' : tr('Name (English)', 'الاسم بالإنجليزي')} required error={errors.name_en}
                  hint={tr('Use English letters only, e.g. Haitham Mohamed Kamel', 'بحروف إنجليزية فقط، مثال: Haitham Mohamed Kamel')}>
                  <input id="um-name_en" className="um-input" dir="ltr" lang="en" maxLength={NAME_MAX} value={names.name_en} placeholder={isUni ? 'Cairo University' : 'Haitham Mohamed Kamel'}
                    aria-invalid={errors.name_en ? 'true' : undefined} onChange={(e) => { setNames((n) => ({ ...n, name_en: e.target.value })); clearError('name_en'); }} />
                </Field>
              </div>
            </section>

            <section className="um-section">
              <h3 className="um-section__title">{tr('Contact', 'بيانات التواصل')}</h3>
              <div className="um-grid">
                <Field id="um-email" label={t('Email')} required error={errors.email}>
                  <input id="um-email" className="um-input" type="email" dir="ltr" autoComplete="off" value={email}
                    aria-invalid={errors.email ? 'true' : undefined} onChange={(e) => { setEmail(e.target.value); clearError('email'); }} />
                </Field>
                <Field id="um-phone" label={t('Phone')} error={errors.phone} hint={tr('Optional', 'اختياري')}>
                  <input id="um-phone" className="um-input" type="tel" dir="ltr" inputMode="tel" value={phone} placeholder="+20 100 000 0000"
                    maxLength={16}
                    onChange={(e) => { setPhone(cleanPhone(e.target.value)); clearError('phone'); }} />
                </Field>
              </div>
            </section>

            <section className="um-section">
              <h3 className="um-section__title">{tr('Account & access', 'الحساب والصلاحيات')}</h3>
              <div className="um-grid">
                <Field id="um-role" label={t('Primary role')}>
                  <select id="um-role" className="um-input um-select" value={role} onChange={(e) => setRole(e.target.value)}>
                    {roles.map((r) => <option key={r.slug} value={r.slug}>{L(t, r.name_en, r.name_ar) || r.slug}</option>)}
                  </select>
                </Field>
                {isNew && (
                  <Field id="um-password" label={t('Temporary password')} required error={errors.password} hint={tr('At least 8 characters', '8 أحرف على الأقل')}>
                    <div className="um-pw">
                      <input id="um-password" className="um-input" type={showPw ? 'text' : 'password'} dir="ltr" autoComplete="new-password" value={password}
                        aria-invalid={errors.password ? 'true' : undefined} onChange={(e) => { setPassword(e.target.value); clearError('password'); }} />
                      <button type="button" className="um-pw__toggle" onClick={() => setShowPw((s) => !s)} aria-label={tr('Show or hide password', 'إظهار أو إخفاء كلمة المرور')}>
                        <Icon name={showPw ? 'eye-off' : 'eye'} size={16} />
                      </button>
                    </div>
                  </Field>
                )}
              </div>
              <div className="um-field">
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input type="checkbox" checked={joker} onChange={(e) => setJoker(e.target.checked)} style={{ marginTop: 4 }} />
                  <span>
                    <strong>{tr('Super Admin account (all roles)', 'حساب سوبر أدمن (كل الأدوار)')}</strong>
                    <span className="um-msg" style={{ display: 'block' }}>
                      {tr('Can sign in once and switch between student, university, doctor, admin and every other role. Grant to trusted people only.',
                          'يدخل مرة واحدة ويبدّل بين طالب وجامعة ودكتور وأدمن وباقي الأدوار. اديه لناس موثوقة بس.')}
                    </span>
                  </span>
                </label>
              </div>
              {!isNew && (
                <div className="um-field">
                  <span className="um-label" id="um-status-label">{t('Status')}</span>
                  <div className="um-seg" role="radiogroup" aria-labelledby="um-status-label">
                    {STATUS_OPTS.map(([val, label, icon]) => (
                      <button key={val} type="button" role="radio" aria-checked={status === val} className={`um-seg__opt um-seg__opt--${val}${status === val ? ' is-on' : ''}`} onClick={() => setStatus(val)}>
                        <Icon name={icon} size={15} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {affApplies ? (
              <section className="um-section" id="um-aff">
                <h3 className="um-section__title">{tr('University & academic link', 'الجامعة والكلية والقسم')}</h3>
                {affLoading ? <p className="um-muted">{t('Loading…')}</p> : (
                  <>
                    <div className="um-grid">
                      <Field id="um-aff-uni" label={t('University')} hint={aff.uni ? null : tr('Optional — you can link it later.', 'اختياري — تقدر تربطه لاحقًا.')}>
                        <select id="um-aff-uni" className="um-input um-select" value={aff.uni} onChange={(e) => setAff({ uni: e.target.value, faculty: '', dept: '' })}>
                          <option value="">{tr('No university', 'بدون جامعة')}</option>
                          {affOptions.map(optEl)}
                        </select>
                      </Field>
                      {showFaculty && (
                        <Field id="um-aff-fac" label={t('Faculty')}>
                          <select id="um-aff-fac" className="um-input um-select" value={aff.faculty} disabled={!uniOpt} onChange={(e) => setAff((a) => ({ ...a, faculty: e.target.value, dept: '' }))}>
                            <option value="">{t('No faculty')}</option>
                            {(uniOpt?.faculties || []).map(optEl)}
                          </select>
                        </Field>
                      )}
                      {showFaculty && (
                        <Field id="um-aff-dept" label={t('Department')}>
                          <select id="um-aff-dept" className="um-input um-select" value={aff.dept} disabled={!facOpt} onChange={(e) => setAff((a) => ({ ...a, dept: e.target.value }))}>
                            <option value="">{t('No department')}</option>
                            {(facOpt?.departments || []).map(optEl)}
                          </select>
                        </Field>
                      )}
                    </div>
                    {role === 'supervisor' && <p className="um-msg">{tr('Supervisors are linked to a university only.', 'المشرف بيتربط بالجامعة فقط (من غير كلية أو قسم).')}</p>}
                    {!isNew && affInitial.uni && aff.uni && aff.uni !== affInitial.uni && (
                      <div className="um-alert um-alert--info" role="status"><Icon name="alert-triangle" size={16} /><span>{tr('Moving to another university resets the group and closes old assignments/positions, and moves unfinished projects.', 'نقله لجامعة تانية بيلغي المجموعة والتكليفات/المناصب القديمة وبينقل المشاريع غير المنتهية.')}</span></div>
                    )}
                    {affError && <p className="um-msg um-msg--error" role="alert"><Icon name="alert-triangle" size={13} /> {affError}</p>}
                  </>
                )}
              </section>
            ) : (
              <p className="um-note"><Icon name="shield" size={14} /> {tr('This role is not linked to a university, faculty or department.', 'الدور ده مش بيتربط بجامعة أو كلية أو قسم.')}</p>
            )}

            {!isNew && (
              <section className="um-section">
                <h3 className="um-section__title">{t('Additional access (secondary roles)')}</h3>
                {rolesLoading ? <p className="um-muted">{t('Loading…')}</p> : (
                  <>
                    <div className="um-chips">
                      {additionalRoles.length === 0 && <span className="um-muted">{t('No additional roles granted.')}</span>}
                      {additionalRoles.map((slug) => (
                        <span key={slug} className="um-chip">
                          {roleLabel(roles, slug, t)}
                          <button type="button" disabled={roleActionBusy} title={t('Revoke this access')} aria-label={t('Revoke this access')} onClick={() => handleRevokeRole(slug)}><Icon name="x" size={12} /></button>
                        </span>
                      ))}
                    </div>
                    <div className="um-grant">
                      <select className="um-input um-select" aria-label={t('Grant additional role…')} value={grantRole} onChange={(e) => setGrantRole(e.target.value)}>
                        <option value="">{t('Grant additional role…')}</option>
                        {grantableRoles.length > 1 && <option value="__all__">{t('Grant all roles')}</option>}
                        {grantableRoles.map((r) => <option key={r.slug} value={r.slug}>{L(t, r.name_en, r.name_ar) || r.slug}</option>)}
                      </select>
                      <button type="button" className="btn btn-outline" disabled={!grantRole || roleActionBusy} onClick={handleGrantRole}>{t('Grant')}</button>
                    </div>
                    {roleActionError && <p className="um-msg um-msg--error" role="alert"><Icon name="alert-triangle" size={13} /> {roleActionError}</p>}
                  </>
                )}
              </section>
            )}
          </div>

          <footer className="um-foot">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="um-spin" aria-hidden="true" /> {t('Saving…')}</> : (isNew ? t('Create user') : tr('Save changes', 'حفظ التعديلات'))}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * Smooth area/line chart (inline SVG, no chart library). points: [{ label, value }].
 * Colours come from the Admin palette tokens so it follows light/dark.
 */
export function AreaChart({ points, height = 220 }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const W = 640;
  const H = height;
  const padL = 8, padR = 14, padT = 14, padB = 26;
  if (!points || points.length === 0) return <p className="adm-empty">{locale === 'ar' ? 'لا توجد بيانات كافية بعد.' : t('Not enough data yet.')}</p>;
  const max = Math.max(1, ...points.map((p) => Number(p.value) || 0));
  const step = points.length > 1 ? (W - padL - padR) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [padL + (points.length > 1 ? i * step : (W - padL - padR) / 2), padT + (1 - (Number(p.value) || 0) / max) * (H - padT - padB)]);
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 1; i < xy.length; i += 1) {
    const mx = (xy[i - 1][0] + xy[i][0]) / 2;
    d += ` C${mx},${xy[i - 1][1]} ${mx},${xy[i][1]} ${xy[i][0]},${xy[i][1]}`;
  }
  const base = H - padB;
  const area = `${d} L${xy[xy.length - 1][0]},${base} L${xy[0][0]},${base} Z`;
  const last = xy[xy.length - 1];
  const gid = `adm-grad-${points.length}-${max}`;
  return (
    <svg className="adm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Trend chart')} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} className="adm-chart__grid" />)}
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--color-primary)" />
      {points.map((p, i) => (
        <text key={i} x={xy[i][0]} y={H - 7} textAnchor="middle" className="adm-chart__label">{p.label}</text>
      ))}
    </svg>
  );
}

/** Paged footer shared by the Admin list pages. */
export function Pager({ page, setPage, total, perPage }) {
  const t = useTranslations(translations);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (total === 0) return null;
  return (
    <div className="adm-pager">
      <span>{t('Showing')} {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} {t('of')} {total.toLocaleString()}</span>
      {totalPages > 1 && (
        <div>
          <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
          <span>{t('Page')} {page} {t('of')} {totalPages}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
        </div>
      )}
    </div>
  );
}
