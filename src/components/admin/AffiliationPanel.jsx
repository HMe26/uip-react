import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { ConfirmModal } from './adminUi';
import { useTranslations } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/users';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * University / faculty / department affiliation of a user (Admin > User Details).
 * Backed by:
 *   user.affiliation                        (GET /admin/users/{uuid})
 *   GET    /admin/users/affiliation-options  universities + faculties/departments
 *   PUT    /admin/users/{uuid}/affiliation   link / move
 *   DELETE /admin/users/{uuid}/affiliation   unlink (students only)
 *
 * What each kind can do is decided by the API (`editable`, `can_detach`); this
 * component only renders it. Kinds: student, supervisor, academic_staff, faculty,
 * university, none (admin / investor / ... — no university link).
 */

const KIND_LABEL = {
  student: 'Student', supervisor: 'Supervisor', academic_staff: 'Academic staff',
  faculty: 'Faculty account', university: 'University account',
};

function Fact({ label, children }) {
  return <div className="adm-fact"><small>{label}</small><strong>{children ?? '—'}</strong></div>;
}

export default function AffiliationPanel({ user, onChanged }) {
  const t = useTranslations(translations);
  const aff = user.affiliation || { kind: 'none' };
  const name = (o) => (o ? L(t, o.name_en, o.name_ar) : null);

  const [editing, setEditing] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function detach() {
    setBusy(true); setError(null);
    try {
      const res = await api.del(`/api/v1/admin/users/${user.uuid}/affiliation`);
      const n = res?.data?.changed?.projects_moved || 0;
      setNotice(n > 0 ? t('Removed from the university. {n} unfinished project(s) were detached from it.').replace('{n}', n) : t('Removed from the university.'));
      setConfirmDetach(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDetach(false);
    } finally {
      setBusy(false);
    }
  }

  const c = aff.counts || {};
  const uni = aff.university;

  return (
    <div className="adm-panel">
      <div className="adm-panel__head">
        <div>
          <h3>{t('University affiliation')}</h3>
          <p>{aff.kind === 'none'
            ? t('This account type is not linked to a university.')
            : `${t(KIND_LABEL[aff.kind] || aff.kind)}`}</p>
        </div>
        {aff.editable && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} /> {uni ? t('Change university') : t('Link to a university')}
            </button>
            {aff.can_detach && uni && (
              <button type="button" className="btn btn-outline btn-sm adm-btn-danger" onClick={() => setConfirmDetach(true)}>
                <Icon name="x-circle" size={14} /> {t('Remove from university')}
              </button>
            )}
          </div>
        )}
      </div>

      {notice && <p className="ap-notice" role="status">{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      {aff.kind === 'none' && (
        <p className="adm-empty">{t('Admins, investors and researchers have no university, faculty or department.')}</p>
      )}

      {aff.kind !== 'none' && (
        <>
          {!uni && aff.kind === 'student' && (
            <p className="adm-empty">
              {t('This student is not linked to any university.')}
              {aff.pending_request ? ` ${t('Pending join request to')} ${name(aff.pending_request)}.` : ''}
            </p>
          )}
          {uni?.deleted && <p className="form-error">{t('This university was deleted. Restore it, or move the account to another university.')}</p>}
          {aff.suspended_by_university && !uni?.deleted && (
            <p className="form-error">{t('The account was suspended because its university was removed.')}</p>
          )}

          <div className="adm-facts">
            <Fact label={t('University')}>{name(uni)}</Fact>
            {aff.kind !== 'supervisor' && aff.kind !== 'university' && <Fact label={t('Faculty')}>{name(aff.faculty)}</Fact>}
            {(aff.kind === 'student' || aff.kind === 'academic_staff') && <Fact label={t('Department')}>{name(aff.department)}</Fact>}
            {aff.kind === 'student' && <Fact label={t('Student number')}>{aff.student_number}</Fact>}
            {aff.kind === 'student' && <Fact label={t('Group')}>{aff.group}</Fact>}
            {aff.kind === 'supervisor' && <Fact label={t('Assignments')}>{c.assignments ?? 0}</Fact>}
            {aff.kind === 'academic_staff' && <Fact label={t('Active positions')}>{c.assignments ?? 0}</Fact>}
            {aff.kind === 'student' && <Fact label={t('Projects')}>{c.projects ?? 0}</Fact>}
            {aff.kind === 'university' && (<>
              <Fact label={t('Students')}>{c.students ?? 0}</Fact>
              <Fact label={t('Supervisors')}>{c.supervisors ?? 0}</Fact>
              <Fact label={t('Academic staff')}>{c.academic_staff ?? 0}</Fact>
              <Fact label={t('Faculties')}>{c.faculties ?? 0}</Fact>
            </>)}
            {aff.kind === 'faculty' && (<>
              <Fact label={t('Departments')}>{c.departments ?? 0}</Fact>
              <Fact label={t('Students')}>{c.students ?? 0}</Fact>
              <Fact label={t('Academic staff')}>{c.academic_staff ?? 0}</Fact>
            </>)}
          </div>

          {!aff.editable && aff.kind === 'faculty' && <p className="adm-muted" style={{ marginTop: 10 }}>{t('A faculty account is the faculty itself. Its university is managed from the university portal.')}</p>}
          {!aff.editable && aff.kind === 'university' && <p className="adm-muted" style={{ marginTop: 10 }}>{t('A university account is the university itself, so it has no parent to move to.')}</p>}
          {aff.editable && !aff.can_detach && aff.detach_blocked_reason && <p className="adm-muted" style={{ marginTop: 10 }}>{t(aff.detach_blocked_reason)}</p>}
        </>
      )}

      {editing && (
        <AffiliationModal
          user={user}
          aff={aff}
          onClose={() => setEditing(false)}
          onSaved={(res) => {
            setEditing(false);
            const ch = res?.data?.changed || {};
            const bits = [];
            if (ch.projects_moved > 0) bits.push(t('{n} unfinished project(s) moved with them.').replace('{n}', ch.projects_moved));
            if (ch.assignments_removed > 0) bits.push(t('{n} old assignment(s) were closed.').replace('{n}', ch.assignments_removed));
            setNotice([t('Affiliation updated.'), ...bits].join(' '));
            onChanged();
          }}
        />
      )}
      {confirmDetach && (
        <ConfirmModal
          title={t('Remove from university')}
          message={t('Remove {name} from {uni}? Their faculty, department and group will be cleared, unfinished projects will be detached from the university, and any pending join request will be rejected. They keep their account and can join a university again.')
            .replace('{name}', user.full_name).replace('{uni}', name(uni) || '')}
          confirmLabel={t('Remove')}
          danger
          busy={busy}
          onConfirm={detach}
          onClose={() => setConfirmDetach(false)}
        />
      )}
    </div>
  );
}

function AffiliationModal({ user, aff, onClose, onSaved }) {
  const t = useTranslations(translations);
  const kind = aff.kind;
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uniId, setUniId] = useState(aff.university?.id ? String(aff.university.id) : '');
  const [facultyId, setFacultyId] = useState(aff.faculty?.id ? String(aff.faculty.id) : '');
  const [deptId, setDeptId] = useState(aff.department?.id ? String(aff.department.id) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api/v1/admin/users/affiliation-options')
      .then((j) => setOptions(j.data || []))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const uni = useMemo(() => options.find((u) => String(u.id) === uniId), [options, uniId]);
  const faculty = useMemo(() => uni?.faculties.find((f) => String(f.id) === facultyId), [uni, facultyId]);

  const showFaculty = kind === 'student' || kind === 'academic_staff';
  const moving = aff.university && uniId && String(aff.university.id) !== uniId;
  const opt = (o) => <option key={o.id} value={o.id}>{L(t, o.name_en, o.name_ar)}</option>;

  const warnings = {
    student: t('Moving a student clears their group and expected graduation date, moves unfinished projects (draft / submitted / under review / rejected) to the new university, and rejects any pending join request. Approved or published projects stay where they are.'),
    supervisor: t('Moving a supervisor closes all their scope/project assignments, because they belong to the old university.'),
    academic_staff: t('Moving academic staff closes their active positions (dean, head of department...) because they belong to the old university.'),
  };

  async function submit(e) {
    e.preventDefault();
    if (!uniId) { setError(t('Select a university.')); return; }
    setSaving(true); setError(null);
    try {
      const res = await api.put(`/api/v1/admin/users/${user.uuid}/affiliation`, {
        university_id: Number(uniId),
        faculty_id: showFaculty && facultyId ? Number(facultyId) : null,
        department_id: showFaculty && deptId ? Number(deptId) : null,
      });
      onSaved(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{aff.university ? t('Change university') : t('Link to a university')}</h2>
        {loading ? <p className="text-small">{t('Loading…')}</p> : (
          <form onSubmit={submit}>
            <div className="form-group">
              <label className="form-label">{t('University')}</label>
              <select className="form-input" value={uniId} onChange={(e) => { setUniId(e.target.value); setFacultyId(''); setDeptId(''); }}>
                <option value="">{t('Select a university…')}</option>
                {options.map(opt)}
              </select>
            </div>
            {showFaculty && (
              <div className="form-group">
                <label className="form-label">{t('Faculty')} <small>({t('optional')})</small></label>
                <select className="form-input" value={facultyId} disabled={!uni} onChange={(e) => { setFacultyId(e.target.value); setDeptId(''); }}>
                  <option value="">{t('No faculty')}</option>
                  {(uni?.faculties || []).map(opt)}
                </select>
              </div>
            )}
            {showFaculty && (
              <div className="form-group">
                <label className="form-label">{t('Department')} <small>({t('optional')})</small></label>
                <select className="form-input" value={deptId} disabled={!faculty} onChange={(e) => { setDeptId(e.target.value); }}>
                  <option value="">{t('No department')}</option>
                  {(faculty?.departments || []).map(opt)}
                </select>
              </div>
            )}
            {(moving || !aff.university) && warnings[kind] && <p className="adm-modal-text">{warnings[kind]}</p>}
            {error && <p className="form-error">{error}</p>}
            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !uniId}>{saving ? t('Saving…') : t('Save')}</button>
            </div>
          </form>
        )}
        {loading === false && error && options.length === 0 && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}
