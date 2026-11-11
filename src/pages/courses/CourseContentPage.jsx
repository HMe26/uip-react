import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import CourseMaterials from '../../components/courses/CourseMaterials';
import { useLanguage } from '../../context/LanguageContext';
import { Skeleton } from '../../components/student/stUi';

/**
 * Full page for the content of ONE course (محتوى المادة).
 *   /academic-staff/courses/:id/content · /faculty/courses/:id/content · /university/courses/:id/content
 *     → course staff / faculty / university: add, edit, delete lectures, files, videos, posts, exam notices.
 *   /student/courses/:id/content → enrolled student: read-only, can save items.
 * Data: GET /api/v1/courses/{id} (header) + <CourseMaterials/> (GET/POST /api/v1/courses/{id}/materials).
 */
export default function CourseContentPage({ role }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [course, setCourse] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const backTo = `/${role === 'academic_staff' ? 'academic-staff' : role}/courses`;
  const isStudent = role === 'student';

  useEffect(() => {
    setLoading(true);
    api.get(`/api/v1/courses/${id}`, { locale })
      .then((j) => setCourse(j.data))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, locale]);

  if (loading) return <div className="ex-page"><Skeleton h={120} count={3} /></div>;

  if (error || !course) {
    return (
      <div className="ex-page">
        <Link to={backTo} className="ex-back"><Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {ar ? 'رجوع للمواد' : 'Back to courses'}</Link>
        <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error || (ar ? 'المادة غير موجودة' : 'Course not found')}</span></div>
      </div>
    );
  }

  const name = ar ? (course.name_ar || course.name_en || course.name) : (course.name_en || course.name);
  const teachers = (course.staff || []).map((s) => s.full_name).join(ar ? '، ' : ', ');
  const canManage = !isStudent && !!course.can_manage;
  const meta = [
    course.faculty_name || (ar ? 'كل الجامعة' : 'Whole university'),
    course.department_name,
    course.credit_hours != null ? `${course.credit_hours} ${ar ? 'ساعات' : 'credit hrs'}` : null,
    course.academic_year ? (ar ? `السنة ${course.academic_year}` : `Year ${course.academic_year}`) : null,
    course.semester ? (ar ? `الفصل ${course.semester}` : `Semester ${course.semester}`) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="ex-page">
      <div>
        <button type="button" className="ex-back" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => navigate(backTo)}>
          <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={14} /> {ar ? 'رجوع للمواد' : 'Back to courses'}
        </button>
        <div className="ex-card" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="ex-chip">{course.code}</span>
            {!isStudent && (canManage
              ? <span className="ex-status ex-status--live">{ar ? 'تقدر تضيف وتعدّل' : 'You can manage'}</span>
              : <span className="ex-status ex-status--idle">{ar ? 'عرض فقط' : 'View only'}</span>)}
          </div>
          <h1 style={{ margin: 0, fontSize: 24 }}>{name}</h1>
          <p className="is-muted" style={{ margin: 0, fontSize: 13 }}>{meta}</p>
          <p className="is-muted" style={{ margin: 0, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="users" size={14} />
            {teachers || (ar ? 'لم يُعيَّن مدرّس بعد' : 'No teacher assigned yet')}
            {course.students_count != null && !isStudent ? ` · ${course.students_count} ${ar ? 'طالب مسجّل' : 'enrolled students'}` : ''}
          </p>
        </div>
      </div>

      <div className="ex-card" style={{ padding: '8px 20px 22px' }}>
        <CourseMaterials courseId={course.id} canManage={canManage} />
      </div>
    </div>
  );
}
