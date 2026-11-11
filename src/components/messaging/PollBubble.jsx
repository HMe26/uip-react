import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import MsgIcon from './msgIcons';
import { Avatar } from './ConversationRail';
import { attachmentUrl } from './format';
import { useLanguage } from '../../context/LanguageContext';

const BASE = '/api/v1/messaging';

/**
 * WhatsApp-style poll: tap an option to vote (tap it again to take the vote back),
 * live bars + counts, and a "View votes" toggle that opens/closes the voters list
 * right under the options (who picked what).
 */
export default function PollBubble({ m, onVote }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const [open, setOpen] = useState(false);
  const [voters, setVoters] = useState(null);
  const [loading, setLoading] = useState(false);

  const results = m.pollResults || {};
  const options = m.metadata?.options || [];
  const total = Number(m.pollTotal ?? Object.values(results).reduce((s, v) => s + Number(v || 0), 0));
  const myVote = m.myVote ?? null;
  const maxCount = Math.max(0, ...options.map((_, i) => Number(results[i] || 0)));

  const loadVoters = () => {
    setLoading(true);
    api.get(BASE + '/messages/' + m.id + '/poll-voters')
      .then((r) => setVoters(r.data || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // while the list is open, refresh it whenever a vote count changes
  useEffect(() => {
    if (open) loadVoters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total, myVote]);

  return (
    <div className="poll" data-poll-msg-id={m.id}>
      <div className="poll__q">
        <span className="poll__q-ico"><MsgIcon name="poll" size={15} /></span>
        <span>{m.metadata.question}</span>
      </div>
      <div className="poll__hint">{t('Select one option', 'اختر خيارًا واحدًا')}</div>

      <div className="poll__opts" role="radiogroup" aria-label={m.metadata.question}>
        {options.map((opt, idx) => {
          const count = Number(results[idx] || 0);
          const pct = total ? Math.round((count / total) * 100) : 0;
          const picked = myVote === idx;
          const lead = count > 0 && count === maxCount;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={picked}
              key={idx}
              className={`poll__opt${picked ? ' is-picked' : ''}${lead ? ' is-lead' : ''}`}
              onClick={() => onVote(m.id, idx)}
            >
              <span className="poll__check" aria-hidden="true">
                {picked && (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                )}
              </span>
              <span className="poll__body">
                <span className="poll__row">
                  <span className="poll__label">{opt}</span>
                  <span className="poll__count">{count}</span>
                </span>
                <span className="poll__bar"><span className="poll__bar-fill" style={{ width: pct + '%' }} /></span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="poll__foot">
        <span className="poll__total">{total} {t(total === 1 ? 'vote' : 'votes', 'صوت')}</span>
        <button
          type="button"
          className={`poll__toggle${open ? ' is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={total === 0 && !open}
        >
          {open ? t('Hide votes', 'إخفاء الأصوات') : t('View votes', 'عرض الأصوات')}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {open && (
        <div className="poll__voters">
          {loading && !voters && <div className="poll__empty">{t('Loading…', 'جارٍ التحميل…')}</div>}
          {voters && voters.total === 0 && <div className="poll__empty">{t('No votes yet', 'لا توجد أصوات بعد')}</div>}
          {voters && voters.options.filter((o) => o.count > 0).map((o) => (
            <div className="poll__group" key={o.index}>
              <div className="poll__group-head">
                <span>{o.text}</span>
                <span>{o.count}</span>
              </div>
              {o.voters.map((v) => (
                <div className="poll__voter" key={v.id}>
                  <Avatar name={v.full_name} size="sm" src={v.avatar ? attachmentUrl(v.avatar) : undefined} />
                  <span className="poll__voter-name">{v.is_me ? t('You', 'أنت') : v.full_name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
