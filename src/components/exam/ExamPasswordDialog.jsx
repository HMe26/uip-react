import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

const STR = {
  en: {
    title: 'Exam password',
    body: 'This exam is protected. Enter the password given by your instructor to continue.',
    label: 'Password', placeholder: 'Enter exam password',
    show: 'Show', hide: 'Hide', cancel: 'Cancel', start: 'Continue', working: 'Checking…',
  },
  ar: {
    title: 'باسورد الامتحان',
    body: 'هذا الامتحان محمي بباسورد. أدخل الباسورد الذي أعطاه لك مدرّس المادة للمتابعة.',
    label: 'الباسورد', placeholder: 'أدخل باسورد الامتحان',
    show: 'إظهار', hide: 'إخفاء', cancel: 'إلغاء', start: 'متابعة', working: 'جارٍ التحقق…',
  },
};

/** Asked before an attempt starts when exam.requires_password. onSubmit(password) — errors come in via `error`. */
export default function ExamPasswordDialog({ ar, busy, error, onCancel, onSubmit }) {
  const S = STR[ar ? 'ar' : 'en'];
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = (e) => {
    e?.preventDefault();
    if (!value.trim() || busy) return;
    onSubmit(value);
  };

  return (
    <div className="ex-modal-scrim" role="dialog" aria-modal="true">
      <form className="ex-modal" style={{ maxWidth: 420 }} onSubmit={submit}>
        <Icon name="lock" size={30} />
        <h2 style={{ margin: 0 }}>{S.title}</h2>
        <p className="ex-card__sub" style={{ margin: 0 }}>{S.body}</p>

        <label className="ex-card__sub" style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', textAlign: 'start' }}>
          <span>{S.label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              type={visible ? 'text' : 'password'}
              className="ex-input"
              style={{ flex: 1 }}
              value={value}
              placeholder={S.placeholder}
              autoComplete="off"
              maxLength={64}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="button" className="btn btn-outline" onClick={() => setVisible((v) => !v)}>{visible ? S.hide : S.show}</button>
          </div>
        </label>

        {error && <p className="form-error" style={{ margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>{S.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>{busy ? S.working : S.start}</button>
        </div>
      </form>
    </div>
  );
}
