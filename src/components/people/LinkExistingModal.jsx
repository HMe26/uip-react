import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * "Link an existing account": the person already has a login on the platform (own email +
 * password). Step 1 looks the email up (GET /people/lookup), step 2 assigns them to a
 * faculty / department (+ group, rank, permissions) and links (POST /people/link/{type}).
 * The account keeps its own password — nothing is created or emailed.
 *
 * type: 'student' | 'academic_staff' | 'supervisor'. `isFaculty` locks the faculty to the
 * caller's own faculty (faculty portal) and loads its departments from /faculty/my/tree.
 */

const LINK_PATH = { student: 'student', academic_staff: 'academic-staff', supervisor: 'supervisor' };
const PERMISSIONS = [
  { key: 'view_students', en: 'View Assigned Students', ar: 'عرض الطلاب المُسندين' },
  { key: 'manage_projects', en: 'Review & Approve Projects', ar: 'مراجعة واعتماد المشاريع' },
  { key: 'manage_messages', en: 'Messages', ar: 'الرسائل' },
  { key: 'view_reports', en: 'Reports', ar: 'التقارير' },
];

const TITLES = {
  student: { ar: 'ربط طالب موجود على المنصة', en: 'Link an existing student' },
  academic_staff: { ar: 'ربط دكتور / معيد موجود على المنصة', en: 'Link an existing doctor / TA' },
  supervisor: { ar: 'ربط مشرف موجود على المنصة', en: 'Link an existing supervisor' },
};

const STATUS_TONE = { available: 'var(--color-success)', in_this_university: 'var(--color-warning, #b45309)', other_university: 'var(--color-danger)', ineligible: 'var(--color-danger)', not_found: 'var(--color-danger)' };

export default function LinkExistingModal({ type, isFaculty = false, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [email, setEmail] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // assignment data
  const [faculties, setFaculties] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [f, setF] = useState({ faculty_id: '', department_id: '', group_id: '', academic_year: '', current_semester: '', student_number: '', academic_rank_id: '', staff_number: '', bio: '', department: '', title: '' });
  const [perms, setPerms] = useState([]);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));

  useEffect(() => {
    if (isFaculty) {
      api.get('/api/v1/faculty/my/tree').then((j) => {
        setDepartments(j.data?.departments || []);
      }).catch(() => {});
    } else if (type !== 'supervisor') {
      api.get('/api/v1/faculty', { per_page: 100 }).then((j) => setFaculties(j.data || [])).catch(() => {});
    }
    if (type === 'student') api.get('/api/v1/groups', { per_page: 200 }).then((j) => setGroups(j.data || [])).catch(() => {});
    if (type === 'academic_staff') api.get('/api/v1/academic-staff/ranks').then((j) => setRanks(j.data || [])).catch(() => {});
  }, [type, isFaculty]);

  useEffect(() => {
    if (isFaculty || !f.faculty_id) { if (!isFaculty) setDepartments([]); return; }
    api.get(`/api/v1/faculty/${f.faculty_id}`).then((j) => setDepartments(j.data?.departments || [])).catch(() => {});
  }, [f.faculty_id, isFaculty]);

  async function handleFind(e) {
    e.preventDefault();
    setFinding(true);
    setError(null);
    setFound(null);
    try {
      const json = await api.get('/api/v1/people/lookup', { type, email: email.trim(), locale });
      setFound(json.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setFinding(false);
    }
  }

  async function handleLink(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const num = (v) => (v === '' ? null : v);
    const body = { email: found.user.email, locale };
    if (type === 'student') {
      Object.assign(body, {
        faculty_id: num(f.faculty_id), department_id: num(f.department_id), group_id: num(f.group_id),
        academic_year: num(f.academic_year), current_semester: num(f.current_semester), student_number: f.student_number || null,
      });
    } else if (type === 'academic_staff') {
      Object.assign(body, {
        faculty_id: num(f.faculty_id), department_id: num(f.department_id), academic_rank_id: num(f.academic_rank_id),
        staff_number: f.staff_number || null, bio: f.bio || null,
      });
    } else {
      Object.assign(body, { department: f.department || null, title: f.title || null, permissions: perms });
    }
    try {
      const json = await api.post(`/api/v1/people/link/${LINK_PATH[type]}`, body);
      onDone(json.message);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const canLink = found?.status === 'available';
  const name = (o) => (ar ? (o.name_ar || o.name_en) : (o.name_en || o.name_ar));
  const needFaculty = !isFaculty && type !== 'supervisor';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{ar ? TITLES[type].ar : TITLES[type].en}</h2>
        <p className="text-small" style={{ marginTop: 0 }}>
          {ar
            ? 'للأشخاص المسجّلين بالفعل على المنصة بإيميلهم. يحتفظ الحساب بكلمة سره الخاصة، ولا يُنشأ حساب جديد.'
            : 'For people who already have an account on the platform. The account keeps its own password — no new account is created.'}
        </p>

        <form onSubmit={handleFind} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <input className="form-input" type="email" required placeholder={ar ? 'البريد الإلكتروني للحساب' : 'Account email'} value={email}
              onChange={(e) => { setEmail(e.target.value); setFound(null); }} />
          </div>
          <button type="submit" className="btn btn-outline" disabled={finding || !email.trim()}>
            <Icon name="search" size={14} /> {finding ? '…' : (ar ? 'بحث' : 'Find')}
          </button>
        </form>

        {found && (
          <div className="card" style={{ padding: 'var(--space-3)', marginTop: 'var(--space-3)', borderInlineStart: `3px solid ${STATUS_TONE[found.status] || 'var(--border-subtle)'}` }}>
            {found.user && <p style={{ margin: 0 }}><strong>{found.user.full_name}</strong><br /><span className="text-caption">{found.user.email}</span></p>}
            <p className="text-small" style={{ margin: 'var(--space-2) 0 0', color: STATUS_TONE[found.status] }}>{found.message}</p>
          </div>
        )}

        {canLink && (
          <form onSubmit={handleLink} style={{ marginTop: 'var(--space-4)' }}>
            <div className="grid-2">
              {needFaculty && (
                <div className="form-group">
                  <label className="form-label">{ar ? 'الكلية' : 'Faculty'}</label>
                  <select className="form-input" value={f.faculty_id} onChange={(e) => set({ faculty_id: e.target.value, department_id: '' })}>
                    <option value="">{ar ? '— بدون كلية —' : '— No faculty —'}</option>
                    {faculties.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
                  </select>
                </div>
              )}
              {type !== 'supervisor' && (
                <div className="form-group">
                  <label className="form-label">{ar ? 'القسم' : 'Department'}</label>
                  <select className="form-input" value={f.department_id} disabled={needFaculty && !f.faculty_id} onChange={(e) => set({ department_id: e.target.value })}>
                    <option value="">{ar ? '— بدون قسم —' : '— No department —'}</option>
                    {departments.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}
                  </select>
                </div>
              )}

              {type === 'student' && (
                <>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'المجموعة' : 'Group'}</label>
                    <select className="form-input" value={f.group_id} onChange={(e) => set({ group_id: e.target.value })}>
                      <option value="">{ar ? 'بدون مجموعة' : 'No group'}</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'الرقم الجامعي' : 'Student ID'}</label>
                    <input className="form-input" value={f.student_number} onChange={(e) => set({ student_number: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'السنة الدراسية' : 'Academic year'}</label>
                    <input className="form-input" type="number" min="1" max="8" value={f.academic_year} onChange={(e) => set({ academic_year: e.target.value })} />
                  </div>
                </>
              )}

              {type === 'academic_staff' && (
                <>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'الرتبة' : 'Rank'}</label>
                    <select className="form-input" value={f.academic_rank_id} onChange={(e) => set({ academic_rank_id: e.target.value })}>
                      <option value="">{ar ? '— اختر الرتبة (دكتور / معيد …) —' : '— Select rank (Doctor / TA …) —'}</option>
                      {ranks.map((r) => <option key={r.id} value={r.id}>{name(r)}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'الرقم الوظيفي' : 'Staff number'}</label>
                    <input className="form-input" value={f.staff_number} onChange={(e) => set({ staff_number: e.target.value })} />
                  </div>
                </>
              )}

              {type === 'supervisor' && (
                <>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'القسم' : 'Department'}</label>
                    <input className="form-input" value={f.department} onChange={(e) => set({ department: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{ar ? 'اللقب العلمي' : 'Academic title'}</label>
                    <input className="form-input" value={f.title} onChange={(e) => set({ title: e.target.value })} />
                  </div>
                </>
              )}
            </div>

            {type === 'supervisor' && (
              <div className="form-group">
                <label className="form-label">{ar ? 'الصلاحيات' : 'Permissions'}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  {PERMISSIONS.map((p) => (
                    <label key={p.key} className="text-small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={perms.includes(p.key)} onChange={() => setPerms((x) => (x.includes(p.key) ? x.filter((k) => k !== p.key) : [...x, p.key]))} />
                      {ar ? p.ar : p.en}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="form-error">{error}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : (ar ? 'ربط الحساب' : 'Link account')}</button>
            </div>
          </form>
        )}

        {!canLink && (
          <>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
