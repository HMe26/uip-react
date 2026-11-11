import { personName } from '../../utils/bilingualName';
import BilingualNameFields, { checkNames } from '../../components/common/BilingualNameFields';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import LinkExistingModal from '../../components/people/LinkExistingModal';
import { CredentialsModal, PasswordInput, SetPasswordModal } from '../../components/people/credentials';
import { FormModal, FormSection, FieldGrid, Field, LoginAccess } from '../../components/people/formUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/supervisors';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/supervisors.php, talking to the real JSON
 * API (App\Controllers\Api\SupervisorsApiController — same
 * SupervisorManagementService the Blade page uses). Covers roster
 * listing/search, invite, edit permissions, activate/deactivate, resend
 * invite, delete, and scope-assignment management (faculty/department/
 * academic_year/group/project grants).
 */

const PERMISSIONS = [
  { key: 'view_students', en: 'View Assigned Students', ar: 'عرض الطلاب المُسندين' },
  { key: 'manage_projects', en: 'Review & Approve Projects', ar: 'مراجعة واعتماد المشاريع' },
  { key: 'manage_messages', en: 'Messages', ar: 'الرسائل' },
  { key: 'view_reports', en: 'Reports', ar: 'التقارير' },
];

const SCOPE_TYPES = [
  { key: 'faculty', en: 'Faculty', ar: 'كلية' },
  { key: 'department', en: 'Department', ar: 'القسم' },
  { key: 'academic_year', en: 'Academic Year', ar: 'سنة دراسية' },
  { key: 'group', en: 'Group', ar: 'مجموعة' },
  { key: 'project', en: 'Project', ar: 'مشروع' },
];

const STATUS_META = {
  active: { cls: 'badge-success', en: 'Active', ar: 'نشط' },
  pending: { cls: 'badge-primary', en: 'Pending', ar: 'قيد التفعيل' },
  inactive: { cls: 'badge-neutral', en: 'Inactive', ar: 'غير نشط' },
  suspended: { cls: 'badge-danger', en: 'Suspended', ar: 'موقوف' },
};
const INVITE_META = {
  pending: { cls: 'badge-primary', en: 'Invite Pending', ar: 'دعوة قيد الانتظار' },
  accepted: { cls: 'badge-success', en: 'Accepted', ar: 'مقبولة' },
  expired: { cls: 'badge-danger', en: 'Invite Expired', ar: 'دعوة منتهية' },
};

export default function UniversitySupervisors() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/supervisors', { search: search || undefined, per_page: 100 })
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? (json.data || []).length);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleStatus(s) {
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.post(`/api/v1/supervisors/${s.id}/${s.status === 'active' ? 'deactivate' : 'activate'}`, {});
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(s) {
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.post(`/api/v1/supervisors/${s.id}/resend`, {});
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s) {
    if (!window.confirm(t('Remove this supervisor?'))) return;
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.delete(`/api/v1/supervisors/${s.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Supervisors')}</h1>
          <p className="text-small">{t('Faculty members with a real login account, who can only manage the students and projects within their assigned scope.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={() => setLinking(true)}>
            <Icon name="users" size={16} /> {locale === 'ar' ? 'ربط مشرف موجود' : 'Link existing supervisor'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
          <Icon name="plus" size={16} /> {locale === 'ar' ? 'إضافة مشرف' : 'Add Supervisor'}
        </button>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}
      {notice && <p className="text-small" style={{ color: 'var(--color-success)' }}>{notice}</p>}

      <div className="card glass-panel" style={{ marginBottom: 'var(--space-5)', display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-input" placeholder={t('Full Name')} value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="text-small">{total} {t('All Supervisors')}</span>
      </div>

      {loading && <p className="text-small">{t('Loading…')}</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && (
        <div className="table-responsive card glass-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('Full Name')}</th>
                <th>{t('Department')}</th>
                <th>{t('Academic Title')}</th>
                <th>{t('Permissions')}</th>
                <th>{locale === 'ar' ? 'الحالة' : 'Status'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const meta = STATUS_META[s.status] || STATUS_META.active;
                const inviteMeta = s.effective_invitation_status && INVITE_META[s.effective_invitation_status];
                const busy = busyId === s.id;
                const perms = s.permissions_list || [];
                return (
                  <tr key={s.id}>
                    <td>{personName(s, locale)}<br /><span className="text-caption">{s.email}</span></td>
                    <td>{s.department || '—'}</td>
                    <td>{s.title || '—'}</td>
                    <td>
                      {perms.length
                        ? perms.map((p) => PERMISSIONS.find((x) => x.key === p)?.[locale] || p).join(', ')
                        : t('No permissions')}
                    </td>
                    <td>
                      <span className={`badge ${meta.cls}`}>{meta[locale]}</span>
                      {inviteMeta && <> <span className={`badge ${inviteMeta.cls}`}>{inviteMeta[locale]}</span></>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        <button type="button" className="btn btn-outline btn-sm" title={t('Edit permissions')} onClick={() => setEditing(s)}><Icon name="edit" size={14} /></button>
                        {s.invited_at && <button type="button" className="btn btn-outline btn-sm" title={locale === 'ar' ? 'كلمة السر' : 'Password'} onClick={() => setPasswordFor(s)}><Icon name="key" size={14} /></button>}
                        {s.effective_invitation_status && s.effective_invitation_status !== 'accepted' && (
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy} title={t('Resend')} onClick={() => handleResend(s)}><Icon name="mail" size={14} /></button>
                        )}
                        {s.status === 'active' ? (
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy} title={t('Deactivate')} onClick={() => handleToggleStatus(s)}><Icon name="x" size={14} /></button>
                        ) : (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} title={t('Activate')} onClick={() => handleToggleStatus(s)}><Icon name="check" size={14} /></button>
                        )}
                        <button type="button" className="btn btn-danger btn-sm" disabled={busy} title={t('Remove')} onClick={() => handleDelete(s)}><Icon name="trash" size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-small" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>{t('No supervisors added yet.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {linking && (
        <LinkExistingModal
          type="supervisor"
          onClose={() => setLinking(false)}
          onDone={(msg) => { setLinking(false); setNotice(msg); load(); }}
        />
      )}

      {passwordFor && (
        <SetPasswordModal
          title={`${locale === 'ar' ? 'كلمة السر: ' : 'Password: '}${passwordFor.full_name}`}
          endpoint={`/api/v1/supervisors/${passwordFor.id}/password`}
          onClose={() => setPasswordFor(null)}
        />
      )}

      {inviting && (
        <InviteSupervisorModal onClose={() => setInviting(false)} onDone={(err) => { setInviting(false); if (err) setActionError(err); else load(); }} />
      )}

      {editing && (
        <EditSupervisorModal
          supervisor={editing}
          onClose={() => setEditing(null)}
          onDone={(err) => { if (err) setActionError(err); load(); }}
        />
      )}
    </>
  );
}

function InviteSupervisorModal({ onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [names, setNames] = useState({ name_ar: '', name_en: '' });
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [title, setTitle] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function togglePermission(key) {
    setPermissions((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    { const nameErr = checkNames(names.name_ar, names.name_en, locale); if (nameErr) { setError(nameErr); return; } }
    setSaving(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/supervisors', { name_ar: names.name_ar, name_en: names.name_en, email, department, title, permissions, password: password.trim() || null, locale });
      setCreated({ password: json.data?.password ?? '', message: json.message });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (created) {
    return (
      <CredentialsModal
        title={locale === 'ar' ? 'تمت إضافة المشرف' : 'Supervisor added'}
        email={email}
        password={created.password}
        message={created.message}
        onClose={() => onDone(null)}
      />
    );
  }

  return (
    <FormModal
      icon="shield"
      title={t('Invite Supervisor')}
      subtitle={locale === 'ar' ? 'أنشئ حساب مشرف وحدد صلاحياته.' : 'Create a supervisor account and choose what they can do.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitDisabled={password !== '' && password.length < 8}
      submitLabel={t('Invite Supervisor')}
    >
      <FormSection title={locale === 'ar' ? 'البيانات الشخصية' : 'Personal details'}>
        <FieldGrid>
          <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} Field={Field} />
          <Field label={t('Email')} required>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={t('Department')}>
            <input className="form-input" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
          <Field label={t('Academic Title')}>
            <input className="form-input" placeholder={t('e.g. Assistant Professor')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('Permissions')} hint={locale === 'ar' ? 'حدد ما يستطيع المشرف فعله.' : 'Pick what this supervisor can do.'}>
        <div className="pf-perms">
          {PERMISSIONS.map((p) => (
            <label key={p.key} className={`pf-perm${permissions.includes(p.key) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={permissions.includes(p.key)} onChange={() => togglePermission(p.key)} />
              {p[locale]}
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection title={locale === 'ar' ? 'بيانات الدخول' : 'Login access'} hint={locale === 'ar' ? 'اختر كيف تُنشأ كلمة السر.' : 'Choose how the password is created.'}>
        <LoginAccess password={password} onPassword={setPassword} />
      </FormSection>
    </FormModal>
  );
}

function EditSupervisorModal({ supervisor, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [department, setDepartment] = useState(supervisor.department || '');
  const [title, setTitle] = useState(supervisor.title || '');
  const [permissions, setPermissions] = useState(supervisor.permissions_list || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Scope assignments
  const [assignments, setAssignments] = useState(supervisor.assignments || []);
  const [faculties, setFaculties] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [projects, setProjects] = useState([]);
  const [scopeType, setScopeType] = useState('faculty');
  const [scopeValue, setScopeValue] = useState('');
  const [scopeProjectId, setScopeProjectId] = useState('');
  const [scopeYear, setScopeYear] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/faculty', { per_page: 100 }).then((json) => setFaculties(json.data || [])).catch(() => {});
    api.get('/api/v1/groups', { per_page: 100 }).then((json) => setGroups(json.data || [])).catch(() => {});
    api.get('/api/v1/projects', { per_page: 100 }).then((json) => setProjects(json.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (scopeType !== 'department') return;
    api.get('/api/v1/faculty', { per_page: 100 })
      .then(async (json) => {
        const all = [];
        for (const f of json.data || []) {
          try {
            const d = await api.get(`/api/v1/faculty/${f.id}`);
            (d.data?.departments || []).forEach((dep) => all.push(dep));
          } catch { /* skip */ }
        }
        setDepartments(all);
      })
      .catch(() => {});
  }, [scopeType]);

  function togglePermission(key) {
    setPermissions((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/supervisors/${supervisor.id}`, { department, title, permissions });
      onDone(null);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    setAssigning(true);
    setAssignError(null);
    try {
      const payload = { scope_type: scopeType };
      if (scopeType === 'project') payload.project_id = scopeProjectId;
      else if (scopeType === 'academic_year') payload.scope_value = scopeYear;
      else payload.scope_value = scopeValue;

      await api.post(`/api/v1/supervisors/${supervisor.id}/assignments`, payload);
      const fresh = await api.get(`/api/v1/supervisors/${supervisor.id}/assignments`);
      setAssignments(fresh.data || []);
      setScopeValue(''); setScopeProjectId(''); setScopeYear('');
      onDone(null);
    } catch (err) {
      setAssignError(errorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(assignmentId) {
    if (!window.confirm(t('Remove this scope?'))) return;
    try {
      await api.delete(`/api/v1/supervisors/${supervisor.id}/assignments/${assignmentId}`);
      setAssignments((a) => a.filter((x) => x.id !== assignmentId));
      onDone(null);
    } catch (err) {
      setAssignError(errorMessage(err));
    }
  }

  function scopeLabel(a) {
    if (a.scope_type === 'faculty') return `${t('Faculty')}: ${locale === 'ar' ? a.faculty_name_ar : a.faculty_name_en}`;
    if (a.scope_type === 'department') return `${t('Department')}: ${locale === 'ar' ? a.department_name_ar : a.department_name_en}`;
    if (a.scope_type === 'group') return `${t('Group')}: ${a.group_name}`;
    if (a.scope_type === 'project') return `${t('Project')}: ${locale === 'ar' ? a.project_title_ar : a.project_title_en}`;
    if (a.scope_type === 'academic_year') return `${t('Academic Year')}: ${a.scope_value}`;
    return a.scope_type;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2 className="modal-box__title text-h3">{t('Edit permissions & scope: ')}{supervisor.full_name}</h2>

        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Department')}</label>
              <input className="form-input" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Academic Title')}</label>
              <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Permissions')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              {PERMISSIONS.map((p) => (
                <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <input type="checkbox" checked={permissions.includes(p.key)} onChange={() => togglePermission(p.key)} />
                  {p[locale]}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Save Permissions')}</button>
          </div>
        </form>

        <hr style={{ margin: 'var(--space-4) 0', border: 'none', borderTop: '1px solid var(--color-border)' }} />

        <h3 className="text-h4">{t('Assign a new scope')}</h3>
        <form onSubmit={handleAssign} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
          <div className="form-group" style={{ minWidth: 160 }}>
            <label className="form-label">{t('Scope type')}</label>
            <select className="form-input" value={scopeType} onChange={(e) => { setScopeType(e.target.value); setScopeValue(''); setScopeProjectId(''); setScopeYear(''); }}>
              {SCOPE_TYPES.map((s) => <option key={s.key} value={s.key}>{s[locale]}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label className="form-label">{t('Value')}</label>
            {scopeType === 'faculty' && (
              <select className="form-input" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} required>
                <option value="">—</option>
                {faculties.map((f) => <option key={f.id} value={f.id}>{locale === 'ar' ? f.name_ar : f.name_en}</option>)}
              </select>
            )}
            {scopeType === 'department' && (
              <select className="form-input" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} required>
                <option value="">—</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{locale === 'ar' ? d.name_ar : d.name_en}</option>)}
              </select>
            )}
            {scopeType === 'group' && (
              <select className="form-input" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} required>
                <option value="">—</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            {scopeType === 'project' && (
              <select className="form-input" value={scopeProjectId} onChange={(e) => setScopeProjectId(e.target.value)} required>
                <option value="">—</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{locale === 'ar' ? p.title_ar : p.title_en}</option>)}
              </select>
            )}
            {scopeType === 'academic_year' && (
              <input className="form-input" type="number" min="1" max="8" value={scopeYear} onChange={(e) => setScopeYear(e.target.value)} required />
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={assigning}>{t('Assign')}</button>
        </form>
        {assignError && <p className="form-error">{assignError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {assignments.length === 0 && <p className="text-small">{t('No scope')}</p>}
          {assignments.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
              <span className="text-small">{scopeLabel(a)}</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => handleUnassign(a.id)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>

        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{locale === 'ar' ? 'إغلاق' : 'Close'}</button>
        </div>
      </div>
    </div>
  );
}
