import { useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { useCall } from '../../context/callCtx';
import { callLine } from '../../lib/calls/callText';
import { errorMessage } from '../../api/client';

/**
 * The call line inside a chat (message_type='call'): "Voice call · 2:31", "Missed voice call"… + a call-back button.
 * Group calls (metadata.group) show one card for everybody: "Group video call · in progress" + a Join button while it is live,
 * then "Group video call · 12:04" once it is over.
 */
export default function CallBubble({ m, myUserId, onCallBack, canCall }) {
  const { locale } = useLanguage();
  const call = useCall();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const line = callLine(m.metadata, myUserId, ar);

  if (line.group) {
    const meta = m.metadata || {};
    const join = async () => {
      if (busy || call.phase !== 'idle') return;
      setBusy(true);
      setErr('');
      try {
        await call.joinGroupCall({ meeting_uuid: meta.meeting_uuid, join_token: meta.join_token, type: meta.call_type });
      } catch (e) {
        setErr(errorMessage(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className={`msg-call msg-call--${line.live ? 'ok' : 'info'} msg-call--group`}>
        <span className="msg-call__ico"><Icon name={line.video ? 'video' : 'phone'} size={18} /></span>
        <span className="msg-call__txt">
          <strong>{line.text}</strong>
          {err ? <span className="msg-call__err">{err}</span> : <span>{line.live ? (ar ? 'اضغط للانضمام' : 'Tap to join') : (ar ? 'انتهت' : 'Ended')}</span>}
        </span>
        {line.live && (
          <button type="button" className="msg-call__back" onClick={join} disabled={busy || call.phase !== 'idle'}>{ar ? 'انضم' : 'Join'}</button>
        )}
      </div>
    );
  }

  return (
    <div className={`msg-call msg-call--${line.tone}`}>
      <span className="msg-call__ico"><Icon name={line.video || line.incoming ? (line.video ? 'video' : 'phone') : 'phone'} size={18} style={line.video || line.incoming ? undefined : { transform: 'scaleX(-1)' }} /></span>
      <span className="msg-call__txt">
        <strong>{line.text}</strong>
        <span>{line.incoming ? (ar ? 'واردة' : 'Incoming') : (ar ? 'صادرة' : 'Outgoing')}</span>
      </span>
      {canCall && onCallBack && (
        <button type="button" className="msg-call__back" onClick={() => onCallBack(line.video)}>{ar ? 'اتصال' : 'Call back'}</button>
      )}
    </div>
  );
}
