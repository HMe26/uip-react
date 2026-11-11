import { useEffect, useState } from 'react';
import Icon from '../Icon';
import AvatarUploader, { AVATAR_EVENT, avatarSrc } from '../insight/AvatarUploader';
import BilingualNameFields, { checkNames } from '../common/BilingualNameFields';
import { SavedBadge } from '../../pages/settings/shared';
import { initialsOf } from '../staff/stfUi';
import { api, errorMessage } from '../../api/client';
import { announceProfile } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { personName } from '../../utils/bilingualName';

/**
 * The shared "identity card" Profile section used by EVERY portal's Settings
 * page (supervisor, student, doctor / teaching assistant, faculty, university,
 * admin, security, data analysis). Styles: settings-page.css (.sp-*).
 *
 * Pieces (each portal picks what it needs):
 *   <IdentityHero/>      the navy card: photo/initials, name, role line, status
 *   <ProfileBlock/>      a titled panel (same look as the cards under the hero)
 *   <PhotoBlock/>        the profile-photo uploader
 *   <ManagedDetails/>    read-only facts that only the university/faculty/admin
 *                        can change (email, rank, scope…), with the lock note
 *   <PersonProfile/>     everything above wired together for a PERSON: the
 *                        person edits their own name (Arabic + English), phone
 *                        and any portal-specific extras, the hero updates live
 *                        and the topbar picks the new name up immediately.
 *
 * Rule of thumb: whatever a person can get wrong about THEMSELVES (name,
 * phone, bio, title…) they fix themselves; whatever grants access or places
 * them in the institution (email/login, role, permissions, faculty, scope,
 * status) stays with the admin / faculty / university.
 */

export const useTr = () => {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  return { ar, locale, tr: (en, arText) => (ar ? arText : en) };
};

/** Navy identity card. `avatarPath`/`logoPath` show a picture; otherwise initials. */
export function IdentityHero({ eyebrow, name, subtitle, status, statusLabel, avatarPath, logoPath, initials }) {
  const { tr } = useTr();
  const [photo, setPhoto] = useState(avatarPath || null);

  useEffect(() => { setPhoto(avatarPath || null); }, [avatarPath]);
  // Settings → Photo uploads announce the new path so the card updates without a reload.
  useEffect(() => {
    if (logoPath) return undefined;
    const onAvatar = (e) => setPhoto(e.detail?.path || null);
    window.addEventListener(AVATAR_EVENT, onAvatar);
    return () => window.removeEventListener(AVATAR_EVENT, onAvatar);
  }, [logoPath]);

  const pic = avatarSrc(logoPath || photo);
  const isActive = !status || status === 'active';

  return (
    <section className="sp-id">
      <div className={`sp-id__avatar${logoPath ? ' is-logo' : ''}`} aria-hidden="true">
        {pic ? <img src={pic} alt="" /> : (initials || initialsOf(name))}
      </div>
      <div className="sp-id__main">
        {eyebrow && <span className="sp-id__eyebrow">{eyebrow}</span>}
        <h2>{name || '—'}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {status !== false && (
        <span className="sp-id__status">
          <span className="sp-dot" />{statusLabel || (isActive ? tr('Active', 'نشط') : status)}
        </span>
      )}
    </section>
  );
}

/** A titled panel — same look as every block under the hero. */
export function ProfileBlock({ title, count, children, className = '' }) {
  return (
    <section className={`sp-block ${className}`.trim()}>
      {title && (
        <h3>
          {title}
          {count != null && <span className="sp-block__count" dir="ltr">{count}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Profile-photo uploader (personal photo — never the institution logo). */
export function PhotoBlock({ name, avatarPath, endpoint, profileEndpoint, note }) {
  const { tr } = useTr();
  return (
    <ProfileBlock title={tr('Profile photo', 'الصورة الشخصية')}>
      {note && <p className="sp-muted" style={{ marginBottom: 14 }}>{note}</p>}
      <AvatarUploader name={name} avatarPath={avatarPath} endpoint={endpoint} profileEndpoint={profileEndpoint} />
    </ProfileBlock>
  );
}

/**
 * Read-only facts. `items`: [{ icon, label, value, ltr }] — empty values are
 * shown as "—" so the layout never jumps. `note` overrides the default lock line.
 */
export function ManagedDetails({ title, items, note }) {
  const { tr } = useTr();
  const rows = (items || []).filter(Boolean);
  if (!rows.length) return null;
  return (
    <ProfileBlock title={title || tr('Account & placement', 'بيانات الحساب والانتماء')}>
      <dl className="sp-fields">
        {rows.map((f) => (
          <div key={f.label} className="sp-field">
            <span className="sp-field__icon"><Icon name={f.icon || 'info'} size={16} /></span>
            <div><dt>{f.label}</dt><dd dir={f.ltr ? 'ltr' : undefined}>{f.value || '—'}</dd></div>
          </div>
        ))}
      </dl>
      <p className="sp-note"><Icon name="lock" size={13} />{note || tr('These details are managed by your university or administration.', 'هذه البيانات تُدار من جامعتك أو إدارة المنصة.')}</p>
    </ProfileBlock>
  );
}

const pickFromResponse = (json) => {
  const d = json?.data || {};
  // Portals answer with { profile }, { profile, supervisor }, a bare user row or a bare profile.
  return { ...d.supervisor, ...(d.profile || (d.full_name || d.name_ar || d.name_en ? d : {})) };
};

/**
 * One self-editing identity profile.
 *
 *   profile        initial row (needs name_ar / name_en / full_name; avatar_path, phone … optional)
 *   endpoint       PATCH url that saves the person's own details
 *   eyebrow        small label above the name ("Academic Staff · Supervisor")
 *   subtitle(p)    line under the name, from the live profile
 *   status         account status string, or false to hide the pill
 *   fields         extra editable fields beyond the two names:
 *                  [{ key, label, icon?, type?, ltr?, multiline?, maxLength?, placeholder?, help? }]
 *                  `phone` is the usual one; every key is sent to `endpoint` as-is.
 *   managed        read-only facts: [{ icon, label, value, ltr }] (or a fn of the live profile)
 *   managedNote    text for the lock line under the managed facts
 *   avatar         { endpoint, profileEndpoint } to show the photo uploader, or null
 *   onSaved(p)     called with the merged profile after a successful save
 *   children       extra blocks rendered last (permissions, scope, …)
 */
export function PersonProfile({
  profile, endpoint, eyebrow, subtitle, status, fields = [], managed, managedNote, avatar, onSaved, children,
  editTitle,
}) {
  const { ar, locale, tr } = useTr();
  const [live, setLive] = useState(profile || {});
  const [form, setForm] = useState(() => initialForm(profile, fields));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); setMessage(null); };

  async function submit(e) {
    e.preventDefault();
    const nameErr = checkNames(form.name_ar, form.name_en, locale, setErrors);
    if (nameErr) { setError(nameErr); return; }
    setSaving(true); setError(null); setSaved(false); setMessage(null);
    try {
      const body = { name_ar: form.name_ar.trim(), name_en: form.name_en.trim() };
      fields.forEach((f) => { body[f.key] = (form[f.key] ?? '').toString().trim(); });
      const json = await api.patch(endpoint, body);
      const next = { ...live, ...pickFromResponse(json), ...body };
      next.full_name = (ar ? next.name_ar : next.name_en) || next.full_name;
      setLive(next);
      setForm(initialForm(next, fields));
      setErrors({});
      setSaved(true);
      setMessage(json?.message || null);
      // Topbar / sidebar / chats show the new name straight away.
      announceProfile({ full_name: next.full_name, name_ar: next.name_ar, name_en: next.name_en });
      onSaved?.(next);
    } catch (err) {
      const fieldErrors = err?.payload?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') setErrors(flattenErrors(fieldErrors));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const heroName = personName(live, locale);
  const managedItems = typeof managed === 'function' ? managed(live) : managed;

  return (
    <div className="sp">
      <IdentityHero
        eyebrow={eyebrow}
        name={heroName}
        subtitle={typeof subtitle === 'function' ? subtitle(live) : subtitle}
        status={status}
        avatarPath={live.avatar_path}
      />

      {avatar && (
        <PhotoBlock
          name={heroName}
          avatarPath={live.avatar_path}
          endpoint={avatar.endpoint}
          profileEndpoint={avatar.profileEndpoint}
        />
      )}

      <ProfileBlock title={editTitle || tr('Your details', 'بياناتك')}>
        <form onSubmit={submit} className="sp-form" noValidate>
          <div className="sp-form__grid">
            <BilingualNameFields nameAr={form.name_ar} nameEn={form.name_en} errors={errors} onChange={set} />
            {fields.map((f) => (
              <div key={f.key} className={`form-group${f.multiline ? ' sp-form__wide' : ''}`}>
                <label className="form-label" htmlFor={`sp-${f.key}`}>{f.label}</label>
                {f.multiline ? (
                  <textarea
                    id={`sp-${f.key}`} className="form-input" rows={3} maxLength={f.maxLength}
                    value={form[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={(e) => set({ [f.key]: e.target.value })}
                  />
                ) : (
                  <input
                    id={`sp-${f.key}`} className="form-input" type={f.type || 'text'} maxLength={f.maxLength}
                    value={form[f.key] ?? ''} placeholder={f.placeholder} dir={f.ltr ? 'ltr' : 'auto'}
                    style={f.ltr ? { textAlign: ar ? 'right' : 'left' } : undefined}
                    onChange={(e) => set({ [f.key]: e.target.value })}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  />
                )}
                {errors[f.key] && <div className="form-error" style={{ fontSize: 12, marginTop: 4 }}>{errors[f.key]}</div>}
                {f.help && !errors[f.key] && <div className="sp-muted" style={{ marginTop: 4, fontSize: 12 }}>{f.help}</div>}
              </div>
            ))}
          </div>
          {message && <p className="text-caption" style={{ color: 'var(--color-success)' }}>{message}</p>}
          {error && !Object.keys(errors).length && <p className="text-caption" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <div className="sp-form__actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="check" size={18} /> {saving ? tr('Saving…', 'جارٍ الحفظ…') : tr('Save changes', 'حفظ التعديلات')}
            </button>
            <SavedBadge show={saved} />
          </div>
        </form>
      </ProfileBlock>

      <ManagedDetails items={managedItems} note={managedNote} />

      {children}
    </div>
  );
}

function initialForm(profile, fields) {
  const p = profile || {};
  const f = {
    name_ar: p.name_ar || p.full_name || '',
    name_en: p.name_en || p.full_name || '',
  };
  fields.forEach((x) => { f[x.key] = p[x.key] ?? ''; });
  return f;
}

function flattenErrors(errs) {
  const out = {};
  Object.entries(errs).forEach(([k, v]) => { out[k] = Array.isArray(v) ? v[0] : String(v); });
  return out;
}
