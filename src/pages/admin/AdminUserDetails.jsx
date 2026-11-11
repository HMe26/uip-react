import { personName } from '../../utils/bilingualName';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, ConfirmModal, RoleBadge, StatusBadge, UserModal, roleLabel } from '../../components/admin/adminUi';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/users';
import { parseServerDate } from '../../utils/serverDate';
import { ErrorState, Skeleton } from '../../components/admin/AdminPage';
import AffiliationPanel from '../../components/admin/AffiliationPanel';
import UserActivityPanel from '../../components/admin/UserActivityPanel';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * User Details (new page, /admin/users/:uuid). Built only on endpoints that already exist:
 *   GET    /api/v1/admin/users/{uuid}            profile + additional_roles
 *   GET    /api/v1/admin/roles, /roles/{slug}    role names + permission groups + granted_ids
 *   GET    /api/v1/admin/users/{uuid}/activity[/summary|/sessions|/export]   per-user activity timeline (UserActivityPanel)
 *   POST   /api/v1/admin/users/{uuid}/suspend | activate | block-ip,  DELETE /users/{uuid}
 * Optional profile fields (last login, email verified, 2FA) are shown only when the API returns them.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'permissions', label: 'Roles & Permissions' },
  { key: 'activity', label: 'Activity' },
  { key: 'security', label: 'Security' },
];

// Permission slug -> matrix column. Slugs that match none of these are listed as extra chips.
const ACTION_ALIASES = { view: 'view', read: 'view', list: 'view', create: 'create', add: 'create', edit: 'edit', update: 'edit', write: 'edit', approve: 'approve', delete: 'delete', remove: 'delete', export: 'export', manage: 'manage' };
const ACTION_ORDER = ['view', 'create', 'edit', 'approve', 'delete', 'export', 'manage'];

// Matrix helpers: readable module names + an icon per module (falls back to a grid icon).
const MODULE_ICONS = { ai: 'ai-spark', analytics: 'chart', data_analysis: 'bar-chart', messaging: 'message', notifications: 'bell', projects: 'projects', reports: 'file', roles: 'key', security: 'shield', settings: 'settings', university: 'building', users: 'users' };
function moduleIcon(name) { return MODULE_ICONS[String(name).toLowerCase()] || 'grid'; }
function prettyModule(name) {
  const text = String(name).replace(/[_\-.]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function actionOf(slug) {
  const tokens = String(slug).toLowerCase().split(/[.:_\-\s]+/);
  for (let i = tokens.length - 1; i >= 0; i -= 1) if (ACTION_ALIASES[tokens[i]]) return ACTION_ALIASES[tokens[i]];
  return null;
}

function fmtDate(v) {
  if (!v) return null;
  const d = parseServerDate(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Fact({ label, children }) {
  return <div className="adm-fact"><small>{label}</small><strong>{children ?? '—'}</strong></div>;
}

function label(v, t) {
  if (v == null) return '';
  return typeof v === 'object' ? L(t, v.en, v.ar) : String(v);
}

export default function AdminUserDetails() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const backTo = '/admin/users';
  const backLabel = t('Back to users');
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(`/api/v1/admin/users/${uuid}`)
      .then((json) => setUser(json.data || null))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [uuid]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/api/v1/admin/roles').then((j) => setRoles(j.data || [])).catch(() => {}); }, []);

  async function runConfirmed() {
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirm === 'suspend') await api.post(`/api/v1/admin/users/${uuid}/suspend`);
      else if (confirm === 'activate') await api.post(`/api/v1/admin/users/${uuid}/activate`);
      else if (confirm === 'block-ip') await api.post(`/api/v1/admin/users/${uuid}/block-ip`);
      else if (confirm === 'delete') { await api.del(`/api/v1/admin/users/${uuid}`); navigate(backTo, { replace: true }); return; }
      setConfirm(null);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !user) return <Skeleton rows={6} cols={4} />;
  if (error) {
    return (<><BackLink to={backTo} className="adm-link-back"><Icon name="chevron-left" size={14} /> {backLabel}</BackLink><ErrorState error={error} /></>);
  }
  if (!user) return null;

  const suspended = user.status === 'suspended';
  const additional = user.additional_roles || [];
  const verifiedKnown = user.email_verified_at !== undefined || user.email_verified !== undefined;
  const verified = Boolean(user.email_verified_at || user.email_verified);

  const CONFIRM = {
    suspend: { title: t('Suspend account'), message: t('{name} will lose access until the account is reactivated.').replace('{name}', user.full_name), label: t('Suspend') },
    activate: { title: t('Reactivate account'), message: t('{name} will be able to sign in again.').replace('{name}', user.full_name), label: t('Reactivate') },
    'block-ip': { title: t('Block last-known IP'), message: t('Block {name}\'s last-known IP address and suspend the account?').replace('{name}', user.full_name), label: t('Block IP'), danger: true },
    delete: { title: t('Delete user'), message: t('Delete {name}? This cannot be undone.').replace('{name}', user.full_name), label: t('Delete'), danger: true },
  };
  const cfg = confirm ? CONFIRM[confirm] : null;

  return (
    <>
      <BackLink to={backTo} className="adm-link-back"><Icon name="chevron-left" size={14} /> {backLabel}</BackLink>
      <div className="page-header animate-rise-in">
        <div className="page-header__title"><h1 className="text-h1">{t('User Details')}</h1></div>
        <div className="page-header__actions">
          <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> {t('Edit user')}</button>
          {suspended ? (
            <button type="button" className="btn btn-outline" onClick={() => setConfirm('activate')}><Icon name="check-circle" size={16} /> {t('Reactivate account')}</button>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => setConfirm('suspend')}><Icon name="x-circle" size={16} /> {t('Suspend account')}</button>
          )}
        </div>
      </div>
      {actionError && <p className="form-error">{actionError}</p>}

      <div className="adm-profile">
        <Avatar name={personName(user, locale)} src={user.avatar_path} large />
        <div>
          <h2>{personName(user, locale)}</h2>
          <p>{user.email}{user.uuid ? ` · ID ${String(user.uuid).slice(0, 8).toUpperCase()}` : ''}</p>
          <div className="adm-profile__badges">
            <RoleBadge roles={roles} slug={user.role} />
            {verifiedKnown && verified && <span className="badge badge-success">{t('Verified')}</span>}
            <StatusBadge status={user.status} />
          </div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={`adm-tab${tab === x.key ? ' is-active' : ''}`} onClick={() => setTab(x.key)}>
            {t(x.label)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="adm-overview">
          <section className="adm-overview__card" aria-label={t('Account')}>
            <h3 className="adm-overview__title">{t('Account')}</h3>
            <div className="adm-facts adm-facts--overview">
              <Fact label={t('Primary role')}><RoleBadge roles={roles} slug={user.role} /></Fact>
              <Fact label={t('Status')}><StatusBadge status={user.status} /></Fact>
              <Fact label={t('Phone')}>{user.phone}</Fact>
              <Fact label={t('Joined')}>{fmtDate(user.created_at)}</Fact>
              <Fact label={t('Last sign-in')}>{fmtDate(user.last_login_at || user.last_login) || t('Never')}</Fact>
              <Fact label={t('Email verified')}>{user.email_verified_at ? fmtDate(user.email_verified_at) : t('Not verified')}</Fact>
            </div>
            <div className="adm-access">
              <div className="adm-access__head">
                <strong>{t('Additional access')}</strong>
                <span className="adm-access__count">{additional.length}</span>
              </div>
              {additional.length ? (
                <div className="adm-access__chips">
                  {additional.map((slug) => <span key={slug} className="adm-access__chip">{roleLabel(roles, slug, t)}</span>)}
                </div>
              ) : <p className="adm-muted">{t('None granted')}</p>}
            </div>
          </section>
          <AffiliationPanel user={user} onChanged={load} />
        </div>
      )}

      {tab === 'permissions' && <PermissionsTab user={user} roles={roles} additional={additional} />}
      {tab === 'activity' && <UserActivityPanel user={user} />}

      {tab === 'security' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="adm-facts">
            <Fact label={t('Account status')}>{t(String(user.status || '').replace(/^./, (c) => c.toUpperCase()))}</Fact>
            {user.two_factor_enabled !== undefined && <Fact label={t('Two-factor authentication')}>{user.two_factor_enabled ? t('Enabled') : t('Disabled')}</Fact>}
            {(user.last_login_at || user.last_login) && <Fact label={t('Last sign-in')}>{fmtDate(user.last_login_at || user.last_login)}</Fact>}
          </div>
          <div className="adm-panel adm-danger">
            <div className="adm-panel__head"><div><h3>{t('Account controls')}</h3><p>{t('These actions are recorded in the audit log.')}</p></div></div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {suspended ? (
                <button type="button" className="btn btn-outline" onClick={() => setConfirm('activate')}>{t('Reactivate')}</button>
              ) : (
                <button type="button" className="btn btn-outline" onClick={() => setConfirm('suspend')}>{t('Suspend')}</button>
              )}
              <button type="button" className="btn btn-outline adm-btn-danger" onClick={() => setConfirm('block-ip')}>{t('Block IP')}</button>
              <button type="button" className="btn btn-outline adm-btn-danger" onClick={() => setConfirm('delete')}>{t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {editing && <UserModal user={user} roles={roles} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
      {cfg && <ConfirmModal title={cfg.title} message={cfg.message} confirmLabel={cfg.label} danger={cfg.danger} busy={busy} onConfirm={runConfirmed} onClose={() => setConfirm(null)} />}
    </>
  );
}

function PermissionsTab({ user, roles, additional }) {
  const t = useTranslations(translations);
  const [groups, setGroups] = useState({});
  const [granted, setGranted] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const slugs = useMemo(() => [user.role, ...additional].filter(Boolean), [user.role, additional]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(slugs.map((s) => api.get(`/api/v1/admin/roles/${s}`)))
      .then((results) => {
        if (cancelled) return;
        const ids = new Set();
        results.forEach((r) => (r.data?.granted_ids || []).forEach((id) => ids.add(id)));
        setGroups(results[0]?.data?.permission_groups || {});
        setGranted(ids);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slugs]);

  const columns = useMemo(() => {
    const present = new Set();
    Object.values(groups).forEach((perms) => (perms || []).forEach((p) => { const a = actionOf(p.slug); if (a) present.add(a); }));
    return ACTION_ORDER.filter((a) => present.has(a));
  }, [groups]);

  const totals = useMemo(() => {
    let all = 0; let on = 0;
    Object.values(groups).forEach((perms) => (perms || []).forEach((p) => { all += 1; if (granted.has(p.id)) on += 1; }));
    return { all, on };
  }, [groups, granted]);

  return (
    <div className="adm-panel">
      <div className="adm-panel__head">
        <div>
          <h3>{t('Permission matrix')}</h3>
          <p>{roleLabel(roles, user.role, t)} {t('access profile')}{additional.length ? ` + ${additional.length} ${additional.length > 1 ? t('additional roles') : t('additional role')}` : ''}</p>
        </div>
        <Link to="/admin/roles" className="btn btn-outline btn-sm"><Icon name="edit" size={14} /> {t('Edit permissions')}</Link>
      </div>
      {loading && <Skeleton rows={6} cols={4} />}
      {error && <ErrorState error={error} />}
      {!loading && !error && Object.keys(groups).length === 0 && <p className="adm-empty">{t('No permissions are defined yet.')}</p>}
      {!loading && !error && Object.keys(groups).length > 0 && (
        <>
          <div className="pm-summary">
            <div className="pm-summary__stat">
              <strong>{totals.on}</strong><span>{t('granted')}</span>
            </div>
            <div className="pm-summary__bar" role="img" aria-label={`${totals.on} / ${totals.all}`}>
              <span style={{ width: `${totals.all ? Math.round((totals.on / totals.all) * 100) : 0}%` }} />
            </div>
            <div className="pm-summary__stat pm-summary__stat--muted">
              <strong>{totals.all - totals.on}</strong><span>{t('not granted')}</span>
            </div>
          </div>
          <div className="pm-grid">
            {Object.entries(groups).map(([moduleName, perms]) => {
              const list = perms || [];
              const extras = list.filter((p) => !actionOf(p.slug));
              const cells = columns.map((c) => ({ c, p: list.find((x) => actionOf(x.slug) === c) })).filter((x) => x.p);
              const all = cells.length + extras.length;
              const on = cells.filter((x) => granted.has(x.p.id)).length + extras.filter((p) => granted.has(p.id)).length;
              const state = on === 0 ? 'none' : on === all ? 'full' : 'part';
              return (
                <section key={moduleName} className={`pm-card pm-card--${state}`}>
                  <header className="pm-card__head">
                    <span className="pm-card__icon"><Icon name={moduleIcon(moduleName)} size={18} /></span>
                    <h4>{prettyModule(moduleName)}</h4>
                    <span className="pm-card__count">{on}/{all}</span>
                  </header>
                  <ul className="pm-chips">
                    {cells.map(({ c, p }) => {
                      const isOn = granted.has(p.id);
                      return (
                        <li key={c} className={`pm-chip${isOn ? ' is-on' : ''}`} title={p.slug} aria-label={`${c}: ${isOn ? t('granted') : t('not granted')}`}>
                          <span className="pm-chip__mark">{isOn ? <Icon name="check" size={12} /> : <Icon name="x" size={12} />}</span>
                          {c}
                        </li>
                      );
                    })}
                    {extras.map((p) => {
                      const isOn = granted.has(p.id);
                      return (
                        <li key={p.id} className={`pm-chip pm-chip--extra${isOn ? ' is-on' : ''}`} title={p.description || p.slug} aria-label={`${p.slug}: ${isOn ? t('granted') : t('not granted')}`}>
                          <span className="pm-chip__mark">{isOn ? <Icon name="check" size={12} /> : <Icon name="x" size={12} />}</span>
                          {p.slug}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
