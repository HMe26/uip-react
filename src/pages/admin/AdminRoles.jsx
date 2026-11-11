import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ConfirmModal, Field } from '../../components/admin/adminUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/roles';
import i18nKit from '../../i18n/admin/page-kit';
import AdminPage, { Chips, EmptyState, ErrorState, Kpi, KpiGrid, Skeleton } from '../../components/admin/AdminPage';

const translations = { ...i18nKit, ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/admin/roles.php + role-permissions.php + role-create.php,
 * talking to the real JSON API (app/Controllers/Api/AdminRolesApiController.php,
 * /api/v1/admin/roles/*). Every role in `roles` (the six core roles plus any
 * custom ones — the platform now has 13, not just six, roles.php's own
 * comment is stale), each with live user/permission counts from
 * RolePermissionRepository::rolesWithCounts() — nothing here is invented.
 * Permission editing replaces the whole set (not a diff), same as the
 * web's checklist editor (AdminRolesApiController::updatePermissions doc).
 *
 * Card icon is presentation-only (roles.php: "icon has no column in
 * `roles` — it's UI chrome, not data") — same $roleIcons lookup, same
 * 'shield' fallback for every role beyond the original six.
 */

const ROLE_ICONS = {
  student: 'user', university: 'building', researcher: 'flask',
  admin: 'shield',
};

export default function AdminRoles() {
  const t = useTranslations(translations);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingSlug, setEditingSlug] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/roles')
      .then((json) => setRoles((json.data || []).filter((r) => r.slug !== 'company')))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      await api.del(`/api/v1/admin/roles/${deleting.slug}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const customCount = roles.filter((r) => Number(r.is_system ?? 1) !== 1).length;
  const totalUsers = roles.reduce((n, r) => n + Number(r.users_count ?? 0), 0);

  const maxPerms = Math.max(1, ...roles.map((r) => Number(r.permissions_count ?? 0)));
  const needle = q.trim().toLowerCase();
  const visible = roles.filter((r) => {
    const isSystem = Number(r.is_system ?? 1) === 1;
    if (kind === 'system' && !isSystem) return false;
    if (kind === 'custom' && isSystem) return false;
    if (!needle) return true;
    return `${r.slug} ${r.name_en || ''} ${r.name_ar || ''} ${r.description || ''}`.toLowerCase().includes(needle);
  });

  return (
    <AdminPage
      icon="shield"
      title={t('Roles & Permissions')}
      subtitle={t('The platform\'s core roles, and what each one is permitted to do.')}
      actions={(
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> {t('New Custom Role')}
        </button>
      )}
    >
      {!loading && !error && (
        <KpiGrid>
          <Kpi icon="shield" title={t('Roles')} value={roles.length.toLocaleString()} />
          <Kpi icon="edit" title={t('Custom role')} value={customCount.toLocaleString()} />
          <Kpi icon="users" title={t('Users with a role')} value={totalUsers.toLocaleString()} />
        </KpiGrid>
      )}

      {actionError && <p className="form-error">{actionError}</p>}
      {loading && <Skeleton rows={5} cols={3} />}
      {error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <div className="adm-filters">
            <div className="adm-filters__search">
              <Icon name="search" size={16} />
              <input className="form-input" type="search" placeholder={t('Search roles…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search roles…')} />
            </div>
            <Chips label={t('Roles')} value={kind} onChange={setKind} options={[['', t('All')], ['system', t('System')], ['custom', t('Custom')]]} />
          </div>

          {visible.length === 0 ? (
            <div className="sa-card"><EmptyState title={t('No roles match this search.')} /></div>
          ) : (
            <div className="rl-grid">
              {visible.map((r) => {
                const isSystem = Number(r.is_system ?? 1) === 1;
                const perms = Number(r.permissions_count ?? 0);
                return (
                  <article key={r.slug} className="rl-card">
                    <header className="rl-card__head">
                      <span className="rl-card__icon" aria-hidden="true"><Icon name={ROLE_ICONS[r.slug] || 'shield'} size={20} /></span>
                      <div className="rl-card__title">
                        <h3>{L(t, r.name_en, r.name_ar)}</h3>
                        <code>{r.slug}</code>
                      </div>
                      <span className={`rl-tag${isSystem ? '' : ' rl-tag--custom'}`}>{isSystem ? t('System role') : t('Custom role')}</span>
                    </header>
                    <p className="rl-card__desc">{r.description ? t(r.description) : '—'}</p>
                    <div className="rl-stats">
                      <div><Icon name="users" size={15} /><strong>{Number(r.users_count ?? 0).toLocaleString()}</strong><span>{t('users')}</span></div>
                      <div><Icon name="key" size={15} /><strong>{perms.toLocaleString()}</strong><span>{t('permissions')}</span></div>
                    </div>
                    <div className="rl-meter" role="img" aria-label={`${perms} ${t('permissions')}`}><i style={{ width: `${Math.max(perms ? 4 : 0, Math.round((perms / maxPerms) * 100))}%` }} /></div>
                    <footer className="rl-card__foot">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingSlug(r.slug)}>
                        <Icon name="edit" size={14} /> {t('Edit permissions')}
                      </button>
                      {!isSystem && (
                        <button type="button" className="btn btn-ghost btn-sm adm-btn-danger" onClick={() => setDeleting(r)} aria-label={t('Delete')} title={t('Delete')}>
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {editingSlug && (
        <PermissionsModal slug={editingSlug} onClose={() => setEditingSlug(null)} onSaved={() => { setEditingSlug(null); load(); }} />
      )}
      {deleting && (
        <ConfirmModal title={t('Confirm action')} message={t('Delete the custom role "{name}"? Users holding it lose its permissions.').replace('{name}', L(t, deleting.name_en, deleting.name_ar))} confirmLabel={t('Delete')} danger busy={busy} onConfirm={handleDelete} onClose={() => setDeleting(null)} />
      )}
      {creating && (
        <CreateRoleModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />
      )}
    </AdminPage>
  );
}

const humanize = (txt) => {
  const out = String(txt || '').replace(/[_.]+/g, ' ').trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
};

// "data_analysis.dashboard.view" -> label "Dashboard view" (the module is already the group title)
function permLabel(p) {
  const slug = String(p.slug || '');
  const mod = String(p.module || '');
  const rest = mod && slug.startsWith(`${mod}.`) ? slug.slice(mod.length + 1) : slug.split('.').slice(1).join('.') || slug;
  return humanize(rest);
}

function PermissionsModal({ slug, onClose, onSaved }) {
  const t = useTranslations(translations);
  const [role, setRole] = useState(null);
  // allPermissionsGrouped() returns { moduleName: [ {id, slug, module, description}, ... ] }
  const [groups, setGroups] = useState({});
  const [granted, setGranted] = useState(new Set());
  const [initial, setInitial] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [onlyGranted, setOnlyGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/admin/roles/${slug}`)
      .then((json) => {
        if (cancelled) return;
        setRole(json.data.role);
        setGroups(json.data.permission_groups || {});
        const ids = new Set(json.data.granted_ids || []);
        setGranted(ids);
        setInitial(new Set(ids));
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const allPerms = useMemo(() => Object.values(groups).flat().filter(Boolean), [groups]);
  const total = allPerms.length;
  const dirty = useMemo(() => {
    if (granted.size !== initial.size) return true;
    for (const id of granted) if (!initial.has(id)) return true;
    return false;
  }, [granted, initial]);

  function toggle(id) {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setMany(ids, on) {
    setGranted((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/admin/roles/${slug}/permissions`, { permissions: Array.from(granted) });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const visibleGroups = Object.entries(groups)
    .map(([moduleName, perms]) => {
      const list = (perms || []).filter((p) => {
        if (onlyGranted && !granted.has(p.id)) return false;
        if (!q) return true;
        return `${p.slug} ${p.description || ''} ${moduleName}`.toLowerCase().includes(q);
      });
      return [moduleName, perms || [], list];
    })
    .filter(([, , list]) => list.length > 0);

  return (
    <div className="modal-overlay" onClick={() => { if (!dirty && !saving) onClose(); }}>
      <div className="adm-perm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="adm-perm__head">
          <div>
            <h2 className="text-h3">{role ? `${L(t, role.name_en, role.name_ar)} — ${t('Permissions')}` : t('Permissions')}</h2>
            <p className="adm-muted">{loading ? '…' : t('{n} of {total} permissions granted').replace('{n}', granted.size).replace('{total}', total)}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label={t('Close')} onClick={onClose}><Icon name="x" size={18} /></button>
        </header>

        <div className="adm-perm__toolbar">
          <div className="adm-filters__search">
            <Icon name="search" size={15} />
            <input className="form-input" type="text" placeholder={t('Search permissions…')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="adm-seg" role="group">
            <button type="button" className={!onlyGranted ? 'is-active' : ''} onClick={() => setOnlyGranted(false)}>{t('All')}</button>
            <button type="button" className={onlyGranted ? 'is-active' : ''} onClick={() => setOnlyGranted(true)}>{t('Granted')}</button>
          </div>
          <div className="adm-perm__bulk">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMany(allPerms.map((p) => p.id), true)}>{t('Grant all')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMany(allPerms.map((p) => p.id), false)}>{t('Revoke all')}</button>
          </div>
        </div>

        <div className="adm-perm__body">
          {loading && <p className="text-small">{t('Loading…')}</p>}
          {error && <p className="form-error">{error}</p>}
          {!loading && !error && visibleGroups.length === 0 && <p className="adm-empty" style={{ padding: 28, textAlign: 'center' }}>{t('No permissions match.')}</p>}
          {!loading && visibleGroups.map(([moduleName, all, list]) => {
            const ids = all.map((p) => p.id);
            const on = ids.filter((id) => granted.has(id)).length;
            const state = on === 0 ? '' : on === ids.length ? ' is-all' : ' is-some';
            return (
              <section key={moduleName} className="adm-perm-group">
                <div className="adm-perm-group__head">
                  <div>
                    <h3>{t(humanize(moduleName))}</h3>
                    <span className={`adm-perm-group__count${state}`}>{on}/{ids.length} {t('granted')}</span>
                  </div>
                  <label className="switch" title={on === ids.length ? t('Revoke all in this module') : t('Grant all in this module')}>
                    <input type="checkbox" checked={on === ids.length} onChange={(e) => setMany(ids, e.target.checked)} />
                    <span className="switch__track" />
                  </label>
                </div>
                <ul className="adm-perm-group__list">
                  {list.map((p) => (
                    <li key={p.id} className="adm-perm-row">
                      <div className="adm-perm-row__text">
                        <strong>{t(permLabel(p))}</strong>
                        <code>{p.slug}</code>
                        {p.description && <span className="adm-muted">{t(p.description)}</span>}
                      </div>
                      <label className="switch">
                        <input type="checkbox" checked={granted.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.slug} />
                        <span className="switch__track" />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="adm-perm__foot">
          <span className="adm-muted">{dirty ? t('You have unsaved changes') : t('No changes')}</span>
          <div>
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="button" className="btn btn-primary" disabled={saving || loading || !dirty} onClick={handleSave}>
              {saving ? t('Saving…') : t('Save Permissions')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const slugify = (v) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

function CreateRoleModal({ onClose, onSaved }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const bodyRef = useRef(null);
  const DESC_MAX = 240;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  const clear = (k) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  const cleanSlug = slugify(slug);

  function validate() {
    const e = {};
    if (cleanSlug.length < 2) e.slug = tr('Use at least 2 letters or numbers (a–z, 0–9, _).', 'اكتب حرفين أو رقمين على الأقل (a–z و 0–9 و _).');
    if (nameEn.trim().length < 2) e.name_en = tr('The English name is required.', 'الاسم بالإنجليزي مطلوب.');
    else if (/[؀-ۿ]/.test(nameEn)) e.name_en = tr('Use English letters only.', 'اكتب الاسم بحروف إنجليزية فقط.');
    if (nameAr.trim().length < 2) e.name_ar = tr('The Arabic name is required.', 'الاسم بالعربي مطلوب.');
    else if (!/[؀-ۿ]/.test(nameAr)) e.name_ar = tr('Write the Arabic name using Arabic letters.', 'اكتب الاسم بالحروف العربية.');
    return e;
  }

  function focusFirst(e) {
    const k = ['slug', 'name_en', 'name_ar'].find((x) => e[x]);
    if (k) requestAnimationFrame(() => bodyRef.current?.querySelector(`#rc-${k}`)?.focus());
  }

  async function handleSubmit(ev) {
    ev.preventDefault();
    if (saving) return;
    const v = validate();
    if (Object.keys(v).length) { setErrors(v); setFormError(tr('Please fix the highlighted fields.', 'من فضلك صحّح الحقول المحددة بالأحمر.')); focusFirst(v); return; }
    setSaving(true); setErrors({}); setFormError(null);
    try {
      await api.post('/api/v1/admin/roles', { slug: cleanSlug, name_en: nameEn.trim(), name_ar: nameAr.trim(), description: description.trim() || undefined });
      onSaved();
    } catch (err) {
      const server = err?.payload?.errors;
      const mapped = {};
      if (server && typeof server === 'object') ['slug', 'name_en', 'name_ar'].forEach((k) => { if (server[k]) mapped[k] = [].concat(server[k]).join(' '); });
      const msg = errorMessage(err);
      if (!Object.keys(mapped).length && /already exists|identifier/i.test(msg)) mapped.slug = tr('A role with this identifier already exists. Choose another one.', 'يوجد دور بنفس هذا المعرّف بالفعل. اختر معرّفًا آخر.');
      setErrors(mapped);
      setFormError(Object.keys(mapped).length ? tr('Please fix the highlighted fields.', 'من فضلك صحّح الحقول المحددة بالأحمر.') : msg);
      focusFirst(mapped);
    } finally {
      setSaving(false);
    }
  }

  const previewName = (locale === 'ar' ? nameAr || nameEn : nameEn || nameAr).trim();

  return (
    <div className="modal-overlay um-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="um um--sm" role="dialog" aria-modal="true" aria-labelledby="rc-title">
        <header className="um-head">
          <span className="um-head__avatar"><Icon name="shield" size={22} /></span>
          <div className="um-head__text">
            <h2 id="rc-title">{tr('New custom role', 'دور مخصص جديد')}</h2>
            <p>{tr('Create the role now, then grant its permissions from the roles page.', 'أنشئ الدور الآن ثم حدّد صلاحياته من صفحة الأدوار.')}</p>
          </div>
          <button type="button" className="um-close" onClick={onClose} disabled={saving} aria-label={tr('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>

        <form className="um-form" onSubmit={handleSubmit} noValidate>
          <div className="um-body" ref={bodyRef}>
            {formError && <div className="um-alert" role="alert"><Icon name="alert-triangle" size={16} /><span>{formError}</span></div>}

            <section className="um-section">
              <h3 className="um-section__title">{tr('Role name', 'اسم الدور')}</h3>
              <div className="um-grid">
                <Field id="rc-name_en" label={tr('Name (English)', 'الاسم (بالإنجليزية)')} required error={errors.name_en}>
                  <input id="rc-name_en" className="um-input" dir="ltr" lang="en" value={nameEn} placeholder="Content Moderator" maxLength={80} autoFocus
                    aria-invalid={errors.name_en ? 'true' : undefined}
                    onChange={(e) => { setNameEn(e.target.value); clear('name_en'); if (!slugTouched) { setSlug(slugify(e.target.value)); clear('slug'); } }} />
                </Field>
                <Field id="rc-name_ar" label={tr('Name (Arabic)', 'الاسم (بالعربية)')} required error={errors.name_ar}>
                  <input id="rc-name_ar" className="um-input" dir="rtl" lang="ar" value={nameAr} placeholder="مشرف المحتوى" maxLength={80}
                    aria-invalid={errors.name_ar ? 'true' : undefined} onChange={(e) => { setNameAr(e.target.value); clear('name_ar'); }} />
                </Field>
              </div>
              <Field id="rc-slug" label={tr('Identifier (slug)', 'المعرّف (SLUG)')} required error={errors.slug}
                hint={tr('Lowercase English letters, numbers and underscores. It is generated from the English name and cannot be changed later.', 'حروف إنجليزية صغيرة وأرقام وشرطة سفلية. بيتولد من الاسم الإنجليزي ولا يمكن تغييره بعد الإنشاء.')}>
                <input id="rc-slug" className="um-input um-mono" dir="ltr" value={slug} placeholder="content_moderator" maxLength={60}
                  aria-invalid={errors.slug ? 'true' : undefined}
                  onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); clear('slug'); }} />
                {slug && cleanSlug !== slug && <p className="um-msg">{tr('Will be saved as', 'هيتحفظ كـ')} <code dir="ltr">{cleanSlug || '—'}</code></p>}
              </Field>
            </section>

            <section className="um-section">
              <h3 className="um-section__title">{tr('Description', 'الوصف')}</h3>
              <Field id="rc-desc" label={tr('What is this role for?', 'ما هو الغرض من هذا الدور؟')} hint={tr('Optional — shown on the role card.', 'اختياري — يظهر على كارت الدور.')}>
                <textarea id="rc-desc" className="um-input um-textarea" rows={3} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder={tr('e.g. Reviews and moderates user-generated content.', 'مثال: يراجع المحتوى الذي ينشره المستخدمون ويعدّله.')} />
                <span className="um-count">{description.length}/{DESC_MAX}</span>
              </Field>
            </section>

            <div className="um-preview" aria-label={tr('Preview', 'معاينة')}>
              <span className="rl-card__icon"><Icon name="shield" size={20} /></span>
              <div>
                <strong>{previewName || tr('Role name', 'اسم الدور')}</strong>
                <code dir="ltr">{cleanSlug || 'role_slug'}</code>
              </div>
              <span className="rl-tag rl-tag--custom">{t('Custom role')}</span>
            </div>
          </div>

          <footer className="um-foot">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="um-spin" aria-hidden="true" /> {t('Creating…')}</> : t('Create Role')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
