import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Drawer, Panel, fmt } from '../../components/insight/charts';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/segments';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Mirrors app/Views/data-analysis/segments.php, talking to the real JSON
 * API (app/Controllers/Api/DataAnalysisSegmentsApiController.php,
 * /api/v1/data-analysis/segments/* — new, thin wrapper added alongside
 * this page; reuses App\Repositories\DataSegmentRepository exactly as
 * the server-rendered view already does — criteria are evaluated live
 * against the real projects/users tables, so matched_count is always
 * current, not cached). Same isDataAnalyst() gate (data_analyst OR
 * admin) already enforced server-side.
 *
 * Entity/role/status option lists come straight from the PHP view's own
 * $entityLabel/$roleOptions/$userStatusOptions arrays (real EN/AR pairs,
 * not invented). role_options/user_status_options for the "users" entity
 * form are also returned by the API (DataSegmentRepository::USER_ROLE_SLUGS
 * / USER_STATUS_VALUES) so the allow-listed values stay in sync with the
 * backend's own validation.
 */

const ENTITY_LABEL = {
  projects: { en: 'Projects', ar: 'المشاريع' },
  users: { en: 'Users', ar: 'المستخدمون' },
};
const ROLE_LABEL = {
  student: { en: 'Student', ar: 'طالب' },
  university: { en: 'University', ar: 'جامعة' },
};
const USER_STATUS_LABEL = {
  active: { en: 'Active', ar: 'نشط' },
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  suspended: { en: 'Suspended', ar: 'موقوف' },
  banned: { en: 'Banned', ar: 'محظور' },
};

export default function DataAnalysisSegments() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [segments, setSegments] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');

  const [name, setName] = useState('');
  const [entity, setEntity] = useState('projects');
  const [category, setCategory] = useState('');
  const [projectStatus, setProjectStatus] = useState('');
  const [role, setRole] = useState('');
  const [userStatus, setUserStatus] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/segments')
      .then((json) => {
        setSegments(json.data?.segments || []);
        setRoleOptions(json.data?.role_options || []);
        setStatusOptions(json.data?.user_status_options || []);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Toasts dismiss themselves.
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const label = (dict, key) => dict[key]?.[locale] || dict[key]?.en || key;

  const resetForm = () => {
    setName(''); setCategory(''); setProjectStatus(''); setRole(''); setUserStatus(''); setEntity('projects');
  };

  const handleCreate = (e) => {
    e.preventDefault();
    setActionError(null);
    setSaving(true);
    const body = { name, entity };
    if (entity === 'users') {
      if (role) body.role = role;
      if (userStatus) body.status = userStatus;
    } else {
      if (category) body.category = category;
      if (projectStatus) body.status = projectStatus;
    }
    api.post('/api/v1/data-analysis/segments', body)
      .then(() => {
        resetForm();
        setDrawerOpen(false);
        setToast(t('Segment saved'));
        load();
      })
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setSaving(false));
  };

  const handleDelete = (s) => {
    if (!window.confirm(`${t('Delete')} "${s.name}"?`)) return;
    setActionError(null);
    setDeletingId(s.id);
    api.del(`/api/v1/data-analysis/segments/${s.id}`)
      .then(() => { setToast(t('Segment deleted')); load(); })
      .catch((err) => setActionError(errorMessage(err)))
      .finally(() => setDeletingId(null));
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return segments.filter((s) => (entityFilter === 'all' || s.entity === entityFilter)
      && (!q || String(s.name).toLowerCase().includes(q)));
  }, [segments, query, entityFilter]);

  if (loading && !segments.length) return <p className="text-small">{t('Loading…')}</p>;
  if (error) return <p style={{ color: 'var(--color-danger)' }}>{error}</p>;

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1>{t('Data Segments')}</h1>
          <p>{t('Saved filter sets, evaluated live against the real platform data.')}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
            <Icon name="plus" size={16} /> {t('Create Segment')}
          </button>
        </div>
      </div>

      {actionError && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{actionError}</p>}

      <div className="toolbar">
        <div className="toolbar__search">
          <Icon name="search" size={16} />
          <input className="form-input" type="search" placeholder={t('Search data segments…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="form-input" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} aria-label={t('Entity')}>
          <option value="all">{t('All entities')}</option>
          <option value="projects">{label(ENTITY_LABEL, 'projects')}</option>
          <option value="users">{label(ENTITY_LABEL, 'users')}</option>
        </select>
      </div>

      <Panel className="panel--flat animate-rise-in">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('Segment Name')}</th><th>{t('Entity')}</th><th>{t('Rules')}</th><th>{t('Records')}</th>
                {segments.some((s) => s.created_at) && <th>{t('Created')}</th>}
                <th aria-label={t('Action')} />
              </tr>
            </thead>
            <tbody>
              {shown.length ? shown.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{label(ENTITY_LABEL, s.entity)}</td>
                  <td>
                    {s.criteria && Object.keys(s.criteria).length > 0 ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {Object.entries(s.criteria).map(([k, v]) => <span className="badge badge-neutral text-mono" key={k}>{k}: {String(v)}</span>)}
                      </div>
                    ) : <span className="text-caption">{t('No rules (all records)')}</span>}
                  </td>
                  <td className="num"><strong>{fmt(s.matched_count)}</strong></td>
                  {segments.some((x) => x.created_at) && <td className="num">{s.created_at ? String(s.created_at).slice(0, 10) : '—'}</td>}
                  <td>
                    <div className="row-actions">
                      <button type="button" className="icon-btn" title={t('Delete')} aria-label={t('Delete')} disabled={deletingId === s.id} onClick={() => handleDelete(s)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6}><p className="chart-empty" style={{ margin: 8 }}>{segments.length ? t('No segments match your search.') : t('No saved segments yet.')}</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Drawer open={drawerOpen} title={t('Create a Segment')} subtitle={t('Save a filter set you can reuse. Records are counted live.')} onClose={() => setDrawerOpen(false)}>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label className="form-label is-required" htmlFor="seg-name">{t('Name')}</label>
            <input id="seg-name" type="text" className="form-input" placeholder={t('Segment name')} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="seg-entity">{t('Data source')}</label>
            <select id="seg-entity" className="form-input" value={entity} onChange={(e) => setEntity(e.target.value)} required>
              <option value="projects">{label(ENTITY_LABEL, 'projects')}</option>
              <option value="users">{label(ENTITY_LABEL, 'users')}</option>
            </select>
          </div>

          {entity === 'projects' ? (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="seg-cat">{t('Category')}</label>
                <input id="seg-cat" type="text" className="form-input" placeholder={t('Category (optional)')} value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="seg-pst">{t('Status')}</label>
                <input id="seg-pst" type="text" className="form-input" placeholder={t('Status, e.g. published (optional)')} value={projectStatus} onChange={(e) => setProjectStatus(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="seg-role">{t('Role')}</label>
                <select id="seg-role" className="form-input" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">{t('Any role (optional)')}</option>
                  {(roleOptions.length ? roleOptions : Object.keys(ROLE_LABEL)).map((slug) => (
                    <option value={slug} key={slug}>{label(ROLE_LABEL, slug)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="seg-ust">{t('Status')}</label>
                <select id="seg-ust" className="form-input" value={userStatus} onChange={(e) => setUserStatus(e.target.value)}>
                  <option value="">{t('Any status (optional)')}</option>
                  {(statusOptions.length ? statusOptions : Object.keys(USER_STATUS_LABEL)).map((value) => (
                    <option value={value} key={value}>{label(USER_STATUS_LABEL, value)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {actionError && <p className="form-error">{actionError}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={saving}>
            {saving ? t('Loading…') : t('Save Segment')}
          </button>
        </form>
      </Drawer>

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} /> <span>{toast}</span>
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label={t('Cancel')} onClick={() => setToast(null)}><Icon name="x" size={14} /></button>
        </div>
      )}
    </>
  );
}
