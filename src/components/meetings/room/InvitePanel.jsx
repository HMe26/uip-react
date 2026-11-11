import { useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** "Invite people" dialog inside the room: join link (copy / share), meeting code, password reminder. Host / moderator only. */
export default function InvitePanel({ title, joinUrl, code, hasPassword, onClose }) {
  const t = useTranslations(translations);
  const [copied, setCopied] = useState(null); // 'link' | 'code'
  const flash = (what) => { setCopied(what); setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600); };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="meeting-invite" role="presentation" onClick={onClose}>
      <div className="meeting-invite__card" role="dialog" aria-label={t('Invite people')} onClick={(e) => e.stopPropagation()}>
        <div className="meeting-invite__head">
          <strong>{t('Invite people')}</strong>
          <button type="button" className="meeting-room__icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={16} /></button>
        </div>
        {joinUrl ? (
          <>
            <p className="meeting-invite__hint">{t('Share this link to invite people')}</p>
            <div className="meeting-invite__row">
              <code dir="ltr">{joinUrl}</code>
              <button type="button" className={`meeting-invite__btn${copied === 'link' ? ' is-done' : ''}`} onClick={async () => { if (await copyText(joinUrl)) flash('link'); }}>
                <Icon name={copied === 'link' ? 'check' : 'copy'} size={15} /> {copied === 'link' ? t('Copied!') : t('Copy link')}
              </button>
            </div>
            {canShare && (
              <button type="button" className="meeting-invite__btn meeting-invite__btn--wide" onClick={() => { navigator.share({ title: title || '', url: joinUrl }).catch(() => {}); }}>
                <Icon name="share" size={15} /> {t('Share')}
              </button>
            )}
            {code && (
              <div className="meeting-invite__row">
                <span>{t('Meeting Code')}: <strong dir="ltr" style={{ unicodeBidi: 'isolate' }}>{code}</strong></span>
                <button type="button" className={`meeting-invite__btn${copied === 'code' ? ' is-done' : ''}`} onClick={async () => { if (await copyText(String(code))) flash('code'); }}>
                  <Icon name={copied === 'code' ? 'check' : 'copy'} size={15} /> {copied === 'code' ? t('Copied!') : t('Copy')}
                </button>
              </div>
            )}
            {hasPassword && <p className="meeting-invite__hint">{t('This meeting has a password — send it to them separately.')}</p>}
          </>
        ) : (
          <p className="meeting-invite__hint">{t('The link is not available yet.')}</p>
        )}
      </div>
    </div>
  );
}
