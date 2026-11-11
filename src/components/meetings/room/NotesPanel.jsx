import { useEffect, useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const TYPE_META = {
  decision: { icon: 'check-circle', labelKey: 'Decision' },
  action_item: { icon: 'pin', labelKey: 'Action Item' },
  task: { icon: 'check-circle', labelKey: 'Task' },
};

/**
 * Round 7 (Collaboration Extras) — بند 20 (Meeting Notes + Action Items).
 * Same slide-in panel approach as everything else in this module — two
 * sections stacked in one panel rather than two separate panels/buttons,
 * since the backend itself treats them as one bند with one service
 * (MeetingNotesService covers both).
 *
 * Notes body: manager-only edit (a plain textarea + explicit Save button,
 * not autosave-on-keystroke — MeetingNotesUpdated::broadcastWith() sends
 * the *full* body each time, so hammering the endpoint on every keystroke
 * would spam every other participant's screen with the same "last-write-
 * wins" replace on every character). Local edits are tracked in `draft`
 * so a non-manager's read-only view (`notes.body` straight from the hook)
 * is never clobbered by someone else's in-progress typing.
 *
 * Action items: manager-only create/edit/delete; anyone can see the list
 * and toggle done/open is also manager-only per the backend
 * (MeetingNotesService::updateItem requires manager) — no "assignee can
 * mark their own item done" carve-out in the spec, so this mirrors that.
 */
export default function NotesPanel({
  notes, actionItems, isManager, isOpen, onClose, onUpdateNotes, onCreateItem, onUpdateItem, onDeleteItem,
}) {
  const t = useTranslations(translations);
  const [draft, setDraft] = useState(notes.body || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState(null);
  const [notesDirty, setNotesDirty] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('task');
  const [formTitle, setFormTitle] = useState('');
  const [formAssignee, setFormAssignee] = useState('');
  const [formDueAt, setFormDueAt] = useState('');
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);

  useEffect(() => {
    if (!notesDirty) setDraft(notes.body || '');
  }, [notes.body, notesDirty]);

  if (!isOpen) return null;

  async function handleSaveNotes() {
    setSavingNotes(true);
    setNotesError(null);
    try {
      await onUpdateNotes(draft);
      setNotesDirty(false);
    } catch (err) {
      setNotesError(err?.message || t('This action could not be completed.'));
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleCreateItem(e) {
    e.preventDefault();
    if (!formTitle.trim() || creating) return;
    setCreating(true);
    setFormError(null);
    try {
      await onCreateItem({
        type: formType,
        title: formTitle.trim(),
        assignee_display_name: formAssignee.trim() || null,
        due_at: formDueAt || null,
      });
      setFormTitle('');
      setFormAssignee('');
      setFormDueAt('');
      setShowForm(false);
    } catch (err) {
      setFormError(err?.message || t('This action could not be completed.'));
    } finally {
      setCreating(false);
    }
  }

  async function toggleDone(item) {
    setBusyItemId(item.id);
    try {
      await onUpdateItem(item.id, { status: item.status === 'done' ? 'open' : 'done' });
    } catch {
      // no per-row error surface here — a failed toggle just leaves the checkbox as-is.
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleDeleteItem(itemId) {
    if (!window.confirm(t('Remove this item?'))) return;
    setBusyItemId(itemId);
    try {
      await onDeleteItem(itemId);
    } catch {
      // same as toggleDone above.
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <div className="meeting-chat-panel meeting-notes-panel">
      <div className="meeting-chat-panel__header">
        <strong>{t('Notes & Action Items')}</strong>
        <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: 'auto' }} onClick={onClose} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="meeting-chat-panel__list" style={{ gap: 'var(--space-4)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="text-caption" style={{ fontWeight: 700 }}>{t('Meeting Notes')}</span>
            {notes.lastEditedByDisplayName && (
              <span className="text-caption" style={{ color: 'var(--mr-muted)' }}>
                {t('Last edited by')} {notes.lastEditedByDisplayName}
              </span>
            )}
          </div>
          {isManager ? (
            <>
              <textarea
                className="form-input meeting-notes-panel__textarea"
                rows={6}
                maxLength={20000}
                placeholder={t('Agenda, decisions, free-form notes…')}
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setNotesDirty(true); }}
              />
              {notesError && <p className="form-error" style={{ margin: '4px 0 0' }}>{notesError}</p>}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: 6 }}
                disabled={savingNotes || !notesDirty}
                onClick={handleSaveNotes}
              >
                {savingNotes ? '…' : t('Save Notes')}
              </button>
            </>
          ) : (
            <p className="text-small meeting-notes-panel__readonly">
              {notes.body || t('No notes yet.')}
            </p>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="text-caption" style={{ fontWeight: 700 }}>{t('Action Items')}</span>
            {isManager && (
              <button type="button" className="meeting-room__control-btn" style={{ width: 28, height: 28 }} onClick={() => setShowForm((v) => !v)} title={t('Add Item')}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </div>

          {showForm && (
            <form onSubmit={handleCreateItem} className="meeting-notes-panel__form">
              <select className="form-select" value={formType} onChange={(e) => setFormType(e.target.value)}>
                <option value="task">{t('Task')}</option>
                <option value="action_item">{t('Action Item')}</option>
                <option value="decision">{t('Decision')}</option>
              </select>
              <input
                type="text"
                className="form-input"
                placeholder={t('Title')}
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={500}
                required
              />
              <input
                type="text"
                className="form-input"
                placeholder={t('Assignee (optional)')}
                value={formAssignee}
                onChange={(e) => setFormAssignee(e.target.value)}
                maxLength={255}
              />
              <input type="date" className="form-input" value={formDueAt} onChange={(e) => setFormDueAt(e.target.value)} />
              {formError && <p className="form-error" style={{ margin: 0 }}>{formError}</p>}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !formTitle.trim()}>
                  {creating ? '…' : t('Add')}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowForm(false)}>{t('Cancel')}</button>
              </div>
            </form>
          )}

          {actionItems.length === 0 ? (
            <p className="text-caption" style={{ color: 'var(--mr-muted)' }}>{t('No action items yet.')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actionItems.map((item) => {
                const meta = TYPE_META[item.type] || TYPE_META.task;
                const busy = busyItemId === item.id;
                return (
                  <div key={item.id} className="meeting-notes-panel__item">
                    <button
                      type="button"
                      className={`meeting-notes-panel__item-check ${item.status === 'done' ? 'is-done' : ''}`}
                      disabled={!isManager || busy}
                      onClick={() => toggleDone(item)}
                      title={item.status === 'done' ? t('Mark as open') : t('Mark as done')}
                    >
                      <Icon name={item.status === 'done' ? 'check-circle' : meta.icon} size={16} />
                    </button>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className={`text-small ${item.status === 'done' ? 'meeting-notes-panel__item-title--done' : ''}`}>{item.title}</div>
                      <div className="text-caption" style={{ color: 'var(--mr-muted)' }}>
                        {t(meta.labelKey)}
                        {item.assignee_display_name ? ` · ${item.assignee_display_name}` : ''}
                        {item.due_at ? ` · ${new Date(item.due_at).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    {isManager && (
                      <button type="button" className="meeting-room__control-btn" style={{ width: 28, height: 28, color: '#f87171' }} disabled={busy} onClick={() => handleDeleteItem(item.id)} title={t('Remove')}>
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
