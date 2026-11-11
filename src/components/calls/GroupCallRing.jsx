import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { useCall } from '../../context/callCtx';
import { errorMessage } from '../../api/client';

/**
 * "X started a group call" card: shown on every page while a group call in one of my chats is live and I'm not in it.
 * Join = enter the meeting room (same as a meeting invite); Dismiss = silence it (the chat card stays, so I can still join later).
 */
export default function GroupCallRing() {
  const call = useCall();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // while a 1:1 call is on screen, don't stack a second ringing card on top of it
  const list = call.phase === 'idle' ? (call.groupRing || []) : [];
  if (!list.length || typeof document === 'undefined') return null;
  const c = list[0];
  const video = c.type === 'video';
  const kind = video ? (ar ? 'مكالمة فيديو جماعية' : 'Group video call') : (ar ? 'مكالمة صوتية جماعية' : 'Group voice call');
  const who = c.started_by && c.started_by.name ? c.started_by.name : '';

  const join = async () => {
    setBusy(c.meeting_uuid);
    setError('');
    try { await call.joinGroupCall(c); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  };

  return createPortal(
    <div className="call-layer" dir={ar ? 'rtl' : 'ltr'} role="alertdialog" aria-live="assertive" aria-label={kind}>
      <div className="call-incoming call-incoming--group">
        <span className="call-avatar call-avatar--md"><Icon name={video ? 'video' : 'phone'} size={22} /></span>
        <span className="call-incoming__txt">
          <strong>{c.title || kind}</strong>
          <span>{error || `${kind}${who ? ` · ${who}` : ''}${c.participants ? ` · ${c.participants} ${ar ? 'في المكالمة' : 'in call'}` : ''}`}</span>
        </span>
        <span className="call-incoming__btns">
          <button type="button" className="call-btn call-btn--decline" onClick={() => call.dismissGroupRing(c.meeting_uuid)} aria-label={ar ? 'تجاهل' : 'Dismiss'} title={ar ? 'تجاهل' : 'Dismiss'}>
            <Icon name="x" size={20} />
          </button>
          <button type="button" className="call-btn call-btn--accept" onClick={join} disabled={!!busy} aria-label={ar ? 'انضم' : 'Join'} title={ar ? 'انضم' : 'Join'}>
            <Icon name={video ? 'video' : 'phone'} size={20} />
          </button>
        </span>
      </div>
    </div>,
    document.body,
  );
}
