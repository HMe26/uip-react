import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import Icon from '../Icon';
import { AuthSelect } from './AuthField';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/auth/pages';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * University -> faculty -> department cascade used when a student signs up
 * (Register.jsx and the "finish your details" step after Google sign-in).
 *
 *   GET /api/v1/auth/universities
 *   GET /api/v1/auth/university-hierarchy/{id}   (whole tree for the university in one call;
 *                                                 departments are filtered client-side)
 *
 * Everything is optional, exactly like RegisterController. `onChange` receives
 * { university_id, faculty_id, department_id } with only the chosen ids set.
 */
export default function AcademicFields({ onChange, compact = false }) {
  const t = useTranslations(translations);
  const [universities, setUniversities] = useState([]);
  const [universityId, setUniversityId] = useState('');
  const [faculties, setFaculties] = useState([]);
  const [facultyId, setFacultyId] = useState('');
  const [allDepartments, setAllDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [hierarchyLoading, setHierarchyLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/v1/auth/universities')
      .then((json) => { if (!cancelled) setUniversities(json.data || []); })
      .catch(() => { /* non-fatal: the field just stays empty/optional */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const out = {};
    if (universityId) {
      out.university_id = universityId;
      if (facultyId) out.faculty_id = facultyId;
      if (departmentId) out.department_id = departmentId;
    }
    onChange?.(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universityId, facultyId, departmentId]);

  function resetDownstream() {
    setFaculties([]);
    setFacultyId('');
    setAllDepartments([]);
    setDepartmentId('');
  }

  async function handleUniversityChange(e) {
    const id = e.target.value;
    setUniversityId(id);
    resetDownstream();
    if (!id) return;

    setHierarchyLoading(true);
    try {
      const json = await api.get(`/api/v1/auth/university-hierarchy/${id}`);
      // Raw tree ({faculties, departments}), not the usual {success, data} envelope.
      const tree = json?.faculties ? json : (json?.data || {});
      setFaculties(tree.faculties || []);
      setAllDepartments(tree.departments || []);
    } catch {
      resetDownstream();
    } finally {
      setHierarchyLoading(false);
    }
  }

  const departmentsForFaculty = facultyId ? allDepartments.filter((d) => String(d.faculty_id) === String(facultyId)) : [];

  const universityField = (
    <AuthSelect
      id="university_id"
      label={t('Your university')}
      icon="building"
      value={universityId}
      onChange={handleUniversityChange}
      hint={compact
        ? t('The university approves your join request. You can pick it later.')
        : t("This sends a join request the university approves. You can pick it later from your account if you're not sure yet.")}
    >
      <option value="">{t('— Decide later —')}</option>
      {universities.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </AuthSelect>
  );

  const facultyField = (
    <AuthSelect
      id="faculty_id"
      label={t('Faculty (optional)')}
      value={facultyId}
      onChange={(e) => { setFacultyId(e.target.value); setDepartmentId(''); }}
      disabled={!universityId || !faculties.length}
    >
      <option value="">
        {hierarchyLoading
          ? t('Loading…')
          : (universityId && faculties.length ? t('— Select faculty (optional) —') : t('— Select university first —'))}
      </option>
      {faculties.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </AuthSelect>
  );

  const departmentField = (
    <AuthSelect
      id="department_id"
      label={t('Department (optional)')}
      value={departmentId}
      onChange={(e) => setDepartmentId(e.target.value)}
      disabled={!facultyId}
      hint={compact ? undefined : t("Leave this blank if your department isn't assigned until a later year.")}
    >
      <option value="">{t('— No department —')}</option>
      {departmentsForFaculty.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </AuthSelect>
  );

  // Compact (Register step 2): no framed group, faculty + department side by side.
  if (compact) {
    return (
      <div>
        {universityField}
        <div className="auth-row">
          {facultyField}
          {departmentField}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-group">
      <p className="auth-group__title">
        <Icon name="building" size={16} /> {t('Academic details')}
      </p>
      {universityField}
      {facultyField}
      {departmentField}
    </div>
  );
}
