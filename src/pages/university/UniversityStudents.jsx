import { personName } from '../../utils/bilingualName';
import BilingualNameFields, { checkNames } from '../../components/common/BilingualNameFields';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import LinkExistingModal from '../../components/people/LinkExistingModal';
import { ActionPreviewButton } from '../../components/FilePreviewButton';
import { CredentialsModal, ImportResult, PasswordInput, SetPasswordModal, downloadTemplate } from '../../components/people/credentials';
import { LoginAccess } from '../../components/people/formUi';
import { Alert, Empty, Mono, Pill, SearchField, Skeletons, Stat, hueOf } from '../../components/university/umUi';
import { SfModal, SfSection, SfGrid, SfField, SfChoice, SfReadonly } from '../../components/university/studentFormUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/university/students';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/university/students.php's core roster management,
 * talking to the real JSON API (GET/PATCH/DELETE /api/v1/students —
 * App\Controllers\Api\StudentsApiController, the exact same
 * StudentManagementService the Blade page uses). Covers listing +
 * search/filter/sort/pagination, per-student edit (basic info, academic
 * details, faculty/department placement), activate/deactivate, resend
 * invite, and delete — plus the CSV bulk-import (POST
 * /api/v1/bulk/students/import — BulkApiController::studentsImport(),
 * same StudentManagementService::importCsv() the Blade form posts to)
 * and Groups/Teams management (GET/POST/PATCH/DELETE /api/v1/groups —
 * GroupsApiController, University role: full CRUD + members) that the
 * Blade page also has. Selecting rows and moving them into a group
 * mirrors the Blade "move-group-form" via POST
 * /api/v1/bulk/students/update (group_id).
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

export default function UniversityStudents() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [faculties, setFaculties] = useState([]);
  const [search, setSearch] = useState('');
  const [facultyFilter, setFacultyFilter] = useState('');
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
  const [groupFilter, setGroupFilter] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [moveGroupId, setMoveGroupId] = useState('');
  const [moving, setMoving] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [managingGroup, setManagingGroup] = useState(null);
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
      faculty: facultyFilter || undefined,
      status: statusFilter || undefined,
      group_id: groupFilter || undefined,
      sort, order, page, per_page: PER_PAGE,
    })
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? 0);
        setSelectedIds([]);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [search, facultyFilter, statusFilter, groupFilter, sort, order, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/api/v1/faculty', { per_page: 100 })
      .then((json) => setFaculties(json.data || []))
      .catch(() => {});
  }, []);

  const loadGroups = useCallback(() => {
    api.get('/api/v1/groups', { per_page: 200 })
      .then((json) => setGroups(json.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

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
    if (!window.confirm(locale === 'ar' ? 'حذف هذا الطالب؟' : 'Remove this student?')) return;
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

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.length === rows.length ? [] : rows.map((r) => r.id)));
  }

  async function handleMoveSelected() {
    if (selectedIds.length === 0) return;
    setMoving(true);
    setActionError(null);
    try {
      await api.post('/api/v1/bulk/students/update', { ids: selectedIds, group_id: moveGroupId || null });
      setMoveGroupId('');
      load();
      loadGroups();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setMoving(false);
    }
  }

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
      loadGroups();
    } catch (err) {
      setImportError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleDeleteGroup(g) {
    if (!window.confirm(locale === 'ar' ? 'حذف هذه المجموعة؟ لن يُحذف طلابها.' : 'Delete this group? Its students will not be deleted.')) return;
    setGroupError(null);
    try {
      await api.del(`/api/v1/groups/${g.id}`);
      loadGroups();
      load();
    } catch (err) {
      setGroupError(errorMessage(err));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const ar = locale === 'ar';
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
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
            <p>{ar ? `${total} طالب مسجّل في الجامعة — إدارة الحسابات والمجموعات والاستيراد.` : `${total} ${total === 1 ? 'student' : 'students'} enrolled — manage accounts, groups and bulk import.`}</p>
          </div>
          <div className="um-head__act">
            <button type="button" className="btn btn-outline" onClick={() => document.getElementById('students-import')?.scrollIntoView({ behavior: 'smooth' })}>
              <Icon name="upload" size={16} /> {ar ? 'استيراد' : 'Import'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setLinking(true)}>
              <Icon name="link" size={16} /> {ar ? 'ربط طالب موجود' : 'Link existing student'}
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
          <select className="form-input" aria-label={ar ? 'الكلية' : 'Faculty'} value={facultyFilter} onChange={(e) => { setPage(1); setFacultyFilter(e.target.value); }}>
            <option value="">{ar ? 'كل الكليات' : 'All Faculties'}</option>
            {faculties.map((f) => <option key={f.id} value={ar ? f.name_ar : f.name_en}>{ar ? f.name_ar : f.name_en}</option>)}
          </select>
          <select className="form-input" aria-label={t('Group')} value={groupFilter} onChange={(e) => { setPage(1); setGroupFilter(e.target.value); }}>
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

        {selectedIds.length > 0 && (
          <div className="ru-bulk" role="region" aria-label={ar ? 'إجراءات جماعية' : 'Bulk actions'}>
            <span className="ru-bulk__n"><Icon name="check-circle" size={16} /> {selectedIds.length} {ar ? 'محدد' : 'selected'}</span>
            <label htmlFor="ru-move">{t('Move checked students to')}</label>
            <select id="ru-move" className="form-input" value={moveGroupId} onChange={(e) => setMoveGroupId(e.target.value)}>
              <option value="">{t('No group')}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="button" className="btn btn-primary" disabled={moving} onClick={handleMoveSelected}>
              {moving ? (ar ? 'جارٍ النقل…' : 'Moving…') : t('Move')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSelectedIds([])}>{ar ? 'إلغاء التحديد' : 'Clear'}</button>
          </div>
        )}

        {loading ? <Skeletons n={5} h={84} /> : error ? <Alert>{error}</Alert> : rows.length === 0 ? (
          <Empty icon="users" title={t('No matching students yet.')}
            text={search || facultyFilter || statusFilter || groupFilter ? (ar ? 'جرّب تغيير البحث أو الفلاتر.' : 'Try changing the search or filters.') : undefined}>
            <button type="button" className="btn btn-primary" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> {t('Add Student')}</button>
          </Empty>
        ) : (
          <section className="um-panel um-panel--flush">
            <div className="ru-head">
              <label className="ru-check" title={t('Select to move')}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label={t('Select to move')} />
                <span>{ar ? 'تحديد الكل' : 'Select all'}</span>
              </label>
              <span className="um-count">{ar ? `${rows.length} من ${total}` : `${rows.length} of ${total}`}</span>
            </div>
            <div className="um-rows">
              {rows.map((s) => {
                const meta = STATUS_META[s.account_status] || STATUS_META.active;
                const inviteMeta = s.invitation_status && s.invitation_status !== 'n/a' ? INVITE_META[s.invitation_status] : null;
                const busy = busyId === s.id;
                const name = personName(s, locale);
                const checked = selectedIds.includes(s.id);
                return (
                  <div key={s.id} className={`um-row ru-row${checked ? ' is-selected' : ''}`}>
                    <input type="checkbox" className="ru-row__check" checked={checked} onChange={() => toggleSelected(s.id)} aria-label={`${t('Select to move')}: ${name}`} />
                    <Mono name={name} hue={hueOf(s.id)} size="sm" />
                    <div className="um-row__main">
                      <h3 className="um-row__name">{name}</h3>
                      <p className="um-row__sub"><span>{s.email}</span></p>
                      <div className="ru-chips">
                        {s.student_number && <span className="ru-chip ru-chip--mono"><Icon name="user" size={12} />{s.student_number}</span>}
                        {s.faculty && <span className="ru-chip"><Icon name="building" size={12} />{s.faculty}</span>}
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
                      <Link to={`/university/graduation/${s.id}/review`} className="ru-ico" title={t('Graduation Review')} aria-label={t('Graduation Review')}><Icon name="award" size={16} /></Link>
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
                <p className="um-panel__sub">{t('Column order: name_ar, name_en, email, student_number, faculty, department, academic_year, current_semester, group — faculty/department must exactly match the name (Arabic or English) of a faculty/department that already exists at your university, or the row is skipped.')}</p>
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
              <h2>{t('Groups/Teams')}</h2>
              <button type="button" className="btn btn-outline" onClick={() => setCreatingGroup(true)}>
                <Icon name="plus" size={16} /> {t('Create a new group')}
              </button>
            </div>
            {groupError && <Alert>{groupError}</Alert>}
            {groups.length === 0 ? (
              <p className="um-panel__sub">{t('No groups yet.')}</p>
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
                      <div className="ru-acts">
                        <button type="button" className="ru-ico" title={ar ? 'الأعضاء' : 'Members'} aria-label={ar ? 'الأعضاء' : 'Members'} onClick={() => setManagingGroup(g)}><Icon name="users" size={16} /></button>
                        <button type="button" className="ru-ico" title={t('Edit')} aria-label={t('Edit')} onClick={() => setEditingGroup(g)}><Icon name="edit" size={16} /></button>
                        <button type="button" className="ru-ico ru-ico--danger" title={t('Delete')} aria-label={t('Delete')} onClick={() => handleDeleteGroup(g)}><Icon name="trash" size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {editing && (
        <EditStudentModal
          student={editing}
          faculties={faculties}
          onClose={() => setEditing(null)}
          onDone={(err) => { setEditing(null); if (err) setActionError(err); else load(); }}
        />
      )}

      {inviting && (
        <InviteStudentModal
          faculties={faculties}
          groups={groups}
          onClose={() => setInviting(false)}
          onDone={(err) => { setInviting(false); if (err) setActionError(err); else { load(); loadGroups(); } }}
        />
      )}

      {linking && (
        <LinkExistingModal
          type="student"
          onClose={() => setLinking(false)}
          onDone={(msg) => { setLinking(false); setNotice(msg); load(); loadGroups(); }}
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

      {editingGroup && (
        <EditGroupModal
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onDone={(err) => { setEditingGroup(null); if (err) setGroupError(err); else loadGroups(); }}
        />
      )}

      {managingGroup && (
        <ManageGroupMembersModal
          group={managingGroup}
          onClose={() => setManagingGroup(null)}
          onChanged={() => { loadGroups(); load(); }}
        />
      )}
    </>
  );
}

function InviteStudentModal({ faculties, groups, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [names, setNames] = useState({ name_ar: '', name_en: '' });
  const [email, setEmail] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [currentSemester, setCurrentSemester] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [studyStartDate, setStudyStartDate] = useState('');
  const [password, setPassword] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!facultyId) { setDepartments([]); return; }
    let cancelled = false;
    api.get(`/api/v1/faculty/${facultyId}`)
      .then((json) => { if (!cancelled) setDepartments(json.data?.departments || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [facultyId]);

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
        faculty_id: facultyId || null,
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

  const ar = locale === 'ar';
  const facultyOptions = faculties.map((f) => <option key={f.id} value={f.id}>{ar ? f.name_ar : f.name_en}</option>);
  return (
    <SfModal
      mode="add"
      title={t('Add Student')}
      subtitle={ar ? 'أنشئ حساب طالب وسلّمه بيانات الدخول.' : 'Create a student account and hand over the login details.'}
      name={names.name_en || names.name_ar}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitDisabled={password !== '' && password.length < 8}
      submitLabel={t('Add Student')}
    >
      <SfSection icon="user" title={ar ? 'الهوية' : 'Identity'} hint={ar ? 'الاسم بالعربي والإنجليزي والبريد الإلكتروني.' : 'Name in both languages, and the email used to sign in.'}>
        <SfGrid>
          <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} Field={SfField} autoFocus />
          <SfField label={ar ? 'البريد الإلكتروني' : 'Email'} required wide>
            <input className="form-input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={190} placeholder="student@university.edu" style={{ textAlign: ar ? 'right' : 'left' }} />
          </SfField>
        </SfGrid>
      </SfSection>

      <SfSection icon="award" title={ar ? 'البيانات الأكاديمية' : 'Academic'} hint={ar ? 'كلها اختيارية ويمكن تعديلها لاحقًا.' : 'All optional — you can change them later.'}>
        <SfGrid>
          <SfField label={t('Student ID')}>
            <input className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
          </SfField>
          <SfField label={ar ? 'تاريخ بدء الدراسة' : 'Study start date'}>
            <input className="form-input" type="date" value={studyStartDate} onChange={(e) => setStudyStartDate(e.target.value)} />
          </SfField>
          <SfField label={t('Academic Year')} wide>
            <SfChoice label={t('Academic Year')} value={academicYear} onChange={setAcademicYear} options={[1, 2, 3, 4, 5, 6, 7, 8]} />
          </SfField>
          <SfField label={t('Current semester')} wide>
            <SfChoice label={t('Current semester')} value={currentSemester} onChange={setCurrentSemester} options={[1, 2]} />
          </SfField>
        </SfGrid>
      </SfSection>

      <SfSection icon="building" title={ar ? 'المؤسسة' : 'Placement'} hint={ar ? 'الكلية والقسم والمجموعة التي ينتمي لها الطالب.' : 'The faculty, department and group the student belongs to.'}>
        <SfGrid>
          <SfField label={t('Faculty')}>
            <select className="form-input" value={facultyId} onChange={(e) => { setFacultyId(e.target.value); setDepartmentId(''); }}>
              <option value="">{t('— No faculty —')}</option>
              {facultyOptions}
            </select>
          </SfField>
          <SfField label={t('Department')}>
            <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} disabled={!facultyId}>
              <option value="">{t('— No department —')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{ar ? d.name_ar : d.name_en}</option>)}
            </select>
          </SfField>
          <SfField label={t('Group')} wide>
            <select className="form-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{t('No group')}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </SfField>
        </SfGrid>
      </SfSection>

      <SfSection icon="key" title={ar ? 'بيانات الدخول' : 'Login access'} hint={ar ? 'اختر كيف تُنشأ كلمة السر.' : 'Choose how the password is created.'}>
        <LoginAccess password={password} onPassword={setPassword} sendEmail={sendEmail} onSendEmail={setSendEmail} who={ar ? 'الطالب' : 'the student'} />
      </SfSection>
    </SfModal>
  );
}

function EditStudentModal({ student, faculties, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [names, setNames] = useState({ name_ar: student.name_ar || student.full_name || '', name_en: student.name_en || student.full_name || '' });
  const [studentNumber, setStudentNumber] = useState(student.student_number || '');
  const [academicYear, setAcademicYear] = useState(student.academic_year ?? '');
  const [currentSemester, setCurrentSemester] = useState(student.current_semester ?? '');
  const [facultyId, setFacultyId] = useState(student.faculty_id ?? '');
  const [departmentId, setDepartmentId] = useState(student.department_id ?? '');
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!facultyId) { setDepartments([]); return; }
    let cancelled = false;
    api.get(`/api/v1/faculty/${facultyId}`)
      .then((json) => { if (!cancelled) setDepartments(json.data?.departments || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [facultyId]);

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
        faculty_id: facultyId || null,
        department_id: departmentId || null,
      });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const ar = locale === 'ar';
  return (
    <SfModal
      mode="edit"
      title={t('Edit Student')}
      subtitle={student.full_name}
      name={names.name_en || names.name_ar}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={t('Save')}
    >
      <SfSection icon="user" title={ar ? 'الهوية' : 'Identity'} hint={ar ? 'الاسم بالعربي والإنجليزي.' : 'The name in both languages.'}>
        <SfGrid>
          <BilingualNameFields nameAr={names.name_ar} nameEn={names.name_en} onChange={(p) => setNames((n) => ({ ...n, ...p }))} Field={SfField} />
          {student.email && (
            <SfField label={ar ? 'البريد الإلكتروني' : 'Email'} wide>
              <SfReadonly value={student.email} note={ar ? 'للقراءة فقط' : 'Read-only'} />
            </SfField>
          )}
        </SfGrid>
      </SfSection>

      <SfSection icon="award" title={ar ? 'البيانات الأكاديمية' : 'Academic'}>
        <SfGrid>
          <SfField label={t('Student ID')} wide>
            <input className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} />
          </SfField>
          <SfField label={t('Academic Year')} wide>
            <SfChoice label={t('Academic Year')} value={academicYear} onChange={setAcademicYear} options={[1, 2, 3, 4, 5, 6, 7, 8]} />
          </SfField>
          <SfField label={t('Current semester')} wide>
            <SfChoice label={t('Current semester')} value={currentSemester} onChange={setCurrentSemester} options={[1, 2]} />
          </SfField>
        </SfGrid>
      </SfSection>

      <SfSection icon="building" title={ar ? 'المؤسسة' : 'Placement'} hint={ar ? 'الكلية والقسم الذي ينتمي له الطالب.' : 'The faculty and department the student belongs to.'}>
        <SfGrid>
          <SfField label={t('Faculty')}>
            <select className="form-input" value={facultyId} onChange={(e) => { setFacultyId(e.target.value); setDepartmentId(''); }}>
              <option value="">{t('— No faculty —')}</option>
              {faculties.map((f) => <option key={f.id} value={f.id}>{ar ? f.name_ar : f.name_en}</option>)}
            </select>
          </SfField>
          <SfField label={t('Department')}>
            <select className="form-input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} disabled={!facultyId}>
              <option value="">{t('— No department —')}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{ar ? d.name_ar : d.name_en}</option>)}
            </select>
          </SfField>
        </SfGrid>
      </SfSection>
    </SfModal>
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
            <label className="form-label">{t('Max members (leave blank for no cap)')}</label>
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

function EditGroupModal({ group, onClose, onDone }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [name, setName] = useState(group.name || '');
  const [description, setDescription] = useState(group.description || '');
  const [maxMembers, setMaxMembers] = useState(group.max_members ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/v1/groups/${group.id}`, { name, description: description || null, max_members: maxMembers || null });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Edit')} — {group.name}</h2>
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
            <label className="form-label">{t('Max members (leave blank for no cap)')}</label>
            <input className="form-input" type="number" min="0" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} />
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

function ManageGroupMembersModal({ group, onClose, onChanged }) {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/api/v1/groups/${group.id}/members`)
      .then((json) => setMembers(json.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [group.id]);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(studentId) {
    setBusyId(studentId);
    setError(null);
    try {
      await api.del(`/api/v1/groups/${group.id}/members/${studentId}`);
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{group.name}</h2>
        {loading && <p className="text-small">{t('Loading…')}</p>}
        {error && <p className="form-error">{error}</p>}
        {!loading && members.length === 0 && (
          <p className="text-caption">{locale === 'ar' ? 'لا يوجد أعضاء في هذه المجموعة بعد.' : 'No members in this group yet.'}</p>
        )}
        {!loading && members.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {members.map((m) => (
              <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{m.full_name} <span className="text-caption">{m.email}</span></span>
                <button type="button" className="btn btn-outline btn-sm" disabled={busyId === m.id} onClick={() => handleRemove(m.id)}>
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-caption" style={{ marginTop: 'var(--space-4)' }}>
          {locale === 'ar' ? 'لإضافة طلاب لهذه المجموعة، حدّدهم من جدول الطلاب واستخدم "نقل الطلاب المحددين إلى".' : 'To add students to this group, select them from the students table and use "Move checked students to".'}
        </p>
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
