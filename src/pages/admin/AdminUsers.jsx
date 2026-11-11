import { personName } from '../../utils/bilingualName';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { Avatar, ConfirmModal, RoleBadge, StatusBadge, UserModal } from '../../components/admin/adminUi';
import BulkUsersModal from '../../components/admin/BulkUsersModal';
import UserFilters from '../../components/admin/UserFilters';
import { activeFilterCount, filtersFromParams, filtersToApi, filtersToParams, relativeTime } from '../../lib/userFilters';
import AdminPage, { ErrorState, Kpi, KpiGrid, Skeleton } from '../../components/admin/AdminPage';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/users';
import i18nKit from '../../i18n/admin/page-kit';

const translations = { ...i18nKit, ...i18nCommon, ...i18nPage };

/**
 * Users & Roles list — Admin design. Talks to the same real API as before
 * (/api/v1/admin/users, /api/v1/admin/roles); nothing here is invented.
 * Every row links to the new User Details page (/admin/users/:uuid).
 * window.confirm() is replaced by the in-page "Confirm action" dialog.
 */

export default function AdminUsers() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [countsByStatus, setCountsByStatus] = useState({});
  const [page, setPage] = useState(1);
  // Filters live in the URL (shareable / survive refresh); see lib/userFilters.js.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const updateFilters = useCallback((next) => { setPage(1); setSearchParams(filtersToParams(next), { replace: true }); }, [setSearchParams]);
  const [roles, setRoles] = useState([]);
  const [universities, setUniversities] = useState([]);
  const [facets, setFacets] = useState({});
  const perPage = Number(filters.per_page) || 20;
  const isTrash = filters.status.includes('deleted');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null); // user | 'new' | null
  const [confirm, setConfirm] = useState(null); // { kind, user }
  const [busy, setBusy] = useState(false);
  // 409 email_conflict on restore: { user, conflict, options, groups } — admin picks new email or merge.
  const [conflict, setConflict] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [mergeGroups, setMergeGroups] = useState([]);
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/admin/users', filtersToApi(filters, page))
      .then((json) => {
        setRows(json.data || []);
        setTotal(json.meta?.total ?? 0);
        setCountsByStatus(json.meta?.counts_by_status || {});
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/api/v1/admin/roles').then((json) => setRoles((json.data || []).filter((r) => r.slug !== 'company'))).catch(() => {});
    api.get('/api/v1/admin/users/affiliation-options').then((json) => setUniversities(json.data || [])).catch(() => {});
    api.get('/api/v1/admin/users/filter-options').then((json) => setFacets(json.data || {})).catch(() => {});
  }, []);

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, user: u } = confirm;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === 'suspend') await api.post(`/api/v1/admin/users/${u.uuid}/suspend`);
      else if (kind === 'activate') await api.post(`/api/v1/admin/users/${u.uuid}/activate`);
      else if (kind === 'block-ip') await api.post(`/api/v1/admin/users/${u.uuid}/block-ip`);
      else if (kind === 'restore') {
        let res;
        try {
          res = await api.post(`/api/v1/admin/users/${u.uuid}/restore`);
        } catch (err) {
          if (err?.payload?.errors?.code === 'email_conflict') {
            const e = err.payload.errors;
            setConflict({ user: u, conflict: e.conflict, options: e.options || [], groups: e.groups || [] });
            setMergeGroups((e.groups || []).filter((g) => g.default && g.count > 0).map((g) => g.key));
            setNewEmail('');
            setConfirm(null);
            return;
          }
          throw err;
        }
        const n = res?.data?.accounts_restored;
        if (n > 0) {
          setNotice(`${u.full_name}: ${t('done')}. ${t('{n} linked account(s) were reactivated and notified.').replace('{n}', n)}`);
          setConfirm(null);
          load();
          return;
        }
      } else if (kind === 'delete') {
        const res = await api.del(`/api/v1/admin/users/${u.uuid}`);
        const n = res?.data?.accounts_suspended;
        if (n > 0) {
          setNotice(`${u.full_name}: ${t('done')}. ${t('{n} linked account(s) were suspended and notified.').replace('{n}', n)}`);
          setConfirm(null);
          load();
          return;
        }
      }
      setNotice(`${u.full_name}: ${t('done')}.`);
      setConfirm(null);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(resolution) {
    if (!conflict) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = resolution === 'new_email' ? { resolution, email: newEmail.trim() } : { resolution, groups: mergeGroups };
      await api.post(`/api/v1/admin/users/${conflict.user.uuid}/restore`, body);
      setNotice(`${conflict.user.full_name}: ${t('done')}.`);
      setConflict(null);
      load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const CONFIRM_TEXT = {
    suspend: (u) => ({ title: t('Suspend account'), message: t('{name} will lose access until the account is reactivated.').replace('{name}', u.full_name), label: t('Suspend') }),
    activate: (u) => ({ title: t('Reactivate account'), message: t('{name} will be able to sign in again.').replace('{name}', u.full_name), label: t('Reactivate') }),
    'block-ip': (u) => ({ title: t('Block last-known IP'), message: t('Block {name}\'s last-known IP address and suspend the account?').replace('{name}', u.full_name), label: t('Block IP'), danger: true }),
    delete: (u) => ({
      title: t('Delete user'),
      message: (u.role === 'university'
        ? t('Delete {name}? The university will be hidden from sign-up and ALL its students, supervisors and academic staff will be suspended and notified by email and in the platform. You can restore it later from the Deleted tab.')
        : t('Delete {name}? The account will lose access immediately and be notified by email. You can restore it later from the Deleted tab.')).replace('{name}', u.full_name),
      label: t('Delete'), danger: true,
    }),
    restore: (u) => ({
      title: t('Restore account'),
      message: (u.role === 'university'
        ? t('Restore {name}? The university account and everyone linked to it will be reactivated and notified.')
        : t('Restore {name}? The account will be active again.')).replace('{name}', u.full_name),
      label: t('Restore'),
    }),
  };
  const confirmCfg = confirm ? CONFIRM_TEXT[confirm.kind](confirm.user) : null;

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasFilters = activeFilterCount(filters) > 0;
  const sortBy = (key) => updateFilters({ ...filters, sort: key, dir: filters.sort === key && filters.dir === 'desc' ? 'asc' : 'desc' });
  const SortTh = ({ k, children }) => (
    <th aria-sort={filters.sort === k ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`uf-th${filters.sort === k ? ' is-sorted' : ''}`} onClick={() => sortBy(k)}>
        {children}
        {filters.sort === k && <Icon name={filters.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} />}
      </button>
    </th>
  );

  return (
    <AdminPage
      icon="users"
      title={t('Users & Roles')}
      subtitle={t('Manage platform accounts, primary roles and access status.')}
      actions={(
        <>
          <Link to="/admin/roles" className="btn btn-outline"><Icon name="shield" size={16} /> {t('Manage roles')}</Link>
          <button type="button" className="btn btn-outline" onClick={() => setBulkOpen(true)}>
            <Icon name="users" size={16} /> {tr('Add multiple', 'إضافة جماعية')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> {t('Add User')}
          </button>
        </>
      )}
    >
      <KpiGrid>
        <Kpi icon="users" title={t('Total users')} value={total.toLocaleString()} note={hasFilters ? t('matching current filters') : t('all accounts')} />
        <Kpi icon="pulse" tone="ok" title={t('Active')} value={(countsByStatus.active ?? 0).toLocaleString()} note={t('can sign in')} />
        <Kpi icon="clock" tone="warning" title={t('Pending')} value={(countsByStatus.pending ?? 0).toLocaleString()} note={t('awaiting activation')} />
        <Kpi icon="x-circle" tone={(countsByStatus.suspended ?? 0) > 0 ? 'critical' : undefined} title={t('Suspended')} value={(countsByStatus.suspended ?? 0).toLocaleString()} note={t('need manual review')} />
      </KpiGrid>

      {notice && <p className="ap-notice" role="status">{notice}</p>}
      {actionError && <p className="form-error">{actionError}</p>}

      <UserFilters filters={filters} onChange={updateFilters} roles={roles} universities={universities} facets={facets} total={total} loading={loading} />

      {loading && <Skeleton rows={7} cols={4} />}
      {error && <ErrorState error={error} onRetry={load} />}

      {!loading && !error && (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr><SortTh k="full_name">{t('Name')}</SortTh><SortTh k="role">{t('Role')}</SortTh><th>{t('University')}</th><SortTh k="status">{t('Status')}</SortTh><SortTh k="created_at">{t('Joined')}</SortTh><SortTh k="last_login_at">{tr('Last sign-in', 'آخر دخول')}</SortTh><th /></tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.uuid || u.id}>
                  <td>
                    <Link to={`/admin/users/${u.uuid}`} className="adm-person">
                      <Avatar name={personName(u, locale)} src={u.avatar_path} />
                      <span>
                        <strong>{personName(u, locale)}</strong>
                        <small>{u.email}
                          {!u.email_verified_at && <span className="uf-flag">{tr('Unverified', 'غير مُفعَّل')}</span>}
                          {u.invitation_status === 'pending' && <span className="uf-flag">{tr('Not joined', 'لسه ماانضمش')}</span>}
                          {(u.lock_permanent == 1 || (u.locked_until && new Date(String(u.locked_until).replace(' ', 'T')) > new Date())) && <span className="uf-flag uf-flag--lock">{tr('Locked', 'مقفول')}</span>}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td><RoleBadge roles={roles} slug={u.role} /></td>
                  <td>
                    {u.university_id ? (
                      <>
                        {L(t, u.university_en, u.university_ar)}{u.university_deleted ? <span className="badge badge-danger" style={{ marginInlineStart: 6 }}>{t('Deleted')}</span> : null}
                        {(u.faculty_en || u.faculty_ar) && (
                          <small className="uf-sub">
                            {L(t, u.faculty_en, u.faculty_ar)}{(u.department_en || u.department_ar) ? ` · ${L(t, u.department_en, u.department_ar)}` : ''}
                          </small>
                        )}
                      </>
                    ) : (['student', 'supervisor', 'academic_staff'].includes(u.role)
                      ? <span className="badge badge-warning">{t('No university')}</span> : '—')}
                  </td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>{u.created_at ? u.created_at.slice(0, 10) : '—'}</td>
                  <td title={u.last_login_at || undefined}>
                    {u.last_login_at ? relativeTime(u.last_login_at, locale) : <span className="text-small">{tr('Never', 'لم يدخل بعد')}</span>}
                  </td>
                  <td className="adm-actions">
                    {isTrash ? (
                      <button type="button" className="btn btn-ghost btn-sm" title={t('Restore')} onClick={() => setConfirm({ kind: 'restore', user: u })}>
                        <Icon name="check-circle" size={16} /> {t('Restore')}
                      </button>
                    ) : (<>
                    <Link to={`/admin/users/${u.uuid}`} className="btn btn-ghost btn-sm" title={t('View details')}><Icon name="eye" size={16} /></Link>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(u)} title={t('Edit')}><Icon name="edit" size={16} /></button>
                    {u.status === 'suspended' ? (
                      <button type="button" className="btn btn-ghost btn-sm" title={t('Reactivate')} onClick={() => setConfirm({ kind: 'activate', user: u })}>
                        <Icon name="check-circle" size={16} />
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" title={t('Suspend')} onClick={() => setConfirm({ kind: 'suspend', user: u })}>
                        <Icon name="x-circle" size={16} />
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" title={t('Block IP')} onClick={() => setConfirm({ kind: 'block-ip', user: u })}>
                      <Icon name="shield" size={16} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" title={t('Delete')} onClick={() => setConfirm({ kind: 'delete', user: u })}>
                      <Icon name="trash" size={16} />
                    </button>
                    </>)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="adm-empty" style={{ textAlign: 'center', padding: 28 }}>{t('No matching users.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="adm-pager">
          <span>{t('Showing')} {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} {t('of')} {total.toLocaleString()}</span>
          {totalPages > 1 && (
            <div>
              <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('Previous page')}><Icon name="chevron-left" size={16} /></button>
              <span>{t('Page')} {page} {t('of')} {totalPages}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label={t('Next page')}><Icon name="chevron-right" size={16} /></button>
            </div>
          )}
        </div>
      )}

      {bulkOpen && (
        <BulkUsersModal roles={roles} onClose={() => setBulkOpen(false)} onDone={() => { setNotice(t('Saved.')); load(); }} />
      )}
      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNotice(t('Saved.')); load(); }}
        />
      )}
      {conflict && (
        <div className="modal-overlay" onClick={() => setConflict(null)}>
          <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-box__title text-h3">{tr('This email is now used by another account', 'الإيميل ده بقى مستخدم في حساب تاني')}</h2>
            <p className="adm-modal-text">
              <strong dir="ltr">{conflict.conflict.email}</strong> — {conflict.conflict.name} ({conflict.conflict.role}, {conflict.conflict.status}).{' '}
              {tr('Choose how to restore', 'اختار طريقة استرجاع')} <strong>{conflict.user.full_name}</strong>:
            </p>

            {conflict.options.includes('new_email') && (
              <div style={{ margin: '12px 0' }}>
                <label>{tr('Restore with a new email', 'استرجاع بإيميل جديد')}</label>
                <input type="email" dir="ltr" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@example.com" style={{ width: '100%', padding: 8, margin: '6px 0' }} />
                <button type="button" className="btn btn-primary" disabled={busy || !newEmail.trim()} onClick={() => resolveConflict('new_email')}>
                  {tr('Restore with this email', 'استرجع بالإيميل ده')}
                </button>
              </div>
            )}

            {conflict.options.includes('merge_into_current') && (
              <div style={{ margin: '12px 0' }}>
                <label>{tr('Or merge its data into the active account (the old one stays deleted)', 'أو ادمج بياناته في الحساب الشغّال (القديم بيفضل محذوف)')}</label>
                {conflict.groups.map((g) => (
                  <label key={g.key} style={{ display: 'block', margin: '4px 0', opacity: g.count ? 1 : 0.5 }}>
                    <input type="checkbox" disabled={!g.count} checked={mergeGroups.includes(g.key)}
                      onChange={() => setMergeGroups((cur) => (cur.includes(g.key) ? cur.filter((k) => k !== g.key) : [...cur, g.key]))} />{' '}
                    {g.label} <small>({g.count})</small>
                  </label>
                ))}
                <button type="button" className="btn btn-outline" disabled={busy || mergeGroups.length === 0} onClick={() => resolveConflict('merge_into_current')}>
                  {tr('Merge selected data', 'ادمج البيانات المختارة')}
                </button>
              </div>
            )}

            <div className="modal-box__actions">
              <button type="button" className="btn btn-outline" onClick={() => setConflict(null)}>{tr('Cancel', 'إلغاء')}</button>
            </div>
          </div>
        </div>
      )}
      {confirmCfg && (
        <ConfirmModal title={confirmCfg.title} message={confirmCfg.message} confirmLabel={confirmCfg.label}
          danger={confirmCfg.danger} busy={busy} onConfirm={runConfirmed} onClose={() => setConfirm(null)} />
      )}
    </AdminPage>
  );
}
