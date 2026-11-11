import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { EmptyState, Skeleton } from '../student/stUi';
import { AcPage, AcHead, AcAlerts, AcKpis, AcPanel, AcNums, AcTable } from './acKit';

/**
 * الإيميل الجامعي (الطالب): العنوان الرسمي اللي ولّدته الجامعة، وبيتحوّل لإيميلك الشخصي. مفيش صندوق وارد على المنصة.
 * Backend: GET /api/v1/university-email/mine.
 */
export default function StudentUniversityEmail() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.get('/api/v1/university-email/mine', { locale }).then((j) => setData(j.data || {})).catch((e) => setError(errorMessage(e))); }, [locale]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  return (
    <AcPage>
      <AcHead
        title={ar ? 'الإيميل الجامعي' : 'University email'}
        text={ar ? 'عنوانك الرسمي في الجامعة. الرسائل المرسلة له بتتحوّل لإيميلك الشخصي.' : 'Your official university address. Mail sent to it is forwarded to your personal email.'}
      />
      <AcAlerts error={error} />
      {!data && !error ? <Skeleton h={90} count={1} /> : data && (
        !data.address ? (
          <EmptyState icon="mail" title={ar ? 'لم يتم إنشاء عنوان لك بعد' : 'No address has been created for you yet'} />
        ) : (
          <AcPanel
            title={ar ? 'عنوانك الجامعي' : 'Your university address'}
            foot={<span className="acx-muted">{ar ? 'لتغيير الإيميل الشخصي اللي بيتحوّل له، حدّثه من إعدادات حسابك.' : 'To change where it forwards, update your personal email in account settings.'}</span>}
          >
            <div className="acx-stack">
              <div className="acx-hero">
                <span dir="ltr" className="acx-hero__value">{data.address}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</button>
              </div>
              <AcNums inline items={[[ar ? 'يتحوّل إلى' : 'Forwards to', <bdi dir="ltr" key="f">{data.forwards_to}</bdi>]]} />
              <div className="st-alert"><Icon name="info" size={15} /><span>{ar ? 'تقدر كمان تسجّل الدخول للمنصة بالعنوان ده وبنفس كلمة السر.' : 'You can also sign in to the platform with this address and your usual password.'}</span></div>
            </div>
          </AcPanel>
        )
      )}
    </AcPage>
  );
}
