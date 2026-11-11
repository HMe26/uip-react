import { useLanguage } from '../../context/LanguageContext';

/**
 * Editable certificate data for the graduation approval forms (university + faculty portals).
 * Everything here is written to the graduation record at approval time; a field left blank
 * falls back to the value on the student's profile (done server-side).
 */

export function certificateDefaults(student) {
  const s = student || {};
  return {
    graduation_date: new Date().toISOString().slice(0, 10),
    final_gpa: s.gpa ?? '',
    degree_title_ar: '',
    degree_title_en: '',
    faculty_name_ar: s.faculty_name_ar || '',
    faculty_name_en: s.faculty_name_en || '',
    department_name_ar: s.department_name_ar || '',
    department_name_en: s.department_name_en || '',
    notes: '',
  };
}

const FIELDS = [
  ['graduation_date', 'تاريخ التخرج', 'Graduation date', 'date'],
  ['final_gpa', 'المعدل التراكمي النهائي (0 – 4)', 'Final GPA (0 – 4)', 'number'],
  ['degree_title_ar', 'اسم الدرجة العلمية (عربي)', 'Degree title (Arabic)', 'text'],
  ['degree_title_en', 'اسم الدرجة العلمية (إنجليزي)', 'Degree title (English)', 'text'],
  ['faculty_name_ar', 'اسم الكلية (عربي)', 'Faculty name (Arabic)', 'text'],
  ['faculty_name_en', 'اسم الكلية (إنجليزي)', 'Faculty name (English)', 'text'],
  ['department_name_ar', 'اسم القسم (عربي)', 'Department name (Arabic)', 'text'],
  ['department_name_en', 'اسم القسم (إنجليزي)', 'Department name (English)', 'text'],
];

export default function CertificateFields({ form, onChange, notesLabel }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const set = (key) => (e) => onChange({ ...form, [key]: e.target.value });

  return (
    <>
      <div className="grid-2">
        {FIELDS.map(([key, labelAr, labelEn, type]) => (
          <div className="form-group" key={key}>
            <label className="form-label">{ar ? labelAr : labelEn}</label>
            <input
              className="form-input"
              type={type}
              step={type === 'number' ? '0.01' : undefined}
              min={type === 'number' ? '0' : undefined}
              max={type === 'number' ? '4' : undefined}
              dir={key.endsWith('_en') ? 'ltr' : undefined}
              value={form[key] ?? ''}
              onChange={set(key)}
            />
          </div>
        ))}
      </div>
      <p className="text-caption" style={{ marginBottom: 'var(--space-3)' }}>
        {ar
          ? 'الحقول مُعبّأة من ملف الطالب، وتقدر تعدّل أي قيمة قبل الاعتماد. الحقل الفاضي يرجع لقيمة ملف الطالب.'
          : "Fields are pre-filled from the student's profile. Edit any value before approving; a blank field falls back to the profile value."}
      </p>
      <div className="form-group">
        <label className="form-label">{notesLabel}</label>
        <textarea className="form-input" rows={3} value={form.notes ?? ''} onChange={set('notes')} />
      </div>
    </>
  );
}
