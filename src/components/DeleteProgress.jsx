import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { useLanguage } from '../context/LanguageContext';
import { deleteJobs, useDeleteJobs } from '../lib/deleteProgress';
import '../styles/css/my-pc.css';

function Job({ job, ar }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.state !== 'run') return undefined;
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, [job.state]);
  const secs = Math.max(0, Math.floor((now - job.started) / 1000));
  const n = job.count;
  const tt = (en, a) => (ar ? a : en);
  const what = job.kind === 'empty' ? tt('Emptying the recycle bin…', 'جاري تفريغ سلة المحذوفات…')
    : job.kind === 'purge' ? (n === 1 ? tt('Deleting permanently…', 'جاري الحذف النهائي…') : tt(`Deleting ${n} items permanently…`, `جاري حذف ${n} عناصر نهائيًا…`))
      : (n === 1 ? tt('Deleting…', 'جاري الحذف…') : tt(`Deleting ${n} items…`, `جاري حذف ${n} عناصر…`));
  const title = job.state === 'ok' ? tt('Deleted', 'تم الحذف') : job.state === 'err' ? tt('Could not delete', 'تعذّر الحذف') : what;
  return (
    <div className={`dp-card is-${job.state}`} role="status">
      <span className="dp-ring" aria-hidden="true">
        {job.state === 'run' && <svg viewBox="0 0 44 44"><circle className="dp-ring__bg" cx="22" cy="22" r="19" /><circle className="dp-ring__arc" cx="22" cy="22" r="19" /></svg>}
        {job.state === 'run' ? <b>{secs}</b> : <Icon name={job.state === 'ok' ? 'check' : 'alert-triangle'} size={20} />}
      </span>
      <span className="dp-tx">
        <b dir="auto">{title}</b>
        {job.state === 'run' && <small>{secs < 8 ? tt('You can keep working — close this any time.', 'كمّل شغلك عادي — تقدر تقفل ده في أي وقت.') : tt('Big folders take a little longer.', 'المجلدات الكبيرة بتاخد وقت أطول شوية.')}</small>}
      </span>
      {job.state === 'run' && <button type="button" className="dp-x" aria-label={tt('Hide', 'إخفاء')} title={tt('Hide (the deletion continues)', 'إخفاء (الحذف مكمّل)')} onClick={() => deleteJobs.hide(job.id)}><Icon name="x" size={14} /></button>}
    </div>
  );
}

/** Floating, non-blocking delete progress (bottom corner). Mount once per page / desktop. */
export default function DeleteProgressHost() {
  const { locale } = useLanguage();
  const jobs = useDeleteJobs().filter((j) => !j.hidden);
  if (!jobs.length || typeof document === 'undefined') return null;
  return createPortal(
    <div className="dp" dir={locale === 'ar' ? 'rtl' : 'ltr'} aria-live="polite">
      {jobs.slice(-3).map((j) => <Job key={j.id} job={j} ar={locale === 'ar'} />)}
    </div>,
    document.body,
  );
}
