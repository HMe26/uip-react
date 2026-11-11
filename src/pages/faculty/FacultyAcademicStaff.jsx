import { personName } from '../../utils/bilingualName';
import BilingualNameFields, { checkNames } from '../../components/common/BilingualNameFields';
import { CredentialsModal } from '../../components/people/credentials';
import { FormModal, FormSection, FieldGrid, Field, LoginAccess } from '../../components/people/formUi';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import LinkExistingModal from '../../components/people/LinkExistingModal';
import { Alert, Empty, Mono, Pill, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/academic-staff';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/faculty/academic-staff.php's core roster management,
 * talking to the real JSON API (App\Controllers\Api\AcademicStaffApiController
 * — same AcademicStaffManagementService the University page uses).
 * FacultyAcademicStaffController (web) now also has an update() action
 * (department/rank/bio for a staff member already in this faculty), and
 * AcademicStaffApiController::update() accepts a Faculty caller too
 * (fixed to its own faculty_id, never client input — see that
 * controller's docblock). So — like UniversityAcademicStaff.jsx — there
 * is a "Manage" edit modal here, just without a Faculty picker (always
 * this faculty). No faculty picker on Invite either (fixed to the
 * caller's own faculty); Department comes from GET /api/v1/faculty/my/tree,
 * same source as FacultyStudents.jsx. Custom-rank creation (storeRank(),
 * now exposed at POST /api/v1/academic-staff/ranks) is available from
 * both the Invite and Manage rank fields — a rank created here is shared
 * university-wide, same as the web view's own "Add a custom rank" panel.
 */

const STATUS_META = {
  active: { cls: 'badge-success', en: 'Active', ar: 'نشط' },
  pending: { cls: 'badge-primary', en: 'Pending', ar: 'قيد التفعيل' },
  inactive: { cls: 'badge-neutral', en: 'Inactive', ar: 'غير نشط' },
  suspended: { cls: 'badge-danger', en: 'Suspended', ar: 'موقوف' },
};
const STATUS_TONE = { active: 'success', pending: 'primary', inactive: 'muted', suspended: 'danger' };
const INVITE_TONE = { pending: 'primary', accepted: 'success', expired: 'danger' };
const INVITE_META = {
  pending: { cls: 'badge-primary', en: 'Invite Pending', ar: 'دعوة قيد الانتظار' },
  accepted: { cls: 'badge-success', en: 'Accepted', ar: 'مقبولة' },
  expired: { cls: 'badge-danger', en: 'Invite Expired', ar: 'دعوة منتهية' },
};

function useRanks() {
  const [ranks, setRanks] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    api.get('/api/v1/academic-staff/ranks').then((json) => setRanks(json.data || [])).catch(() => {});
  }, [reloadKey]);
  return [ranks, () => setReloadKey((k) => k + 1)];
}

function AddRankPanel({ onCreated }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [category, setCategory] = useState('academic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    if (!nameAr.trim() || !nameEn.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/academic-staff/ranks', {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        category,
      });
      onCreated(json.data);
      setNameAr(''); setNameEn(''); setCategory('academic'); setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 'var(--space-2)' }} onClick={() => setOpen((v) => !v)}>
        <Icon name="plus" size={14} /> {t('Add a custom rank')}
      </button>
      {open && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-3)', marginTop: 'var(--space-2)', gap: 'var(--space-2)' }}>
          <input className="form-input" type="text" placeholder={t('Rank name (Arabic)')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <input className="form-input" type="text" placeholder={t('Rank name (English)')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="academic">{t('Academic')}</option>
            <option value="administrative">{t('Administrative')}</option>
          </select>
          {error && <p className="form-error">{error}</p>}
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={handleCreate}>
            {saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Create Rank')}
          </button>
        </div>
      )}
    </>
  );
}

function useOwnDepartments() {
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    api.get('/api/v1/faculty/my/tree').then((json) => setDepartments(json.data?.departments || [])).catch(() => {});
  }, []);
  return departments;
}

export default function FacultyAcademicStaff() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const departments = useOwnDepartments();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/academic-staff', { search: search || undefined, per_page: 100 })
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
      await api.post(`/api/v1/academic-staff/${s.id}/${s.status === 'active' ? 'deactivate' : 'activate'}`, {});
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
      await api.post(`/api/v1/academic-staff/${s.id}/resend`, {});
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s) {
    if (!window.confirm(t('Remove this staff member?'))) return;
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.del(`/api/v1/academic-staff/${s.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const ar = locale === 'ar';
  const STATUS_TABS = [
    { key: '', icon: 'users', tone: 'primary', en: 'All', ar: 'الكل' },
    { key: 'active', icon: 'check-circle', tone: 'success', en: 'Active', ar: 'نشط' },
    { key: 'pending', icon: 'clock', tone: 'warning', en: 'Pending', ar: 'قيد التفعيل' },
    { key: 'inactive', icon: 'x-circle', tone: 'muted', en: 'Inactive', ar: 'غير نشط' },
  ];
  const countOf = (key) => (key === '' ? rows.length : rows.filter((s) => s.status === key).length);
  const shown = statusFilter ? rows.filter((s) => s.status === statusFilter) : rows;

  return (
    <>
      <div className="um-page animate-rise-in">
        <header className="um-head">
          <div className="um-head__text">
            <h1>{t('Academic Staff')}</h1>
            <p>{ar ? `${total} عضو هيئة تدريس — إدارة الحسابات والرتب والاستيراد.` : `${total} academic staff — manage accounts, ranks and bulk import.`}</p>
          </div>
          <div className="um-head__act">
            <button type="button" className="btn btn-outline" onClick={() => setImporting(true)}>
              <Icon name="upload" size={16} /> {ar ? 'استيراد' : 'Import'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setLinking(true)}>
              <Icon name="link" size={16} /> {ar ? 'ربط دكتور / معيد موجود' : 'Link existing doctor / TA'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
              <Icon name="plus" size={16} /> {ar ? 'إضافة دكتور / معيد' : 'Add Doctor / TA'}
            </button>
          </div>
        </header>

        {actionError && <Alert>{actionError}</Alert>}
        {notice && <Alert tone="ok">{notice}</Alert>}

        <div className="um-stats" style={{ '--n': STATUS_TABS.length }} data-scroll="">
          {STATUS_TABS.map((tb) => (
            <Stat key={tb.key || 'all'} icon={tb.icon} tone={tb.tone} value={countOf(tb.key)}
              label={tb[locale]} active={statusFilter === tb.key} onClick={() => setStatusFilter(tb.key)} />
          ))}
        </div>

        <section className="um-panel ru-filters">
          <SearchField value={search} onChange={setSearch} placeholder={t('Full Name')} />
        </section>

        {loading ? <Skeletons n={4} h={84} /> : error ? <Alert>{error}</Alert> : shown.length === 0 ? (
          <Empty icon="users" title={t('No academic staff added yet.')}
            text={search || statusFilter ? (ar ? 'جرّب تغيير البحث أو الفلاتر.' : 'Try changing the search or filters.') : undefined}>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> {ar ? 'إضافة دكتور / معيد' : 'Add Doctor / TA'}</button>
          </Empty>
        ) : (
          <section className="um-panel um-panel--flush">
            <div className="ru-head">
              <span />
              <span className="um-count">{ar ? `${shown.length} من ${total}` : `${shown.length} of ${total}`}</span>
            </div>
            <div className="um-rows">
              {shown.map((s) => {
                const meta = STATUS_META[s.status] || STATUS_META.active;
                const inviteMeta = s.effective_invitation_status && INVITE_META[s.effective_invitation_status];
                const busy = busyId === s.id;
                const name = personName(s, locale);
                const rankName = locale === 'ar' ? (s.rank_name_ar || s.rank_name_en) : (s.rank_name_en || s.rank_name_ar);
                const departmentName = locale === 'ar' ? (s.department_name_ar || s.department_name_en) : (s.department_name_en || s.department_name_ar);
                return (
                  <div key={s.id} className="um-row ru-row">
                    <Mono name={name} hue={hueOf(s.id)} size="sm" />
                    <div className="um-row__main">
                      <h3 className="um-row__name">{name}</h3>
                      <p className="um-row__sub"><span>{s.email}</span></p>
                      <div className="ru-chips">
                        <span className="ru-chip"><Icon name="award" size={12} />{rankName || t('— Select rank —')}</span>
                        <span className="ru-chip"><Icon name="layers" size={12} />{departmentName || t('— No department —')}</span>
                      </div>
                    </div>
                    <div className="ru-status">
                      <Pill tone={STATUS_TONE[s.status] || 'success'}>{meta[locale]}</Pill>
                      {inviteMeta && <Pill tone={INVITE_TONE[s.effective_invitation_status]}>{inviteMeta[locale]}</Pill>}
                    </div>
                    <div className="ru-acts">
                      <button type="button" className="ru-ico" title={t('Manage')} aria-label={t('Manage')} onClick={() => setEditing(s)}><Icon name="edit" size={16} /></button>
                      {s.invited_at && <button type="button" className="ru-ico" title={ar ? 'كلمة السر' : 'Password'} aria-label={ar ? 'كلمة السر' : 'Password'} onClick={() => setPasswordFor(s)}><Icon name="key" size={16} /></button>}
                      {s.invited_at && inviteMeta && s.effective_invitation_status !== 'accepted' && (
                        <button type="button" className="ru-ico" disabled={busy} title={t('Resend')} aria-label={t('Resend')} onClick={() => handleResend(s)}><Icon name="mail" size={16} /></button>
                      )}
                      {s.status === 'active' ? (
                        <button type="button" className="ru-ico ru-ico--warn" disabled={busy} title={t('Deactivate')} aria-label={t('Deactivate')} onClick={() => handleToggleStatus(s)}><Icon name="x" size={16} /></button>
                      ) : (
                        <button type="button" className="ru-ico ru-ico--ok" disabled={busy} title={t('Activate')} aria-label={t('Activate')} onClick={() => handleToggleStatus(s)}><Icon name="check" size={16} /></button>
                      )}
                      <button type="button" className="ru-ico ru-ico--danger" disabled={busy} title={t('Remove')} aria-label={t('Remove')} onClick={() => handleDelete(s)}><Icon name="trash" size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {inviting && (
        <InviteStaffModal departments={departments} onClose={() => setInviting(false)} onDone={(err) => { setInviting(false); if (err) setActionError(err); else load(); }} />
      )}

      {editing && (
        <EditStaffModal staff={editing} departments={departments} onClose={() => setEditing(null)} onDone={(err) => { setEditing(null); if (err) setActionError(err); else load(); }} />
      )}

      {linking && (
        <LinkExistingModal
          type="academic_staff" isFaculty
          onClose={() => setLinking(false)}
          onDone={(msg) => { setLinking(false); setNotice(msg); load(); }}
        />
      )}

      {passwordFor && (
        <PasswordModal staff={passwordFor} onClose={() => setPasswordFor(null)} onDone={(err) => { setPasswordFor(null); if (err) setActionError(err); }} />
      )}

      {importing && (
        <ImportStaffModal onClose={() => setImporting(false)} onDone={(err) => { setImporting(false); if (err) setActionError(err); else load(); }} />
      )}
    </>
  );
}

/**
 * زر المفتاح في كل صف — بيفتح على "reveal" أوتوماتيك (GET .../password،
 * راجع AcademicStaffApiController::revealPassword() — بيتسجل audit log
 * لكل reveal)، وبيسمح كمان بتحديد كلمة مرور مخصصة بدل العشوائية
 * (PATCH .../password -> AcademicStaffManagementService::setPassword()).
 */
export function PasswordModal({ staff, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(null);
  const [customPassword, setCustomPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/v1/academic-staff/${staff.id}/password`)
      .then((json) => { if (!cancelled) setRevealed(json.data?.password ?? null); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [staff.id]);

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — ignore */ }
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const json = await api.patch(`/api/v1/academic-staff/${staff.id}/password`, {
        password: customPassword.trim() || null,
      });
      setRevealed(json.data?.password ?? customPassword.trim());
      setCustomPassword('');
      setVisible(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Password: ')}{staff.full_name}</h2>

        <div className="form-group">
          <label className="form-label">{t('Current Password')}</label>
          {loading ? (
            <p className="text-small">{locale === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>
          ) : revealed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input className="form-input" style={{ fontFamily: 'monospace' }} readOnly
                type={visible ? 'text' : 'password'} value={revealed} />
              <button type="button" className="btn btn-outline btn-sm" title={visible ? t('Hide') : t('Show')}
                onClick={() => setVisible((v) => !v)}>
                <Icon name={visible ? 'eye-off' : 'eye'} size={14} />
              </button>
              <button type="button" className="btn btn-outline btn-sm" title={t('Copy')} onClick={handleCopy}>
                <Icon name="copy" size={14} />
              </button>
              {copied && <span className="text-caption">{t('Copied')}</span>}
            </div>
          ) : (
            <p className="text-small">{t('No password set yet.')}</p>
          )}
        </div>

        <form onSubmit={handleSetPassword}>
          <div className="form-group">
            <label className="form-label">{t('Set a new password (optional)')}</label>
            <input className="form-input" type="text" placeholder={t('Leave blank to generate a random password')}
              value={customPassword} onChange={(e) => setCustomPassword(e.target.value)} minLength={8} />
            <p className="text-caption">{t('At least 8 characters. Leave blank to generate one automatically.')}</p>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={() => onDone(null)}>{locale === 'ar' ? 'إغلاق' : 'Close'}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Update Password')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * استيراد بالجملة عبر CSV/XLSX — POST /api/v1/academic-staff/import
 * (multipart، AcademicStaffApiController::import() -> App\Support\
 * TabularFileReader -> AcademicStaffManagementService::importRows()، كل
 * صف بيعدي على نفس invite() ونفس قواعد الملكية). أعمدة الملف المتوقعة:
 * full_name, email, department (اسم أو id), rank (اسم أو id),
 * staff_number, bio, password (اختياري لكل صف).
 */
export function ImportStaffModal({ onClose, onDone, faculties = null }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [facultyId, setFacultyId] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (facultyId) formData.append('faculty_id', facultyId);
      const json = await api.postForm('/api/v1/academic-staff/import', formData);
      setSummary(json.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Import Academic Staff')}</h2>

        {!summary ? (
          <form onSubmit={handleSubmit}>
            {faculties && (
              <div className="form-group">
                <label className="form-label">{t('Faculty')}</label>
                <select className="form-input" value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
                  <option value="">{locale === 'ar' ? '— اختر الكلية (لقراءة أسماء الأقسام) —' : '— Select faculty (to resolve department names) —'}</option>
                  {faculties.map((f) => <option key={f.id} value={f.id}>{locale === 'ar' ? f.name_ar : f.name_en}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{t('CSV or Excel file')}</label>
              <input className="form-input" type="file" accept=".csv,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)} required />
              <p className="text-caption">{t('Columns: full_name, email, department, rank, staff_number, bio, password (optional).')}</p>
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{locale === 'ar' ? 'إلغاء' : 'Cancel'}</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !file}>
                {saving ? (locale === 'ar' ? 'جارٍ الاستيراد…' : 'Importing…') : t('Import')}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="text-small">
              {locale === 'ar'
                ? `تم استيراد ${summary.success_count} من ${summary.total}.`
                : `Imported ${summary.success_count} of ${summary.total}.`}
            </p>
            <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 'var(--space-2)' }}>
              {(summary.results || []).filter((r) => !r.success).map((r) => (
                <p key={r.row} className="form-error" style={{ margin: 0 }}>
                  {locale === 'ar' ? `صف ${r.row}` : `Row ${r.row}`} ({r.email || '—'}): {r.message}
                </p>
              ))}
            </div>
            <div className="modal-box__actions">
              <button type="button" className="btn btn-primary" onClick={() => onDone(null)}>{locale === 'ar' ? 'تم' : 'Done'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteStaffModal({ departments, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [ranks, reloadRanks] = useRanks();
  const [names, setNames] = useState({ name_ar: '', name_en: '' });
  const [email, setEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [rankId, setRankId] = useState('');
  const [staffNumber, setStaffNumber] = useState('');
  const [bio, setBio] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sentPassword, setSentPassword] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    { const nameErr = checkNames(names.name_ar, names.name_en, locale); if (nameErr) { setError(nameErr); return; } }
    setSaving(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/academic-staff', {
        name_ar: names.name_ar, name_en: names.name_en,
        email,
        department_id: departmentId || null,
        academic_rank_id: rankId || null,
        staff_number: staffNumber || null,
        bio: bio || null,
        password: password.trim() || null,
      });
      setSentPassword(json.data?.password ?? null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (sentPassword !== null) {
    return (
      <CredentialsModal
        title={locale === 'ar' ? 'تمت الإضافة' : 'Staff member added'}
        email={email}
        password={sentPassword}
        message={locale === 'ar' ? 'تم إنشاء الحساب. سلّم بيانات الدخول لصاحبها.' : 'The account was created. Hand the login details to the staff member.'}
        onClose={() => onDone(null)}
      />
    );
  }

  return (
    <FormModal
      icon="users"
      title={t('Invite Academic Staff')}
      subtitle={locale === 'ar' ? 'أنشئ حساب دكتور أو معيد وسلّمه بيانات الدخول.' : 'Create a doctor / TA account and hand over the login details.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitDisabled={password !== '' && password.length < 8}
      submitLabel={t('Invite Staff')}
    >
      <FormSection title={locale === 'ar' ? 'البيانات الشخصية' : 'Personal details'}>
        <FieldGrid>
          <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} Field={Field} />
          <Field label={t('Email')} required>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={t('Bio (optional)')} wide>
            <textarea className="form-input" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>
        </FieldGrid>
      </FormSection>

      <FormSection title={locale === 'ar' ? 'الوظيفة والقسم' : 'Position'}>
        <FieldGrid>
          <Field label={t('Department')} wide>
            <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t('— No department —')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{locale === 'ar' ? d.name_ar : d.name_en}</option>)}
            </select>
          </Field>
          <Field label={t('Academic Rank')}>
            <select className="form-input" value={rankId} onChange={(e) => setRankId(e.target.value)}>
              <option value="">{t('— Select rank —')}</option>
              {ranks.map((r) => <option key={r.id} value={r.id}>{locale === 'ar' ? r.name_ar : r.name_en}</option>)}
            </select>
            <AddRankPanel onCreated={(rank) => { reloadRanks(); if (rank?.id) setRankId(String(rank.id)); }} />
          </Field>
          <Field label={t('Staff Number')}>
            <input className="form-input" value={staffNumber} onChange={(e) => setStaffNumber(e.target.value)} />
          </Field>
        </FieldGrid>
      </FormSection>

      <FormSection title={locale === 'ar' ? 'بيانات الدخول' : 'Login access'} hint={locale === 'ar' ? 'اختر كيف تُنشأ كلمة السر.' : 'Choose how the password is created.'}>
        <LoginAccess password={password} onPassword={setPassword} />
      </FormSection>
    </FormModal>
  );
}

function EditStaffModal({ staff, departments, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [ranks, reloadRanks] = useRanks();
  const [departmentId, setDepartmentId] = useState(staff.department_id ?? '');
  const [rankId, setRankId] = useState(staff.academic_rank_id ?? '');
  const [bio, setBio] = useState(staff.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/academic-staff/${staff.id}`, {
        department_id: departmentId || null,
        academic_rank_id: rankId || null,
        bio: bio || null,
      });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Manage: ')}{staff.full_name}</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Department')}</label>
              <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">{t('— No department —')}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{locale === 'ar' ? d.name_ar : d.name_en}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Academic Rank')}</label>
              <select className="form-input" value={rankId} onChange={(e) => setRankId(e.target.value)}>
                <option value="">{t('— Select rank —')}</option>
                {ranks.map((r) => <option key={r.id} value={r.id}>{locale === 'ar' ? r.name_ar : r.name_en}</option>)}
              </select>
              <AddRankPanel onCreated={(rank) => { reloadRanks(); if (rank?.id) setRankId(String(rank.id)); }} />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">{t('Bio (optional)')}</label>
              <textarea className="form-input" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{locale === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
