import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/kpis/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/kpis/index.php, talking to the real
 * JSON API (app/Controllers/Api/DataAnalysisKpisApiController.php,
 * /api/v1/data-analysis/kpis/*). trend/growth_rate/achievement_pct are
 * computed server-side by KpiService from real recorded history — never
 * calculated here.
 */

const TREND_ICON = { up: 'trend', down: 'arrow-down', flat: 'arrow-right' };

export default function DataAnalysisKpis() {
  const t = useTranslations(translations);
  const [status, setStatus] = useState('active');
  const [kpis, setKpis] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editing, setEditing] = useState(null); // KPI object, or {} for new, or null
  const [recording, setRecording] = useState(null); // KPI object or null

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/kpis', { status })
      .then((json) => {
        setKpis(json.data?.kpis || []);
        setUsers(json.data?.users || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function runAction(promise) {
    setActionError(null);
    try {
      await promise;
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('KPI Management')}</h1>
          <p className="text-small">{t('Create, monitor, and evaluate key performance indicators against real targets.')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus-circle" size={16} /> {t('Create KPI')}
        </button>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button type="button" className={`btn btn-sm ${status === 'active' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatus('active')}>{t('View Active')}</button>
        <button type="button" className={`btn btn-sm ${status === 'archived' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setStatus('archived')}>{t('View Archived')}</button>
      </div>

      {loading && <p className="text-small">…</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && (
        <div className="grid-3">
          {kpis.map((k) => (
            <div key={k.id} className="card glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 className="text-h3" style={{ margin: 0 }}>{k.name}</h3>
                <Icon name={TREND_ICON[k.trend] || 'arrow-right'} size={18} />
              </div>
              {k.category && <span className="badge badge-neutral">{k.category}</span>}
              <div style={{ display: 'flex', gap: 'var(--space-4)', margin: 'var(--space-3) 0' }}>
                <div>
                  <div className="text-caption">{t('Current')}</div>
                  <div className="text-h3">{k.current_value}{k.unit || ''}</div>
                </div>
                <div>
                  <div className="text-caption">{t('Target')}</div>
                  <div className="text-h3">{k.target_value}{k.unit || ''}</div>
                </div>
                {k.achievement_pct !== null && k.achievement_pct !== undefined && (
                  <div>
                    <div className="text-caption">{t('Achievement')}</div>
                    <div className="text-h3">{Math.round(k.achievement_pct)}%</div>
                  </div>
                )}
              </div>
              {k.alert_enabled ? (
                <p className="text-caption">
                  {t('Alert threshold')}: {k.alert_threshold}{k.unit || ''}
                  {k.alert_triggered && <span className="badge badge-danger" style={{ marginInlineStart: 'var(--space-2)' }}>{t('Alert threshold crossed')}</span>}
                </p>
              ) : null}
              <p className="text-caption">
                {t('Assigned:')} {users.find((u) => String(u.id) === String(k.assigned_to))?.full_name || t('Unassigned')}
              </p>
              {k.recommendation && <p className="text-small">{k.recommendation}</p>}
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                {status === 'active' && (
                  <>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setRecording(k)}><Icon name="plus" size={14} /> {t('Record')}</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(k)}><Icon name="edit" size={14} /></button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/kpis/${k.id}/archive`))}><Icon name="archive" size={14} /> {t('Archive')}</button>
                  </>
                )}
                {status === 'archived' && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/kpis/${k.id}/restore`))}><Icon name="refresh" size={14} /> {t('Restore')}</button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (confirm(t('Permanently delete this KPI?'))) runAction(api.del(`/api/v1/data-analysis/kpis/${k.id}`)); }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
          {kpis.length === 0 && <p className="text-small">{t('No KPIs yet.')}</p>}
        </div>
      )}

      {editing !== null && (
        <KpiModal
          kpi={editing}
          users={users}
          onClose={() => setEditing(null)}
          onDone={(err) => { setEditing(null); if (err) setActionError(err); else load(); }}
        />
      )}
      {recording && (
        <RecordModal
          kpi={recording}
          onClose={() => setRecording(null)}
          onDone={(err) => { setRecording(null); if (err) setActionError(err); else load(); }}
        />
      )}
    </>
  );
}

function KpiModal({ kpi, users, onClose, onDone }) {
  const t = useTranslations(translations);
  const isNew = !kpi.id;
  const [name, setName] = useState(kpi.name || '');
  const [description, setDescription] = useState(kpi.description || '');
  const [category, setCategory] = useState(kpi.category || '');
  const [unit, setUnit] = useState(kpi.unit || '');
  const [currentValue, setCurrentValue] = useState(kpi.current_value ?? '');
  const [targetValue, setTargetValue] = useState(kpi.target_value ?? '');
  const [direction, setDirection] = useState(kpi.direction || 'higher_better');
  const [assignedTo, setAssignedTo] = useState(kpi.assigned_to || '');
  const [alertEnabled, setAlertEnabled] = useState(!!kpi.alert_enabled);
  const [alertThreshold, setAlertThreshold] = useState(kpi.alert_threshold ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name, description, category, unit,
      target_value: targetValue,
      direction, assigned_to: assignedTo || null,
      alert_enabled: alertEnabled, alert_threshold: alertThreshold,
    };
    if (isNew) payload.current_value = currentValue;
    try {
      if (isNew) {
        await api.post('/api/v1/data-analysis/kpis', payload);
      } else {
        await api.patch(`/api/v1/data-analysis/kpis/${kpi.id}`, payload);
      }
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{isNew ? t('Create a KPI') : t('Record value / Edit / Delete')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('KPI name')}</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Description (optional)')}</label>
            <textarea className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">{t('Category (optional)')}</label>
              <input className="form-input" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">{t('Unit, e.g. %')}</label>
              <input className="form-input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            {isNew && (
              <div className="form-group">
                <label className="form-label">{t('Current value')}</label>
                <input className="form-input" type="number" step="any" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} required />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">{t('Target')}</label>
              <input className="form-input" type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Trend')}</label>
            <select className="form-input" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="higher_better">{t('Higher is better')}</option>
              <option value="lower_better">{t('Lower is better')}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{t('Assigned:')}</label>
            <select className="form-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">{t('Unassigned')}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={alertEnabled} onChange={(e) => setAlertEnabled(e.target.checked)} id="alert_enabled" />
            <label className="form-label" htmlFor="alert_enabled" style={{ margin: 0 }}>{t('Enable alert')}</label>
          </div>
          {alertEnabled && (
            <div className="form-group">
              <label className="form-label">{t('Alert threshold (optional)')}</label>
              <input className="form-input" type="number" step="any" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)} />
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save changes')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecordModal({ kpi, onClose, onDone }) {
  const t = useTranslations(translations);
  const [value, setValue] = useState(kpi.current_value ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/v1/data-analysis/kpis/${kpi.id}/record-value`, { value, note: note || null });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{kpi.name}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('New value')}</label>
            <input className="form-input" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">{t('Note (optional)')}</label>
            <input className="form-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Record')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
