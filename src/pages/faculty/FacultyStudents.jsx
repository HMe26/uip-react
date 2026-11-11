import { personName } from '../../utils/bilingualName';
import BilingualNameFields, { checkNames } from '../../components/common/BilingualNameFields';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import LinkExistingModal from '../../components/people/LinkExistingModal';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { CredentialsModal, ImportResult, PasswordInput, SetPasswordModal, downloadTemplate } from '../../components/people/credentials';
import { FormModal, FormSection, FieldGrid, Field, LoginAccess } from '../../components/people/formUi';
import { Alert, Empty, Mono, Pill, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/faculty/students';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/faculty/students.php's core roster management,
 * talking to the real JSON API (GET/PATCH/DELETE /api/v1/students —
 * StudentsApiController::resolveScope(), the same StudentManagementService
 * the University page uses, scoped to this faculty automatically). Same
 * shape as UniversityStudents.jsx with the difference the PHP view itself
 * calls out: no faculty picker (fixed to the caller's own faculty), and
 * the Faculty/Department columns collapse into one Department
 * placement, sourced from the new GET /api/v1/faculty/my/tree endpoint
 * (a Faculty login can't call GET /api/v1/faculty/{id} the way University
 * does — that route is University-role only). Also has CSV bulk-import
 * (POST /api/v1/bulk/students/import, faculty scoped — the `group` CSV
 * column is ignored for this role, matching the Blade page's copy) and
 * Groups/Teams: index/create only, same restriction GroupsApiController
 * enforces (a group is university-wide — rename/dissolve/members stay
 * University-only, so this page doesn't offer them, matching
 * app/Views/faculty/students.php).
 */

const PER_PAGE = 20;
const STATUS_META = {
  active: { cls: 'badge-success', en: 'Active', ar: 'نشط' },
  pending: { cls: 'badge-primary', en: 'Pending', ar: 'قيد التفعيل' },
  inactive: { cls: 'badge-neutral', en: 'Inactive', ar: 'غير نشط' },
  suspended: { cls: 'badge-danger', en: 'Suspended', ar: 'موقوف' },
  banned: { cls: 'badge-danger', en: 'Banned', ar: 'محظور' },
};
const STATUS_TONE = { active: 'success', pending: 'primary', inactive: 'muted', suspended: 'danger', banned: 'danger' };
const INVITE_TONE = { pending: 'primary', accepted: 'success', expired: 'danger' };
const INVITE_META = {
  pending: { cls: 'badge-primary', en: 'Invite Pending', ar: 'دعوة قيد الانتظار' },
  accepted: { cls: 'badge-success', en: 'Accepted', ar: 'مقبولة' },
  expired: { cls: 'badge-danger', en: 'Invite Expired', ar: 'دعوة منتهية' },
};

function useOwnTree() {
  const [departments, setDepartments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    api.get('/api/v1/faculty/my/tree')
      .then((json) => {
        setDepartments(json.data?.departments || []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { departments, loaded, reload };
}

export default function FacultyStudents() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const { departments, reload: reloadTree } = useOwnTree();
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('full_name');
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [linking, setLinking] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [addingDept, setAddingDept] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [groups, setGroups] = useState([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [importEmail, setImportEmail] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/students', {
      search: search || undefined,
      department: departmentFilter || undefined, // department_id — see StudentsApiController::index()
      status: statusFilter || undefined,
      group_id: groupFilter || undefined,
      sort, order, page, per_page: PER_PAGE,
    })
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? 0);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [search, departmentFilter, statusFilter, groupFilter, sort, order, page]);

  useEffect(() => { load(); }, [load]);

  const loadGroups = useCallback(() => {
    api.get('/api/v1/groups', { per_page: 200 })
      .then((json) => setGroups(json.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  async function handleImport(file) {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('csv_file', file);
      if (importEmail) fd.append('send_email', '1');
      const json = await api.postForm('/api/v1/bulk/students/import', fd);
      setImportResult(json.data);
      load();
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleToggleStatus(s) {
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.patch(`/api/v1/students/${s.id}`, { account_status: s.account_status === 'active' ? 'inactive' : 'active' });
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
      await api.post(`/api/v1/students/${s.id}/resend`, {});
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s) {
    if (!window.confirm(locale === 'ar' ? 'إزالة هذا الطالب من الكلية؟' : 'Remove this student from your faculty?')) return;
    setBusyId(s.id);
    setActionError(null);
    try {
      await api.delete(`/api/v1/students/${s.id}`);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const ar = locale === 'ar';
  const STATUS_TABS = [
    { key: '', icon: 'users', tone: 'primary', en: 'All', ar: 'الكل' },
    { key: 'active', icon: 'check-circle', tone: 'success', en: 'Active', ar: 'نشط' },
    { key: 'inactive', icon: 'clock', tone: 'muted', en: 'Inactive', ar: 'غير نشط' },
    { key: 'suspended', icon: 'x-circle', tone: 'danger', en: 'Suspended', ar: 'موقوف' },
  ];
  const templateArgs = [
    ['name_ar', 'name_en', 'email', 'student_number', 'faculty', 'department', 'academic_year', 'current_semester', 'group', 'password'],
    ['هيثم محمد كامل', 'Haitham Mohamed Kamel', 'haitham@example.com', '2024001', '', '', '1', '1', '', ''],
  ];

  return (
    <>
      <div className="um-page animate-rise-in">
        <header className="um-head">
          <div className="um-head__text">
            <h1>{t('Students')}</h1>
            <p>{ar ? `${total} طالب في الكلية — إدارة الحسابات والمجموعات والاستيراد.` : `${total} ${total === 1 ? 'student' : 'students'} in your faculty — manage accounts, groups and bulk import.`}</p>
          </div>
          <div className="um-head__act">
            <button type="button" className="btn btn-outline" onClick={() => document.getElementById('students-import')?.scrollIntoView({ behavior: 'smooth' })}>
              <Icon name="upload" size={16} /> {ar ? 'استيراد' : 'Import'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setLinking(true)}>
              <Icon name="link" size={16} /> {ar ? 'ربط طالب موجود' : 'Link existing student'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setAddingDept(true)}>
              <Icon name="plus" size={16} /> {t('Add a new department')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}>
              <Icon name="plus" size={16} /> {t('Add Student')}
            </button>
          </div>
        </header>

        {actionError && <Alert>{actionError}</Alert>}
        {notice && <Alert tone="ok">{notice}</Alert>}

        <div className="um-stats" style={{ '--n': STATUS_TABS.length }} data-scroll="">
          {STATUS_TABS.map((tb) => (
            <Stat key={tb.key || 'all'} icon={tb.icon} tone={tb.tone} value={tb.key === '' ? total : '—'}
              label={tb[locale]} active={statusFilter === tb.key}
              onClick={() => { setPage(1); setStatusFilter(tb.key); }} />
          ))}
        </div>

        <section className="um-panel ru-filters">
          <SearchField value={search} onChange={(v) => { setPage(1); setSearch(v); }} placeholder={t('Name, student ID, or email')} />
          <select className="form-input" aria-label={t('Department')} value={departmentFilter} onChange={(e) => { setPage(1); setDepartmentFilter(e.target.value); }}>
            <option value="">{ar ? 'كل الأقسام' : 'All Departments'}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{ar ? d.name_ar : d.name_en}</option>)}
          </select>
          <select className="form-input" aria-label={t('Group/Team')} value={groupFilter} onChange={(e) => { setPage(1); setGroupFilter(e.target.value); }}>
            <option value="">{ar ? 'كل المجموعات' : 'All Groups'}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className="form-input" aria-label={ar ? 'الترتيب' : 'Sort'} value={`${sort}:${order}`} onChange={(e) => { const [so, o] = e.target.value.split(':'); setSort(so); setOrder(o); }}>
            <option value="full_name:asc">{t('Full Name')} A→Z</option>
            <option value="full_name:desc">{t('Full Name')} Z→A</option>
            <option value="created_at:desc">{ar ? 'الأحدث' : 'Newest'}</option>
            <option value="academic_year:asc">{t('Academic Year')} ↑</option>
            <option value="projects_count:desc">{ar ? 'أكثر المشاريع' : 'Most Projects'}</option>
          </select>
        </section>

        {loading ? <Skeletons n={5} h={84} /> : error ? <Alert>{error}</Alert> : rows.length === 0 ? (
          <Empty icon="users" title={t('No matching students yet.')}
            text={search || departmentFilter || statusFilter || groupFilter ? (ar ? 'جرّب تغيير البحث أو الفلاتر.' : 'Try changing the search or filters.') : undefined}>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> {t('Add Student')}</button>
          </Empty>
        ) : (
          <section className="um-panel um-panel--flush">
            <div className="ru-head">
              <span />
              <span className="um-count">{ar ? `${rows.length} من ${total}` : `${rows.length} of ${total}`}</span>
            </div>
            <div className="um-rows">
              {rows.map((s) => {
                const meta = STATUS_META[s.account_status] || STATUS_META.active;
                const inviteMeta = s.invitation_status && s.invitation_status !== 'n/a' ? INVITE_META[s.invitation_status] : null;
                const busy = busyId === s.id;
                const name = personName(s, locale);
                return (
                  <div key={s.id} className="um-row ru-row">
                    <Mono name={name} hue={hueOf(s.id)} size="sm" />
                    <div className="um-row__main">
                      <h3 className="um-row__name">{name}</h3>
                      <p className="um-row__sub"><span>{s.email}</span></p>
                      <div className="ru-chips">
                        {s.student_number && <span className="ru-chip ru-chip--mono"><Icon name="user" size={12} />{s.student_number}</span>}
                        {s.department && <span className="ru-chip"><Icon name="layers" size={12} />{s.department}</span>}
                        <span className="ru-chip"><Icon name="users" size={12} />{s.group_name || t('No group')}</span>
                        {s.academic_year != null && <span className="ru-chip"><Icon name="calendar" size={12} />{t('Academic Year')} {s.academic_year}</span>}
                      </div>
                    </div>
                    <div className="ru-status">
                      <Pill tone={STATUS_TONE[s.account_status] || 'success'}>{meta[locale]}</Pill>
                      {inviteMeta && <Pill tone={INVITE_TONE[s.invitation_status]}>{inviteMeta[locale]}</Pill>}
                    </div>
                    <div className="ru-acts">
                      <Link to={`/faculty/graduation/${s.id}/review`} className="ru-ico" title={t('Graduation Review')} aria-label={t('Graduation Review')}><Icon name="award" size={16} /></Link>
                      <button type="button" className="ru-ico" title={t('Edit')} aria-label={t('Edit')} onClick={() => setEditing(s)}><Icon name="edit" size={16} /></button>
                      {s.can_manage_password && <button type="button" className="ru-ico" title={ar ? 'كلمة السر' : 'Password'} aria-label={ar ? 'كلمة السر' : 'Password'} onClick={() => setPasswordFor(s)}><Icon name="key" size={16} /></button>}
                      {inviteMeta && s.invitation_status !== 'accepted' && (
                        <button type="button" className="ru-ico" disabled={busy} title={t('Resend')} aria-label={t('Resend')} onClick={() => handleResend(s)}><Icon name="mail" size={16} /></button>
                      )}
                      {s.account_status === 'active' ? (
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

        {totalPages > 1 && (
          <nav className="ru-pager" aria-label="Pagination">
            <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={ar ? 'السابق' : 'Previous'}><Icon name={ar ? 'chevron-right' : 'chevron-left'} size={16} /></button>
            <span>{page} / {totalPages}</span>
            <button type="button" className="btn btn-outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={ar ? 'التالي' : 'Next'}><Icon name={ar ? 'chevron-left' : 'chevron-right'} size={16} /></button>
          </nav>
        )}

        <div className="um-layout ru-lower">
          <section id="students-import" className="um-panel">
            <div className="um-panel__head">
              <div>
                <h2>{t('Import from CSV')}</h2>
                <p className="um-panel__sub">
                  {ar
                    ? 'ترتيب الأعمدة: name_ar, name_en, email, student_number, faculty, department, academic_year, current_semester, group — كل الطلاب سيُضافون مباشرةً إلى كليتك بغض النظر عن عمود faculty، والقسم لازم يطابق اسم قسم موجود فعلًا في كليتك (عربي أو إنجليزي)، وإلا سيتم تخطي السطر. عمود group (اسم مجموعة موجودة) و password (اختياري) مدعومان.'
                    : 'Column order: name_ar, name_en, email, student_number, faculty, department, academic_year, current_semester, group — every student is added directly to your faculty regardless of the faculty column, and department must match a department that already exists in your faculty (Arabic or English), or the row is skipped. The group (an existing group name) and password (optional) columns are supported.'}
                </p>
              </div>
            </div>
            <form className="um-form" onSubmit={(e) => { e.preventDefault(); const file = e.target.elements.csv_file.files[0]; handleImport(file); e.target.reset(); }}>
              <label className="ru-drop">
                <Icon name="upload" size={22} />
                <span>{ar ? 'اختر ملف CSV أو XLSX' : 'Choose a CSV or XLSX file'}</span>
                <input type="file" name="csv_file" accept=".csv,.xlsx,text/csv" required />
              </label>
              <label className="ru-check">
                <input type="checkbox" checked={importEmail} onChange={(e) => setImportEmail(e.target.checked)} />
                <span>{ar ? 'إرسال بيانات الدخول بالبريد' : 'Email login details'}</span>
              </label>
              <div className="um-form__foot">
                <button type="submit" className="btn btn-primary" disabled={importing}>
                  <Icon name="upload" size={16} /> {importing ? (ar ? 'جارٍ الاستيراد…' : 'Importing…') : t('Import')}
                </button>
                <ActionPreviewButton className="btn btn-outline" iconSize={16} label title="students-template.csv" run={() => downloadTemplate('students-template.csv', ...templateArgs)} />
                <button type="button" className="btn btn-outline" onClick={() => downloadTemplate('students-template.csv', ...templateArgs)}>
                  <Icon name="download" size={16} /> {ar ? 'تنزيل نموذج الملف' : 'Download template'}
                </button>
              </div>
            </form>
            {importError && <div style={{ marginTop: 14 }}><Alert>{importError}</Alert></div>}
            {importResult && <ImportResult result={importResult} />}
          </section>

          <section className="um-panel">
            <div className="um-panel__head">
              <h2>{t('Group/Team')}</h2>
              <button type="button" className="btn btn-outline" onClick={() => setCreatingGroup(true)}>
                <Icon name="plus" size={16} /> {t('Create a new group')}
              </button>
            </div>
            {groupError && <Alert>{groupError}</Alert>}
            {groups.length === 0 ? (
              <p className="um-panel__sub">{ar ? 'لا توجد مجموعات بعد.' : 'No groups yet.'}</p>
            ) : (
              <div className="ru-groups">
                {groups.map((g) => {
                  const pct = g.max_members ? Math.min(100, Math.round((g.members_count / g.max_members) * 100)) : 0;
                  return (
                    <div key={g.id} className="ru-group">
                      <Mono name={g.name} hue={hueOf(g.id)} size="sm" />
                      <div className="ru-group__text">
                        <strong>{g.name}</strong>
                        <small>{g.members_count} {t('members')}{g.max_members ? ` / ${g.max_members}` : ''}</small>
                        {g.max_members ? <div className="um-bar-track" style={{ margin: '6px 0 0', height: 5 }}><span style={{ width: `${pct}%` }} /></div> : null}
                        {g.description && <small>{g.description}</small>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="um-panel__sub" style={{ marginTop: 12 }}>
              {ar
                ? 'مشتركة مع الجامعة بالكامل — تعديل الاسم أو حذف المجموعة أو إدارة الأعضاء متاحة فقط من بوابة الجامعة.'
                : 'Shared with the whole university — renaming, dissolving, or managing members is only available from the University portal.'}
            </p>
          </section>
        </div>
      </div>

      {editing && (
        <EditStudentModal
          student={editing}
          departments={departments}
          onClose={() => setEditing(null)}
          onDone={(err) => { setEditing(null); if (err) setActionError(err); else load(); }}
        />
      )}

      {inviting && (
        <InviteStudentModal
          departments={departments}
          groups={groups}
          onClose={() => setInviting(false)}
          onDone={(err) => { setInviting(false); if (err) setActionError(err); else load(); }}
        />
      )}

      {addingDept && (
        <AddDepartmentModal
          onClose={() => setAddingDept(false)}
          onDone={(err) => { setAddingDept(false); if (err) setActionError(err); else reloadTree(); }}
        />
      )}

      {linking && (
        <LinkExistingModal
          type="student" isFaculty
          onClose={() => setLinking(false)}
          onDone={(msg) => { setLinking(false); setNotice(msg); load(); }}
        />
      )}

      {passwordFor && (
        <SetPasswordModal
          title={`${locale === 'ar' ? 'كلمة السر: ' : 'Password: '}${passwordFor.full_name}`}
          endpoint={`/api/v1/students/${passwordFor.id}/password`}
          onClose={() => setPasswordFor(null)}
        />
      )}

      {creatingGroup && (
        <CreateGroupModal
          onClose={() => setCreatingGroup(false)}
          onDone={(err) => { setCreatingGroup(false); if (err) setGroupError(err); else loadGroups(); }}
        />
      )}
    </>
  );
}

function InviteStudentModal({ departments, groups, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [names, setNames] = useState({ name_ar: '', name_en: '' });
  const [email, setEmail] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [currentSemester, setCurrentSemester] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [studyStartDate, setStudyStartDate] = useState('');
  const [password, setPassword] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);


  async function handleSubmit(e) {
    e.preventDefault();
    { const nameErr = checkNames(names.name_ar, names.name_en, locale); if (nameErr) { setError(nameErr); return; } }
    setSaving(true);
    setError(null);
    try {
      const json = await api.post('/api/v1/students', {
        name_ar: names.name_ar, name_en: names.name_en,
        email,
        student_number: studentNumber || null,
        academic_year: academicYear || null,
        current_semester: currentSemester || null,
        department_id: departmentId || null,
        group_id: groupId || null,
        study_start_date: studyStartDate || null,
        password: password.trim() || null,
        send_email: sendEmail,
        locale,
      });
      setCreated({ ...json.data, message: json.message });
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (created) {
    return (
      <CredentialsModal
        title={locale === 'ar' ? 'تمت إضافة الطالب' : 'Student added'}
        email={email}
        password={created.password}
        message={created.message}
        onClose={() => onDone(null)}
      />
    );
  }

  return (
    <FormModal
      icon="users"
      title={t('Add Student')}
      subtitle={locale === 'ar' ? 'أنشئ حساب طالب وسلّمه بيانات الدخول.' : 'Create a student account and hand over the login details.'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitDisabled={password !== '' && password.length < 8}
      submitLabel={t('Add Student')}
    >
      <FormSection title={locale === 'ar' ? 'بيانات الطالب' : 'Student details'}>
        <FieldGrid>
          <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} Field={Field} />
          <Field label={locale === 'ar' ? 'البريد الإلكتروني' : 'Email'} required>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={190} />
          </Field>
          <Field label={t('Student ID')}>
            <input className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
          </Field>
          <Field label={locale === 'ar' ? 'تاريخ بدء الدراسة (اختياري)' : 'Study start date (optional)'}>
            <input className="form-input" type="date" value={studyStartDate} onChange={(e) => setStudyStartDate(e.target.value)} />
          </Field>
          <Field label={t('Academic Year')} hint={locale === 'ar' ? 'من 1 إلى 8' : '1 to 8'}>
            <input className="form-input" type="number" min="1" max="8" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
          </Field>
          <Field label={t('Current semester')} hint={locale === 'ar' ? '1 أو 2' : '1 or 2'}>
            <input className="form-input" type="number" min="1" max="2" value={currentSemester} onChange={(e) => setCurrentSemester(e.target.value)} />
          </Field>
        </FieldGrid>
      </FormSection>

          <FormSection title={locale === 'ar' ? 'المؤسسة' : 'Placement'} hint={locale === 'ar' ? 'القسم والمجموعة التي ينتمي لها الطالب.' : 'Where the student belongs.'}>
            <FieldGrid>
              <Field label={t('Department')}>
                <select className="form-input" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); }}>
                  <option value="">{locale === 'ar' ? '— القسم —' : '— Department —'}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{locale === 'ar' ? d.name_ar : d.name_en}</option>)}
                </select>
              </Field>
              <Field label={t('Group/Team')} wide>
                <select className="form-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">{t('No group')}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
            </FieldGrid>
          </FormSection>

      <FormSection title={locale === 'ar' ? 'بيانات الدخول' : 'Login access'} hint={locale === 'ar' ? 'اختر كيف تُنشأ كلمة السر.' : 'Choose how the password is created.'}>
        <LoginAccess password={password} onPassword={setPassword} sendEmail={sendEmail} onSendEmail={setSendEmail} who={locale === 'ar' ? 'الطالب' : 'the student'} />
      </FormSection>
    </FormModal>
  );
}

function EditStudentModal({ student, departments, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [names, setNames] = useState({ name_ar: student.name_ar || student.full_name || '', name_en: student.name_en || student.full_name || '' });
  const [studentNumber, setStudentNumber] = useState(student.student_number || '');
  const [academicYear, setAcademicYear] = useState(student.academic_year ?? '');
  const [currentSemester, setCurrentSemester] = useState(student.current_semester ?? '');
  const [departmentId, setDepartmentId] = useState(student.department_id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);


  async function handleSubmit(e) {
    e.preventDefault();
    { const nameErr = checkNames(names.name_ar, names.name_en, locale); if (nameErr) { setError(nameErr); return; } }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/students/${student.id}`, {
        name_ar: names.name_ar, name_en: names.name_en,
        student_number: studentNumber,
        academic_year: academicYear || null,
        current_semester: currentSemester || null,
        department_id: departmentId || null,
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
        <h2 className="modal-box__title text-h3">{t('Edit Student')} — {student.full_name}</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} />
            <div className="form-group">
              <label className="form-label">{t('Student ID')}</label>
              <input className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Academic Year')}</label>
              <input className="form-input" type="number" min="1" max="8" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Current semester')}</label>
              <input className="form-input" type="number" min="1" max="2" value={currentSemester} onChange={(e) => setCurrentSemester(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Department')}</label>
              <select className="form-input" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); }}>
                <option value="">{locale === 'ar' ? '— القسم —' : '— Department —'}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{locale === 'ar' ? d.name_ar : d.name_en}</option>)}
              </select>
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

function AddDepartmentModal({ onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/faculty/departments', { name_en: nameEn, name_ar: nameAr, description: description || null });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Add a new department')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Department name (English)')}</label>
            <input className="form-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Department name (Arabic)')}</label>
            <input className="form-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description (optional)')}</label>
            <textarea className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{locale === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Create Department')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateGroupModal({ onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/groups', { name, description: description || null, max_members: maxMembers || null });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Create a new group')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Group name')}</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description (optional)')}</label>
            <textarea className="form-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">{locale === 'ar' ? 'الحد الأقصى للأعضاء (اتركه فارغًا لإلغاء الحد)' : 'Max members (leave blank for no cap)'}</label>
            <input className="form-input" type="number" min="0" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{locale === 'ar' ? 'إلغاء' : 'Cancel'}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? (locale === 'ar' ? 'جارٍ الحفظ…' : 'Saving…') : t('Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
