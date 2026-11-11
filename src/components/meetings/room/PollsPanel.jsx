import { useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 7 (Collaboration Extras) — بند 21 (Polls). Same slide-in panel
 * approach as everything else here. `poll.options[].voters` is only
 * present when `!poll.is_anonymous` (see MeetingPollService::results()'s
 * own docblock) — this panel doesn't track "did I vote for this option"
 * beyond that (no separate "my vote" field comes back from the backend),
 * so an anonymous poll just shows bars with no highlight on your own
 * pick; a named one lets you infer it from the voters list. Vote
 * selection is local `selections` state keyed by poll_id, cleared once
 * the vote actually lands (results replace the poll's own local echo of
 * "what you picked" — you can always change it again before the poll
 * closes).
 */
export default function PollsPanel({ polls, isManager, isOpen, onClose, onCreate, onVote, onClosePoll }) {
  const t = useTranslations(translations);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [pollType, setPollType] = useState('single_choice');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [options, setOptions] = useState(['', '']);
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [selections, setSelections] = useState({}); // poll_id -> Set(option_id)
  const [busyPollId, setBusyPollId] = useState(null);

  if (!isOpen) return null;

  function updateOption(index, value) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }
  function addOption() {
    setOptions((prev) => (prev.length >= 10 ? prev : [...prev, '']));
  }
  function removeOption(index) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(e) {
    e.preventDefault();
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2 || creating) return;
    setCreating(true);
    setFormError(null);
    try {
      await onCreate({ question: question.trim(), poll_type: pollType, is_anonymous: isAnonymous, options: cleanOptions });
      setQuestion('');
      setOptions(['', '']);
      setPollType('single_choice');
      setIsAnonymous(false);
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || t('This action could not be completed.'));
    } finally {
      setCreating(false);
    }
  }

  function toggleSelection(pollId, optionId, single) {
    setSelections((prev) => {
      const current = new Set(prev[pollId] || []);
      if (single) {
        current.clear();
        current.add(optionId);
      } else if (current.has(optionId)) {
        current.delete(optionId);
      } else {
        current.add(optionId);
      }
      return { ...prev, [pollId]: current };
    });
  }

  async function submitVote(poll) {
    const chosen = Array.from(selections[poll.poll_id] || []);
    if (chosen.length === 0) return;
    setBusyPollId(poll.poll_id);
    try {
      await onVote(poll.poll_id, chosen);
    } catch {
      // vote is rejected/re-checked server-side (e.g. poll closed between render and click) —
      // the panel just leaves the selection in place for the person to notice and retry.
    } finally {
      setBusyPollId(null);
    }
  }

  async function handleClose(pollId) {
    if (!window.confirm(t('Close this poll? No more votes will be accepted.'))) return;
    setBusyPollId(pollId);
    try {
      await onClosePoll(pollId);
    } catch {
      // same as submitVote above.
    } finally {
      setBusyPollId(null);
    }
  }

  return (
    <div className="meeting-chat-panel">
      <div className="meeting-chat-panel__header">
        <strong>{t('Polls')}</strong>
        <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{polls.length}</span>
        {isManager && (
          <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: 'auto' }} onClick={() => setShowForm((v) => !v)} title={t('New Poll')}>
            <Icon name="plus" size={16} />
          </button>
        )}
        <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: isManager ? 6 : 'auto' }} onClick={onClose} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="meeting-chat-panel__list">
        {showForm && (
          <form onSubmit={handleCreate} className="meeting-notes-panel__form">
            <input
              type="text"
              className="form-input"
              placeholder={t('Ask a question…')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              required
            />
            {options.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder={`${t('Option')} ${i + 1}`}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  maxLength={255}
                />
                {options.length > 2 && (
                  <button type="button" className="meeting-room__control-btn" style={{ width: 34, height: 34, flexShrink: 0 }} onClick={() => removeOption(i)} title={t('Remove')}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn-outline btn-sm" onClick={addOption} disabled={options.length >= 10}>
              <Icon name="plus" size={13} /> {t('Add Option')}
            </button>
            <select className="form-select" value={pollType} onChange={(e) => setPollType(e.target.value)}>
              <option value="single_choice">{t('Single choice')}</option>
              <option value="multiple_choice">{t('Multiple choice')}</option>
            </select>
            <label className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
              {t('Anonymous voting')}
            </label>
            {formError && <p className="form-error" style={{ margin: 0 }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !question.trim()}>
                {creating ? '…' : t('Launch Poll')}
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowForm(false)}>{t('Cancel')}</button>
            </div>
          </form>
        )}

        {polls.length === 0 && !showForm && (
          <p className="text-caption" style={{ color: 'var(--mr-muted)', textAlign: 'center', marginTop: 'var(--space-4)' }}>
            {t('No polls yet.')}
          </p>
        )}

        {[...polls].reverse().map((poll) => {
          const single = poll.poll_type === 'single_choice';
          const isOpenPoll = poll.status === 'open';
          const chosen = selections[poll.poll_id] || new Set();
          const busy = busyPollId === poll.poll_id;
          return (
            <div key={poll.poll_id} className="meeting-polls-panel__card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <strong className="text-small">{poll.question}</strong>
                <span className={`badge ${isOpenPoll ? 'badge-success' : 'badge-neutral'}`} style={{ flexShrink: 0 }}>
                  {isOpenPoll ? t('Open') : t('Closed')}
                </span>
              </div>
              <div className="text-caption" style={{ color: 'var(--mr-muted)', margin: '2px 0 8px' }}>
                {poll.total_votes} {t('votes')}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {poll.options.map((opt) => {
                  const selected = chosen.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!isOpenPoll || busy}
                      onClick={() => toggleSelection(poll.poll_id, opt.id, single)}
                      className={`meeting-polls-panel__option ${selected ? 'is-selected' : ''}`}
                    >
                      <span className="meeting-polls-panel__option-bar" style={{ width: `${opt.percentage}%` }} />
                      <span className="meeting-polls-panel__option-label">{opt.option_text}</span>
                      <span className="meeting-polls-panel__option-pct">{opt.percentage}% ({opt.vote_count})</span>
                    </button>
                  );
                })}
              </div>

              {isOpenPoll && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy || chosen.size === 0} onClick={() => submitVote(poll)}>
                    {t('Vote')}
                  </button>
                  {isManager && (
                    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => handleClose(poll.poll_id)}>
                      {t('Close Poll')}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
