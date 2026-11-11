import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations } from '../../context/LanguageContext';
import { useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/dashboards/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/dashboards/index.php, talking to the
 * real JSON API (app/Controllers/Api/SavedDashboardsApiController.php,
 * /api/v1/data-analysis/dashboards/*). Widget catalog comes from
 * GET /dashboards/catalog (SavedDashboardService::WIDGETS/TEMPLATES —
 * real constants, not invented). A saved dashboard's widgets are only
 * ever hydrated with live data by GET /dashboards/{id} (SavedDashboardService
 * ::hydrate(), backed by AnalyticsService) — this page never computes or
 * fabricates any metric itself.
 */

export default function DataAnalysisDashboards() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [tab, setTab] = useState('mine');
  const [dashboards, setDashboards] = useState([]);
  const [shared, setShared] = useState([]);
  const [archived, setArchived] = useState([]);
  const [catalog, setCatalog] = useState({ widgets: {}, templates: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editing, setEditing] = useState(null); // dashboard object or {} for new, or null
  const [viewing, setViewing] = useState(null); // dashboard id or null

  const label = (obj) => obj?.[locale] || obj?.en || '';

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get('/api/v1/data-analysis/dashboards'),
      api.get('/api/v1/data-analysis/dashboards/catalog'),
    ])
      .then(([listJson, catalogJson]) => {
        setDashboards(listJson.data?.dashboards || []);
        setShared(listJson.data?.shared || []);
        setArchived(listJson.data?.archived || []);
        setCatalog({ widgets: catalogJson.data?.widgets || {}, templates: catalogJson.data?.templates || {} });
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

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

  const rows = tab === 'mine' ? dashboards : tab === 'shared' ? shared : archived;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Saved Dashboards')}</h1>
          <p className="text-small">{t('Build custom dashboards by dragging widgets into place — every widget shows live platform data.')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus-circle" size={16} /> {t('New Dashboard')}
        </button>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)' }}>{actionError}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <button type="button" className={`btn btn-sm ${tab === 'mine' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mine')}>{t('Mine')}</button>
        <button type="button" className={`btn btn-sm ${tab === 'shared' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('shared')}>{t('Shared with me')}</button>
        <button type="button" className={`btn btn-sm ${tab === 'archived' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('archived')}>{t('Archived')}</button>
      </div>

      {loading && <p className="text-small">…</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!loading && !error && (
        <div className="grid-3">
          {rows.map((d) => (
            <div key={d.id} className="card glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 className="text-h3" style={{ margin: 0 }}>{d.name}</h3>
                {Number(d.is_shared) ? <span className="badge badge-neutral">{t('Shared')}</span> : null}
              </div>
              <p className="text-caption">{Array.isArray(d.layout) ? d.layout.length : 0} {t('widgets')}</p>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setViewing(d.id)}><Icon name="eye" size={14} /> {t('View')}</button>
                {tab !== 'archived' && (
                  <>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(d)}><Icon name="edit" size={14} /> {t('Edit')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/dashboards/${d.id}/duplicate`))}><Icon name="copy" size={14} /> {t('Duplicate')}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/dashboards/${d.id}/share`))}>
                      <Icon name="link" size={14} /> {Number(d.is_shared) ? t('Unshare') : t('Share')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/dashboards/${d.id}/archive`))}><Icon name="archive" size={14} /> {t('Archive')}</button>
                  </>
                )}
                {tab === 'archived' && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => runAction(api.post(`/api/v1/data-analysis/dashboards/${d.id}/unarchive`))}><Icon name="refresh" size={14} /> {t('Restore')}</button>
                )}
                <a className="btn btn-ghost btn-sm" href={`/api/v1/data-analysis/dashboards/${d.id}/export`} target="_blank" rel="noreferrer"><Icon name="download" size={14} /> {t('Export')}</a>
                {tab !== 'shared' && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (confirm(t('Delete this dashboard permanently?'))) runAction(api.del(`/api/v1/data-analysis/dashboards/${d.id}`)); }}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-small">
              {tab === 'archived' ? t('No archived dashboards.') : tab === 'shared' ? t('No other analysts have shared a dashboard yet.') : t('No archived dashboards.')}
            </p>
          )}
        </div>
      )}

      {editing !== null && (
        <DashboardModal
          dashboard={editing}
          catalog={catalog}
          label={label}
          onClose={() => setEditing(null)}
          onDone={(err) => { setEditing(null); if (err) setActionError(err); else load(); }}
        />
      )}

      {viewing !== null && (
        <DashboardViewModal
          id={viewing}
          catalog={catalog}
          label={label}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function DashboardModal({ dashboard, catalog, label, onClose, onDone }) {
  const t = useTranslations(translations);
  const isNew = !dashboard.id;
  const [name, setName] = useState(dashboard.name || '');
  const [selected, setSelected] = useState(() => (dashboard.layout || []).map((w) => w.type));
  const [isShared, setIsShared] = useState(!!dashboard.is_shared);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggleWidget(type) {
    setSelected((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]));
  }

  function applyTemplate(key) {
    const tpl = catalog.templates[key];
    if (tpl) setSelected(tpl.widgets);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (selected.length === 0) {
      setError(t('At least one valid widget is required.') || 'At least one widget is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const layout = selected.map((type) => ({ type, size: 'md' }));
    try {
      if (isNew) {
        await api.post('/api/v1/data-analysis/dashboards', { name, layout, is_shared: isShared });
      } else {
        await api.patch(`/api/v1/data-analysis/dashboards/${dashboard.id}`, { name, layout, is_default: !!dashboard.is_default });
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
        <h2 className="modal-box__title text-h3">{isNew ? t('New Dashboard') : t('Edit')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">{t('Name')}</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          {Object.keys(catalog.templates || {}).length > 0 && (
            <div className="form-group">
              <label className="form-label">{t('Query Templates') /* reuse "templates" phrasing */}</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {Object.entries(catalog.templates).map(([key, tpl]) => (
                  <button key={key} type="button" className="btn btn-outline btn-sm" onClick={() => applyTemplate(key)}>
                    {label(tpl)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{t('widgets')}</label>
            {Object.entries(catalog.widgets || {}).map(([type, w]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0' }}>
                <input type="checkbox" id={`w-${type}`} checked={selected.includes(type)} onChange={() => toggleWidget(type)} />
                <Icon name={w.icon || 'grid'} size={16} />
                <label htmlFor={`w-${type}`}>{label(w)}</label>
              </div>
            ))}
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" id="is_shared" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
            <label className="form-label" htmlFor="is_shared" style={{ margin: 0 }}>{t('Share with other data analysts')}</label>
          </div>

          {error && <p className="form-error">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '…' : t('Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DashboardViewModal({ id, catalog, label, onClose }) {
  const t = useTranslations(translations);
  const [dashboard, setDashboard] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/api/v1/data-analysis/dashboards/${id}`)
      .then((json) => {
        setDashboard(json.data?.dashboard || null);
        setWidgets(json.data?.widgets || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" style={{ maxWidth: 900, width: '95%' }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{dashboard?.name || '…'}</h2>
        {loading && <p className="text-small">…</p>}
        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        {!loading && !error && (
          <div className="grid-2">
            {widgets.map((w, i) => (
              <div key={i} className="card glass-panel">
                <h4 className="text-h4" style={{ marginBottom: 'var(--space-2)' }}>{label(catalog.widgets?.[w.type]) || w.type}</h4>
                <WidgetPreview type={w.type} data={w.data} label={label} />
              </div>
            ))}
            {widgets.length === 0 && <p className="text-small">{t('No templates yet.')}</p>}
          </div>
        )}
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** Simple, honest rendering of each widget's live server data — no client-side computed numbers. */
function WidgetPreview({ type, data, label }) {
  if (data == null) return <p className="text-caption">—</p>;

  if (['kpis', 'academic_kpis', 'exam_kpis', 'exam_integrity'].includes(type) && typeof data === 'object' && !Array.isArray(data)) {
    return (
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {Object.entries(data).map(([k, v]) => (
          <div key={k}>
            <div className="text-caption">{k.replace(/_/g, ' ')}</div>
            <div className="text-h3">{v ?? '—'}</div>
          </div>
        ))}
      </div>
    );
  }

  if (Array.isArray(data)) {
    if (type === 'leaderboard') {
      return (
        <ol style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {data.map((r) => <li key={r.id} className="text-small">{label(r.university)} — {r.projects}</li>)}
        </ol>
      );
    }
    if (type === 'trends') {
      return (
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {data.map((r, i) => (
            <li key={i} className="text-small">{label(r.label)}: {r.current} ({r.growth_pct != null ? `${r.growth_pct}%` : '—'})</li>
          ))}
        </ul>
      );
    }
    // user_growth / users_by_role / category_dist share the {label,value} shape
    return (
      <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
        {data.map((r, i) => <li key={i} className="text-small">{label(r.label)}: {r.value}</li>)}
      </ul>
    );
  }

  if (type === 'university_map' && typeof data === 'object') {
    return (
      <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
        {Object.entries(data).map(([k, v]) => <li key={k} className="text-small">{k}: {JSON.stringify(v)}</li>)}
      </ul>
    );
  }

  return <p className="text-caption">{JSON.stringify(data)}</p>;
}
