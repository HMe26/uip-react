import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nExam from '../../i18n/academic-staff/exam-system';
import { ExportButtons } from './resultsShared';

const translations = { ...i18nCommon, ...i18nExam };

/**
 * Sidebar → Reports. The academic-staff role can't use /api/v1/reports (that surface is
 * admin/university only and answers 403), so this page is an export centre built on the
 * endpoints the role already owns:
 *   - one exam's results      → GET /exam-system/exams/{id}/results/export
 *   - all students' results   → GET /exam-system/results/students/export
 * Each download is audit-logged by the backend.
 */
export default function AcademicStaffReports() {
  const t = useTranslations(translations);
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/exam-system/exams')
      .then((json) => { const list = json.data || []; setExams(list); if (list[0]) setExamId(String(list[0].id)); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const card = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 className="text-h2" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon name="file" size={22} /> {t('Reports')}
        </h1>
        <p className="text-small" style={{ margin: 'var(--space-1) 0 0' }}>{t('Download your exam results as files.')}</p>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="card glass-panel" style={card}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t('Single exam results')}</h2>
        <p className="text-small" style={{ margin: 0 }}>{t('Every attempt of one exam: student, score, percentage, status and submission time.')}</p>
        <select className="form-input" style={{ maxWidth: 360 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
          {exams.length === 0 && <option value="">{t('No exams yet.')}</option>}
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <ExportButtons
          t={t}
          disabled={!examId}
          buildUrl={(fmt) => `/api/v1/exam-system/exams/${examId}/results/export?format=${fmt}`}
          filename={(fmt) => `exam_results_${examId}.${fmt}`}
        />
      </div>

      <div className="card glass-panel" style={card}>
        <h2 className="text-h3" style={{ margin: 0 }}>{t("All students' results")}</h2>
        <p className="text-small" style={{ margin: 0 }}>{t('Best result of every student in every one of your exams, in one file.')}</p>
        <ExportButtons
          t={t}
          buildUrl={(fmt) => `/api/v1/exam-system/results/students/export?format=${fmt}`}
          filename={(fmt) => `students_results.${fmt}`}
        />
      </div>
    </div>
  );
}
