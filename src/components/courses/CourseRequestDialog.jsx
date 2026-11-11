import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { Field, FormModal, FormSection } from '../people/formUi';

const MAX_MB = 10;
const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.zip';

/**
 * Enrol / drop is a REQUEST, not an instant action. This dialog (1) warns the student what is
 * about to happen so they don't click by mistake, (2) lets them add a message and one attachment,
 * and (3) sends it to the university, the faculty and the course staff — the first to approve
 * applies it. POST /api/v1/courses/{id}/enroll | /unenroll (multipart).
 */
export default function CourseRequestDialog({ course, type, onClose, onDone }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const drop = type === 'drop';
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [understood, setUnderstood] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function pick(e) {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setError(ar ? `حجم الملف أكبر من ${MAX_MB} ميجابايت.` : `The file is larger than ${MAX_MB} MB.`);
      e.target.value = '';
      return;
    }
    setError(null);
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    if (!understood || saving) return;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('locale', locale);
      if (message.trim()) fd.append('message', message.trim());
      if (file) fd.append('attachment', file);
      const json = await api.postForm(`/api/v1/courses/${course.id}/${drop ? 'unenroll' : 'enroll'}`, fd);
      onDone(json.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const title = drop ? (ar ? 'طلب إلغاء تسجيل مادة' : 'Request to leave a course') : (ar ? 'طلب تسجيل في مادة' : 'Request to enrol in a course');

  return (
    <FormModal
      title={title}
      subtitle={`${course.code} — ${course.name}`}
      icon={drop ? 'alert-triangle' : 'plus'}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      submitDisabled={!understood}
      submitLabel={drop ? (ar ? 'إرسال طلب الإلغاء' : 'Send leave request') : (ar ? 'إرسال طلب التسجيل' : 'Send enrol request')}
      error={error}
    >
      <div className={`cr-warn${drop ? ' cr-warn--danger' : ''}`} role="alert">
        <Icon name="alert-triangle" size={18} />
        <div>
          <strong>{ar ? 'تنبيه قبل الإرسال' : 'Please read before you send'}</strong>
          <ul>
            <li>{drop
              ? (ar ? 'أنت على وشك طلب إلغاء تسجيلك من هذه المادة.' : 'You are about to ask to be removed from this course.')
              : (ar ? 'أنت على وشك طلب التسجيل في هذه المادة.' : 'You are about to ask to be enrolled in this course.')}</li>
            <li>{ar
              ? 'الإجراء لن يتم مباشرة: يُرسَل طلبك إلى الجامعة والكلية ومدرّسي المادة (الدكتور والمعيد).'
              : 'It will NOT happen immediately: your request goes to the university, the faculty and the course doctor / TA.'}</li>
            <li>{ar
              ? 'يُنفَّذ الطلب فور موافقة أي جهة منهم، وستصلك رسالة بالنتيجة.'
              : 'It is applied as soon as any one of them approves, and you will be notified of the result.'}</li>
            {drop && <li>{ar ? 'بعد الموافقة ستخرج من المادة وقد تفقد الوصول إلى أنشطتها ودرجاتها.' : 'Once approved you leave the course and may lose access to its activities and grades.'}</li>}
          </ul>
        </div>
      </div>

      <FormSection title={ar ? 'رسالتك للجهات المسؤولة' : 'Your message to the reviewers'} hint={ar ? 'اختياري — اشرح سبب طلبك أو اكتب أي بيانات تحتاجها الجهة.' : 'Optional — explain your reason or add any details they need.'}>
        <Field label={ar ? 'الرسالة / بياناتك' : 'Message / your details'} wide>
          <textarea
            className="ex-input"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={ar ? 'مثال: رقمي الجامعي ... وأطلب ... لأن ...' : 'e.g. My student number is … and I am asking because …'}
          />
          <small className="pf-hint">{message.length}/2000</small>
        </Field>
        <Field label={ar ? 'ملف مرفق' : 'Attachment'} hint={ar ? `PDF أو Word أو صورة أو ZIP — حتى ${MAX_MB} ميجابايت.` : `PDF, Word, image or ZIP — up to ${MAX_MB} MB.`} wide>
          <input type="file" accept={ACCEPT} onChange={pick} />
          {file && <small className="pf-hint">{file.name}</small>}
        </Field>
      </FormSection>

      <label className="cr-confirm">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        <span>{drop
          ? (ar ? 'أفهم أنني أطلب إلغاء تسجيلي من المادة وأن الطلب سيُرسل للجهات المسؤولة.' : 'I understand I am requesting to leave this course and the request will be sent to the reviewers.')
          : (ar ? 'أفهم أنني أطلب التسجيل في المادة وأن الطلب سيُرسل للجهات المسؤولة.' : 'I understand I am requesting to enrol and the request will be sent to the reviewers.')}</span>
      </label>
    </FormModal>
  );
}
