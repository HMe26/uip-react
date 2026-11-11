import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * Round 2 (Targeting + Publish) — GET/PUT /api/v1/exam-system/exams/{id}/targets,
 * POST .../targets/preview, GET .../targets/students, POST .../exams/{id}/publish,
 * POST .../exams/{id}/unpublish (ExamSystemApiController + ExamSystemService,
 * see EXAM_SYSTEM_API.md). A "target row" is either a specific student_id, or
 * an AND-combination of faculty/department/academic_year/group_id
 * (empty fields on a row are ignored — a fully empty row means "the whole
 * university"); rows are OR'd together (ExamTargetRepository::
 * eligibilityWhereGroups()).
 *
 * Faculty/Department options come from GET /api/v1/auth/university-
 * hierarchy/{universityId} — a pre-auth registration-flow endpoint (no role
 * check, not exam-system-specific), reused here since it already returns
 * exactly this shape scoped by university id. Group options and specific-
 * student targeting now use two dedicated academic_staff-scoped endpoints
 * (Round 2 UX follow-up): GET /api/v1/exam-system/targeting/groups (a real
 * dropdown, with live member counts) and GET /api/v1/exam-system/targeting/
 * students?q=... (debounced name/number/email typeahead) — both resolve the
 * caller's own university server-side (ExamSystemApiController::
 * searchTargetStudents/listTargetGroups), never trust client input for scope.
 */

const CARD = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' };
const STATUS_META = {
  draft: { cls: 'badge-neutral', key: 'Draft' },
  scheduled: { cls: 'badge-primary', key: 'Scheduled' },
  published: { cls: 'badge-success', key: 'Published' },
};

function emptyCriteriaRow() {
  return { faculty_id: '', department_id: '', academic_year: '', group_id: '' };
}

function rowIsEmpty(row) {
  return !row.faculty_id && !row.department_id && !row.academic_year && !row.group_id;
}

function toApiRow(row) {
  if (row.student_id) return { student_id: Number(row.student_id) };
  return {
    faculty_id: row.faculty_id ? Number(row.faculty_id) : null,
    department_id: row.department_id ? Number(row.department_id) : null,
    academic_year: row.academic_year ? Number(row.academic_year) : null,
    group_id: row.group_id ? Number(row.group_id) : null,
  };
}

function RowSummary({ row, hierarchy, groups, t, locale }) {
  if (row.student_id) {
    const label = row.student_label ? row.student_label : `#${row.student_id}`;
    return <span className="text-small">{t('Student')}: {label}</span>;
  }
  const parts = [];
  if (row.faculty_id) {
    const f = hierarchy.faculties.find((x) => String(x.id) === String(row.faculty_id));
    parts.push(`${t('Faculty')}: ${f?.name || '#' + row.faculty_id}`);
  }
  if (row.department_id) {
    const d = hierarchy.departments.find((x) => String(x.id) === String(row.department_id));
    parts.push(`${t('Department')}: ${d?.name || '#' + row.department_id}`);
  }
  if (row.academic_year) parts.push(`${t('Year')}: ${row.academic_year}`);
  if (row.group_id) {
    const g = groups.find((x) => String(x.id) === String(row.group_id));
    parts.push(`${t('Group')}: ${g?.name || '#' + row.group_id}`);
  }
  if (parts.length === 0) return <span className="text-small">{t('All students in the university')}</span>;
  return <span className="text-small">{parts.join(' · ')}</span>;
}

export default function AcademicStaffExamTargets() {
  const { id } = useParams();
  const t = useTranslations(translations);
  const { locale } = useLanguage();

  const [exam, setExam] = useState(null);
  const [rows, setRows] = useState([]);
  const [hierarchy, setHierarchy] = useState({ faculties: [], departments: [] });
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const [criteriaDraft, setCriteriaDraft] = useState(emptyCriteriaRow());

  // Specific-student picker: debounced name/number/email search against
  // /api/v1/exam-system/targeting/students (scoped server-side to this
  // instructor's own university — see file docblock).
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState([]);
  const [studentSearching, setStudentSearching] = useState(false);

  const [showStudents, setShowStudents] = useState(false);
  const [studentsSample, setStudentsSample] = useState(null);
  const [studentsLoading, setStudentsLoading] = useState(false);

  const [publishing, setPublishing] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      api.get(`/api/v1/exam-system/exams/${id}`),
      api.get(`/api/v1/exam-system/exams/${id}/targets`),
    ]).then(([examJson, targetsJson]) => {
      setExam(examJson.data);
      setRows((targetsJson.data.targets || []).map((r) => ({
        faculty_id: r.faculty_id ?? '',
        department_id: r.department_id ?? '',
        academic_year: r.academic_year ?? '',
        group_id: r.group_id ?? '',
        student_id: r.student_id ?? '',
        student_label: r.student_label ?? '',
      })));
    });
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  // Faculty/Department options — from the instructor's own
  // university (GET /academic-staff/me), locale-aware names.
  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/academic-staff/me').then((meJson) => {
      const universityId = meJson.data?.staff?.university_id;
      if (!universityId) return;
      return api.get(`/api/v1/auth/university-hierarchy/${universityId}`, { locale });
    }).then((hierarchyJson) => {
      if (cancelled || !hierarchyJson) return;
      setHierarchy({
        faculties: hierarchyJson.faculties || [],
        departments: hierarchyJson.departments || [],
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [locale]);

  // Group options for the "Group" dropdown — scoped server-side to this
  // instructor's own university (Round 2 UX follow-up).
  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/exam-system/targeting/groups').then((json) => {
      if (!cancelled) setGroups(json.data || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Once existing targets are loaded, resolve display names for any saved
  // specific-student rows (they only carry student_id from the server) by
  // cross-referencing the exam's own matching-students list — a specific-
  // student row is always eligible for itself, so it's always in that list.
  useEffect(() => {
    const studentRowIds = rows.filter((r) => r.student_id && !r.student_label).map((r) => String(r.student_id));
    if (studentRowIds.length === 0) return;
    let cancelled = false;
    api.get(`/api/v1/exam-system/exams/${id}/targets/students`).then((json) => {
      if (cancelled) return;
      const byId = {};
      (json.data || []).forEach((s) => { byId[String(s.id)] = `${s.full_name} (${s.student_number})`; });
      setRows((prev) => prev.map((r) => (r.student_id && byId[String(r.student_id)]
        ? { ...r, student_label: byId[String(r.student_id)] }
        : r)));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rows.length]);

  // Live "N students match" preview — debounced on every row change.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewing(true);
      api.post(`/api/v1/exam-system/exams/${id}/targets/preview`, { targets: rows.map(toApiRow) })
        .then((json) => setPreviewCount(json.data.matching_count))
        .catch(() => setPreviewCount(null))
        .finally(() => setPreviewing(false));
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [rows, id, loading]);

  // Student typeahead — debounced, needs 2+ characters (mirrors the
  // backend's own minimum in ExamSystemService::searchStudentsForTargeting).
  const studentSearchRef = useRef(null);
  useEffect(() => {
    clearTimeout(studentSearchRef.current);
    const q = studentQuery.trim();
    if (q.length < 2) {
      setStudentResults([]);
      setStudentSearching(false);
      return;
    }
    setStudentSearching(true);
    studentSearchRef.current = setTimeout(() => {
      api.get('/api/v1/exam-system/targeting/students', { q })
        .then((json) => setStudentResults(json.data || []))
        .catch(() => setStudentResults([]))
        .finally(() => setStudentSearching(false));
    }, 350);
    return () => clearTimeout(studentSearchRef.current);
  }, [studentQuery]);

  const filteredDepartments = useMemo(
    () => (criteriaDraft.faculty_id ? hierarchy.departments.filter((d) => String(d.faculty_id) === String(criteriaDraft.faculty_id)) : hierarchy.departments),
    [hierarchy.departments, criteriaDraft.faculty_id]
  );

  function addCriteriaRow() {
    if (rowIsEmpty(criteriaDraft) && !window.confirm(t('Add this row as "All students in the university"?'))) {
      return;
    }
    setRows((prev) => [...prev, { ...criteriaDraft, student_id: '' }]);
    setCriteriaDraft(emptyCriteriaRow());
  }

  function addStudentRow(student) {
    if (rows.some((r) => String(r.student_id) === String(student.id))) {
      setStudentQuery('');
      setStudentResults([]);
      return;
    }
    setRows((prev) => [...prev, {
      ...emptyCriteriaRow(),
      student_id: student.id,
      student_label: `${student.full_name} (${student.student_number})`,
    }]);
    setStudentQuery('');
    setStudentResults([]);
  }

  function removeRow(idx) {
    if (!window.confirm(t('Remove this targeting row?'))) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setActionError(null);
    setSaved(false);
    try {
      await api.put(`/api/v1/exam-system/exams/${id}/targets`, { targets: rows.map(toApiRow) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleStudentsSample() {
    if (showStudents) {
      setShowStudents(false);
      return;
    }
    setShowStudents(true);
    setStudentsLoading(true);
    try {
      const json = await api.get(`/api/v1/exam-system/exams/${id}/targets/students`);
      setStudentsSample(json.data || []);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setStudentsLoading(false);
    }
  }

  async function handlePublish() {
    if (!window.confirm(t('Publish this exam so its eligible students can see it?'))) return;
    setPublishing(true);
    setActionError(null);
    try {
      const json = await api.post(`/api/v1/exam-system/exams/${id}/publish`);
      setExam((prev) => ({ ...prev, ...json.data }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    if (!window.confirm(t('Unpublish this exam? It will move back to draft and students will no longer see it.'))) return;
    setPublishing(true);
    setActionError(null);
    try {
      const json = await api.post(`/api/v1/exam-system/exams/${id}/unpublish`);
      setExam((prev) => ({ ...prev, ...json.data }));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  if (loading) return <p className="text-small" style={{ padding: 'var(--space-5)' }}>{t('Loading…')}</p>;
  if (error) return <p className="form-error" style={{ padding: 'var(--space-5)' }}>{error}</p>;
  if (!exam) return null;

  const statusMeta = STATUS_META[exam.status] || STATUS_META.draft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <Link to={`/academic-staff/exams/${id}`} className="text-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevron-left" size={14} /> {t('Back to Exam Builder')}
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div>
          <h1 className="text-h2" style={{ margin: 0 }}>{exam.title}</h1>
          <p className="text-small" style={{ margin: 'var(--space-1) 0 0' }}>{t('Manage Targeting & Publish')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className={`badge ${statusMeta.cls}`}>{t(statusMeta.key)}</span>
          <Link to={`/academic-staff/exams/${id}/attempts`} className="btn btn-outline btn-sm">
            <Icon name="edit" size={14} /> {t('View Attempts & Grading')}
          </Link>
          <Link to={`/academic-staff/exams/${id}/analytics`} className="btn btn-outline btn-sm">
            <Icon name="chart" size={14} /> {t('Analytics')}
          </Link>
        </div>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      {/* Targeting */}
      <div className="card glass-panel" style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <h2 className="text-h3" style={{ margin: 0 }}>{t('Target Audience')}</h2>
          <span className="badge badge-primary">
            {previewing ? '…' : `${previewCount ?? 0} ${t('students match the current rules')}`}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-small">{t('No targeting rules yet — this exam is not visible to any student.')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {rows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <RowSummary row={row} hierarchy={hierarchy} groups={groups} t={t} locale={locale} />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => removeRow(idx)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '…' : t('Save Targeting')}
          </button>
          {saved && <span className="text-caption" style={{ color: 'var(--color-success)' }}>{t('Targeting saved.')}</span>}
          <button type="button" className="btn btn-outline" onClick={toggleStudentsSample}>
            <Icon name="eye" size={14} /> {showStudents ? t('Hide Matching Students') : t('View Matching Students')}
          </button>
        </div>

        {showStudents && (
          <div>
            <h3 className="text-small" style={{ fontWeight: 600, margin: '0 0 var(--space-2)' }}>{t('Matching students (sample, up to 200)')}</h3>
            {studentsLoading ? (
              <p className="text-small">{t('Loading…')}</p>
            ) : (studentsSample || []).length === 0 ? (
              <p className="text-small">{t('No students currently match these targeting rules.')}</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('Name')}</th>
                      <th>{t('Student Number')}</th>
                      <th>{t('Email')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentsSample.map((s) => (
                      <tr key={s.id}>
                        <td>{s.full_name}</td>
                        <td>{s.student_number}</td>
                        <td>{s.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

        <div className="grid-2">
          {/* Add criteria row */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{t('Add Criteria Row')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <select
                className="form-input"
                value={criteriaDraft.faculty_id}
                onChange={(e) => setCriteriaDraft((d) => ({ ...d, faculty_id: e.target.value, department_id: '' }))}
              >
                <option value="">{t('All faculties')}</option>
                {hierarchy.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select
                className="form-input"
                value={criteriaDraft.department_id}
                onChange={(e) => setCriteriaDraft((d) => ({ ...d, department_id: e.target.value }))}
              >
                <option value="">{t('All departments')}</option>
                {filteredDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select
                className="form-input"
                value={criteriaDraft.academic_year}
                onChange={(e) => setCriteriaDraft((d) => ({ ...d, academic_year: e.target.value }))}
              >
                <option value="">{t('Any year')}</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => (
                  <option key={y} value={y}>{locale === 'ar' ? `السنة ${y}` : `Year ${y}`}</option>
                ))}
              </select>
              <select
                className="form-input"
                value={criteriaDraft.group_id}
                onChange={(e) => setCriteriaDraft((d) => ({ ...d, group_id: e.target.value }))}
              >
                <option value="">{t('Any group')}</option>
                {groups.length === 0 && <option value="" disabled>{t('No groups yet.')}</option>}
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} — {g.members_count ?? 0} {t('members')}</option>
                ))}
              </select>
              <button type="button" className="btn btn-outline btn-sm" onClick={addCriteriaRow}>
                <Icon name="plus" size={14} /> {t('Add Row')}
              </button>
            </div>
          </div>

          {/* Add specific student row — debounced name/number/email typeahead */}
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{t('Add Specific Student')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', position: 'relative' }}>
              <input
                className="form-input"
                type="text"
                placeholder={t('Search by name, student number, or email…')}
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
              />
              {studentQuery.trim().length > 0 && studentQuery.trim().length < 2 && (
                <p className="text-caption" style={{ margin: 0 }}>{t('Type at least 2 characters to search.')}</p>
              )}
              {studentSearching && <p className="text-caption" style={{ margin: 0 }}>{t('Searching…')}</p>}
              {!studentSearching && studentQuery.trim().length >= 2 && studentResults.length === 0 && (
                <p className="text-caption" style={{ margin: 0 }}>{t('No matching students found.')}</p>
              )}
              {studentResults.length > 0 && (
                <div className="card glass-panel" style={{ padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 220, overflowY: 'auto' }}>
                  {studentResults.map((s) => {
                    const already = rows.some((r) => String(r.student_id) === String(s.id));
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ justifyContent: 'space-between', textAlign: locale === 'ar' ? 'right' : 'left' }}
                        disabled={already}
                        onClick={() => addStudentRow(s)}
                      >
                        <span>
                          {s.full_name} · {s.student_number}
                          {s.faculty ? ` · ${s.faculty}` : ''}
                        </span>
                        <span className="text-caption">{already ? t('Already added') : <Icon name="plus" size={14} />}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Publish */}
      <div className="card glass-panel" style={CARD}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t('Publish')}</h2>
        {exam.status === 'draft' && <p className="text-small">{t('This exam is a draft. Define a target audience, then publish when ready.')}</p>}
        {exam.status === 'scheduled' && <p className="text-small">{t('This exam is scheduled and will open automatically at its start date.')}</p>}
        {exam.status === 'published' && <p className="text-small">{t('This exam is published and visible to its targeted students.')}</p>}

        <div>
          {exam.status === 'draft' && (
            <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={publishing}>
              <Icon name="check-circle" size={16} /> {publishing ? '…' : t('Publish')}
            </button>
          )}
          {(exam.status === 'scheduled' || exam.status === 'published') && (
            <button type="button" className="btn btn-danger" onClick={handleUnpublish} disabled={publishing}>
              <Icon name="x-circle" size={16} /> {publishing ? '…' : t('Unpublish')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
