import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { invitationsApi } from '../../lib/meetingSignaling';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/**
 * Round 8 (Invitations & Calendar) — بند 13 ("The host should be able to
 * invite: Specific users, Students, Academic staff,
 * Supervisors, Faculties, Universities, Groups, Project
 * members" + "must respect UIPE roles and permissions"). Used from
 * MeetingDetails.jsx, host/co-host only (the page already gates rendering
 * this on `isManager` — mirrors the backend's own canManage() check on
 * both endpoints this talks to).
 *
 * Two tabs mirroring the two backend endpoints exactly rather than trying
 * to unify them into one form: "Single" hits the Round 1
 * MeetingsApiController::storeInvitation() (one user_id), "Bulk" hits the
 * Round 8 MeetingsInvitationsApiController::bulk() (targets[] array —
 * this UI always sends exactly one target per submit, since the backend
 * itself resolves+unions any number of targets and picking several target
 * types in one go isn't a distinct UIPE requirement here).
 *
 * The bulk target fields (university_id/faculty_id/department_id/
 * group_id/project_id) are plain numeric-ID inputs rather than live
 * search pickers: there's no generic "list faculties/groups/projects for
 * an arbitrary university" endpoint on this backend for a non-owner host
 * to browse (FacultyApiController::index is restricted to the university
 * account's own faculties, for example) — see MeetingInvitationService's
 * own docblock for the scope check each of these triggers server-side
 * (`requireOwnUniversity`/`requireAdmin`), which is what actually decides
 * whether a given ID is invite-able, not anything client-side.
 */

const BULK_TYPES = [
  { value: 'users', label: 'Multiple users (by ID)', fields: ['user_ids'] },
  { value: 'students', label: 'All students of a university', fields: ['university_id', 'faculty_id', 'department_id'] },
  { value: 'academic_staff', label: 'All academic staff of a university', fields: ['university_id', 'faculty_id', 'department_id'] },
  { value: 'supervisors', label: 'All supervisors of a university', fields: ['university_id'] },
  { value: 'faculties', label: 'All faculties of a university', fields: ['university_id'] },
  { value: 'universities', label: 'University accounts (admin only)', fields: ['university_ids'] },
  { value: 'group', label: 'A student group', fields: ['group_id'] },
  { value: 'project', label: 'A project (owner + team)', fields: ['project_id'] },
];

const FIELD_META = {
  university_id: { label: 'University ID', type: 'number' },
  faculty_id: { label: 'Faculty ID (optional)', type: 'number' },
  department_id: { label: 'Department ID (optional)', type: 'number' },
  group_id: { label: 'Group ID', type: 'number' },
  project_id: { label: 'Project ID', type: 'number' },
  user_ids: { label: 'User IDs (comma-separated)', type: 'text' },
  university_ids: { label: 'University IDs (optional, comma-separated — leave blank for all)', type: 'text' },
};

function splitIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export default function InviteModal({ meetingUuid, onClose, onSent }) {
  const t = useTranslations(translations);
  const [tab, setTab] = useState('single');

  // -- Single invite ------------------------------------------------------
  // The field takes the invitee's e-mail (the backend looks the account up and
  // e-mails them the meeting details + link) — or, as before, a numeric user ID.
  const [userId, setUserId] = useState('');
  const [singleMessage, setSingleMessage] = useState('');
  const [singleSaving, setSingleSaving] = useState(false);
  const [singleError, setSingleError] = useState(null);
  const [singleResult, setSingleResult] = useState(null); // { byEmail, emailSent, emailError }

  async function handleSingleSubmit(e) {
    e.preventDefault();
    setSingleSaving(true);
    setSingleError(null);
    try {
      const value = userId.trim();
      const byEmail = !/^\d+$/.test(value);
      const payload = byEmail ? { email: value } : { user_id: Number(value) };
      const json = await invitationsApi.send(meetingUuid, { ...payload, message: singleMessage.trim() || undefined });
      if (byEmail) {
        // Stay open so the host sees whether the e-mail actually went out.
        setSingleResult({ byEmail: true, emailSent: json?.data?.email_sent === true, emailError: json?.data?.email_error || null });
      } else {
        onSent();
      }
    } catch (err) {
      setSingleError(errorMessage(err) || t('This invitation could not be sent.'));
    } finally {
      setSingleSaving(false);
    }
  }

  // -- Bulk invite ----------------------------------------------------------
  const [bulkType, setBulkType] = useState('students');
  const [bulkFields, setBulkFields] = useState({});
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);

  const activeType = BULK_TYPES.find((bt) => bt.value === bulkType) || BULK_TYPES[0];

  function setField(name, value) {
    setBulkFields((prev) => ({ ...prev, [name]: value }));
  }

  function buildTarget() {
    const target = { type: bulkType };
    for (const name of activeType.fields) {
      const raw = bulkFields[name];
      if (name === 'user_ids') {
        target.user_ids = splitIds(raw);
      } else if (name === 'university_ids') {
        const ids = splitIds(raw);
        if (ids.length) target.university_ids = ids;
      } else if (raw !== undefined && raw !== '') {
        target[name] = Number(raw);
      }
    }
    return target;
  }

  async function handleBulkSubmit(e) {
    e.preventDefault();
    setBulkSaving(true);
    setBulkError(null);
    setBulkResult(null);
    try {
      const json = await invitationsApi.bulk(meetingUuid, {
        targets: [buildTarget()],
        message: bulkMessage.trim() || undefined,
      });
      setBulkResult(json.data);
      onSent();
    } catch (err) {
      setBulkError(errorMessage(err) || t('This invitation could not be sent.'));
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Invite People')}</h2>

        <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
          <button type="button" className={`tab-link${tab === 'single' ? ' is-active' : ''}`} onClick={() => setTab('single')}>
            {t('Single Invite')}
          </button>
          <button type="button" className={`tab-link${tab === 'bulk' ? ' is-active' : ''}`} onClick={() => setTab('bulk')}>
            {t('Bulk Invite')}
          </button>
        </div>

        {tab === 'single' && singleResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p className={singleResult.emailSent ? 'text-small' : 'form-error'} style={singleResult.emailSent ? { color: 'var(--color-success, inherit)' } : undefined}>
              {singleResult.emailSent
                ? t('Invitation sent — an email with the meeting details and link was sent to the invitee.')
                : t('Invitation recorded, but the email could not be sent.')}
            </p>
            {!singleResult.emailSent && singleResult.emailError && (
              <p className="text-small" dir="ltr">{singleResult.emailError}</p>
            )}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-primary" onClick={() => onSent()}>{t('Done')}</button>
            </div>
          </div>
        ) : tab === 'single' ? (
          <form onSubmit={handleSingleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label className="form-label">{t('User email (or user ID)')}</label>
              <input
                className="form-input"
                type="text"
                inputMode="email"
                dir="ltr"
                autoComplete="off"
                placeholder="name@gmail.com"
                required
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
              <p className="text-small" style={{ marginTop: 'var(--space-1, 4px)', opacity: 0.75 }}>
                {t('The invitee receives an email with the meeting details and link.')}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">{t('Message (optional)')}</label>
              <textarea className="form-input" rows={3} maxLength={500} value={singleMessage} onChange={(e) => setSingleMessage(e.target.value)} />
            </div>
            {singleError && <p className="form-error">{singleError}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
              <button type="submit" className="btn btn-primary" disabled={singleSaving || !userId.trim()}>
                {singleSaving ? t('Sending…') : t('Send Invite')}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleBulkSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label className="form-label">{t('Who to invite')}</label>
              <select className="form-input" value={bulkType} onChange={(e) => { setBulkType(e.target.value); setBulkFields({}); }}>
                {BULK_TYPES.map((bt) => (
                  <option key={bt.value} value={bt.value}>{t(bt.label)}</option>
                ))}
              </select>
            </div>

            {activeType.fields.map((name) => {
              const meta = FIELD_META[name];
              return (
                <div className="form-group" key={name}>
                  <label className="form-label">{t(meta.label)}</label>
                  <input
                    className="form-input"
                    type={meta.type}
                    required={meta.type === 'number'}
                    value={bulkFields[name] || ''}
                    onChange={(e) => setField(name, e.target.value)}
                  />
                </div>
              );
            })}

            <div className="form-group">
              <label className="form-label">{t('Message (optional)')}</label>
              <textarea className="form-input" rows={3} maxLength={500} value={bulkMessage} onChange={(e) => setBulkMessage(e.target.value)} />
            </div>

            {bulkError && <p className="form-error">{bulkError}</p>}
            {bulkResult && (
              <p className="text-small" style={{ color: 'var(--color-success, inherit)' }}>
                {bulkResult.invited_count} {t('people invited')}
                {bulkResult.skipped_self_or_host ? ` · ${bulkResult.skipped_self_or_host} ${t('skipped (already host or duplicate)')}` : ''}
              </p>
            )}

            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{t('Close')}</button>
              <button type="submit" className="btn btn-primary" disabled={bulkSaving}>
                {bulkSaving ? t('Sending…') : t('Send Invite')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
