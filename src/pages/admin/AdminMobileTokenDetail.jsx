import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { ConfirmModal } from '../../components/admin/adminUi';
import AdminPage, { Chips, EmptyState, ErrorState, Kpi, KpiGrid, Skeleton } from '../../components/admin/AdminPage';
import { useLanguage, useTranslations } from '../../context/LanguageContext';
import { useLive } from '../../hooks/useLive';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/admin/mobile-token';
import { parseServerDate } from '../../utils/serverDate';
import '../../styles/css/admin-token-detail.css';

const translations = { ...i18nCommon, ...i18nPage };
const API = '/api/v1/admin/mobile-tokens';

/* ------------------------------------------------------------------ formatting */
const intl = (locale) => (locale === 'ar' ? 'ar-EG' : 'en-GB');
const toDate = (v) => { if (!v) return null; const d = parseServerDate(v); return Number.isNaN(d.getTime()) ? null : d; };
const fmtDate = (v, locale) => { const d = toDate(v); return d ? d.toLocaleDateString(intl(locale), { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
const fmtTime = (v, locale, secs = true) => {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(intl(locale), { hour: '2-digit', minute: '2-digit', ...(secs ? { second: '2-digit' } : {}) }) : '—';
};
const fmt = (v, locale, secs = false) => (toDate(v) ? `${fmtDate(v, locale)} · ${fmtTime(v, locale, secs)}` : '—');
const rel = (v, locale) => {
  const d = toDate(v);
  if (!d) return '—';
  const sec = Math.round((d.getTime() - Date.now()) / 1000);
  const a = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  if (a < 60) return rtf.format(sec, 'second');
  if (a < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (a < 2592000) return rtf.format(Math.round(sec / 86400), 'day');
  return fmtDate(v, locale);
};
const ymd = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const dayKey = (v) => { const d = toDate(v); return d ? ymd(d) : ''; };
const dayLabel = (v, locale, t) => {
  const d = toDate(v);
  if (!d) return '—';
  const now = new Date();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (ymd(d) === ymd(now)) return t('Today');
  if (ymd(d) === ymd(yest)) return t('Yesterday');
  return fmtDate(v, locale);
};
const num = (n) => Number(n || 0).toLocaleString();
const statusTone = (s) => (s >= 500 ? 'badge-danger' : s >= 400 ? 'badge-warning' : 'badge-success');
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// [English, Arabic] meaning of the common HTTP codes this API returns.
const HTTP_TEXT = {
  200: ['OK', 'ناجح'], 201: ['Created', 'تم الإنشاء'], 204: ['No content', 'ناجح بدون محتوى'],
  301: ['Moved', 'تحويل دائم'], 302: ['Redirect', 'تحويل'], 304: ['Not modified', 'لم يتغيّر'],
  400: ['Bad request', 'طلب غير صحيح'], 401: ['Not signed in / session expired', 'غير مسجّل دخول أو الجلسة منتهية'],
  403: ['Forbidden (permission, device, network or app token)', 'ممنوع (صلاحية أو جهاز أو شبكة أو توكن التطبيق)'],
  404: ['Not found', 'غير موجود'], 405: ['Method not allowed', 'الطريقة غير مسموحة'], 409: ['Conflict', 'تعارض'],
  413: ['Payload too large', 'الحجم كبير جدًا'], 419: ['Session expired', 'انتهت الجلسة'],
  422: ['Validation failed', 'بيانات غير صالحة'], 423: ['Locked', 'مقفول'], 429: ['Too many requests (rate limit)', 'طلبات كتير (حد الاستخدام)'],
  500: ['Server error', 'خطأ في السيرفر'], 502: ['Bad gateway', 'Bad gateway'], 503: ['Service unavailable', 'الخدمة غير متاحة'], 504: ['Gateway timeout', 'انتهت مهلة السيرفر'],
};
const httpText = (code, locale) => {
  const c = Number(code);
  const hit = HTTP_TEXT[c];
  if (hit) return hit[locale === 'ar' ? 1 : 0];
  if (c >= 500) return locale === 'ar' ? 'خطأ في السيرفر' : 'Server error';
  if (c >= 400) return locale === 'ar' ? 'خطأ من الطلب' : 'Client error';
  if (c >= 300) return locale === 'ar' ? 'تحويل' : 'Redirect';
  return locale === 'ar' ? 'ناجح' : 'Success';
};

/** Short, readable device name from a user-agent string (the full string stays one tap away). */
function deviceName(ua) {
  const s = String(ua || '');
  if (!s) return '—';
  const android = s.match(/Android\s([\d.]+)(?:;\s*([^)]+?))?\)/);
  const browser = /Chrome\/([\d.]+)/.exec(s);
  const parts = [];
  if (android) parts.push(`Android ${android[1]}${android[2] ? ` · ${android[2].replace(/\sBuild.*/, '').replace(/;\s*wv$/, '')}` : ''}`);
  else if (/iPhone|iPad/.test(s)) parts.push('iOS');
  else if (/Windows/.test(s)) parts.push('Windows');
  else if (/Mac OS X/.test(s)) parts.push('macOS');
  else if (/Linux/.test(s)) parts.push('Linux');
  if (!/; wv\)/.test(s) && browser) parts.push(`Chrome ${browser[1].split('.')[0]}`);
  return parts.join(' · ') || s.slice(0, 60);
}
const isWebView = (ua) => /; wv\)/.test(String(ua || ''));

/* ------------------------------------------------------------------ small pieces */
const Method = ({ m }) => <span className={`td-method td-method--${String(m).toLowerCase()}`}>{m}</span>;
const isClient = (r) => r.source === 'client';
const parseMeta = (r) => { if (!r.meta) return null; try { const m = JSON.parse(r.meta); return m && typeof m === 'object' ? m : null; } catch { return null; } };
const fmtBytes = (n) => { n = Number(n); if (!Number.isFinite(n) || n < 0) return '—'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; };
const fmtMs = (n) => { n = Number(n); if (!Number.isFinite(n)) return '—'; return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`; };
const Code = ({ r }) => (isClient(r)
  ? <span className="badge badge-danger">APP</span>
  : <span className={`badge ${r.outcome === 'revoked' ? 'badge-danger' : statusTone(r.status)}`}>{r.status}</span>);
const Chip = ({ icon, tone, children }) => (
  <span className={`td-chip${tone ? ` td-chip--${tone}` : ''}`}>{icon && <Icon name={icon} size={12} />}{children}</span>
);
const Btn = ({ onClick, children, danger }) => (
  <button type="button" className="btn btn-secondary btn-sm" onClick={onClick}
    style={danger ? { color: 'var(--color-danger)', borderColor: 'var(--color-danger)' } : undefined}>{children}</button>
);

/** Ask for an optional reason, then block the device. */
function BlockDeviceModal({ target, t, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3">{t('Block device')}</h2>
        <p className="adm-modal-text">
          {t('Block "{name}"? Every request from this device is refused and the app shows a "device blocked" page until you unblock it.').replace('{name}', target.label)}
        </p>
        <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
          placeholder={t('Reason (optional)')} style={{ width: '100%', marginBottom: 16 }} />
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onConfirm(reason.trim())}
            style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', color: '#fff' }}>
            {busy ? '…' : t('Block device')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, hint, action, children }) {
  return (
    <section className="td-card">
      <div className="td-card__head">
        <h2 className="td-card__title">{icon && <Icon name={icon} size={18} />}{title}</h2>
        {hint && <span className="td-card__hint">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

function Info({ label, children }) {
  return <div className="td-info__item"><span className="td-info__label">{label}</span><div className="td-info__value">{children}</div></div>;
}

/** One row of the Users / IPs / Devices / Endpoints lists: lead · title/sub/meta · count + share bar + actions. */
function Entity({ lead, title, sub, meta, extra, n, unit, pct, actions }) {
  return (
    <div className="td-row">
      <span className="td-lead">{lead}</span>
      <div className="td-row__main">
        <div className="td-row__title">{title}</div>
        {sub && <div className="td-row__sub">{sub}</div>}
        {meta && <div className="td-row__meta">{meta}</div>}
        {extra}
      </div>
      <div className="td-row__side">
        <div className="td-row__n">{num(n)} <small>{unit}</small></div>
        <div className="td-bar"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
        {actions && <div className="td-row__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Smooth (monotone cubic) path through the points: curves like a spline but never dips below a real value. */
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = []; const m = []; const tan = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i += 1) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  tan[0] = m[0]; tan[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i]; const b = tan[i + 1] / m[i]; const h = Math.hypot(a, b);
    if (h > 3) { tan[i] = (3 * a / h) * m[i]; tan[i + 1] = (3 * b / h) * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const x1 = pts[i][0] + dx[i] / 3; const x2 = pts[i + 1][0] - dx[i] / 3;
    d += ` C${x1},${pts[i][1] + tan[i] * dx[i] / 3} ${x2},${pts[i + 1][1] - tan[i + 1] * dx[i] / 3} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** Requests per day for the last 30 days, drawn as a smooth curve with a soft filled area. Hover / touch shows the exact day. */
function DayBars({ byDay, count = 30, t, locale }) {
  const [hover, setHover] = useState(null);
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, n: Number(byDay?.[key] || 0), today: i === 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  const label = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString(intl(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const W = 600; const H = 150; const PAD = 14;
  const last = days.length - 1;
  const pts = days.map((d, i) => [(i / last) * W, PAD + (1 - d.n / max) * (H - PAD * 2)]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const pct = (i) => (i / last) * 100;
  const topPct = (i) => (pts[i][1] / H) * 100;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - r.left) / r.width) * last))));
  };
  const shown = hover ?? last; // resting state points at today
  const active = hover !== null;

  return (
    <div className="td-chart">
      <div className="td-curve" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`${t('Requests per day')}: ${t('Peak')} ${num(max)}`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="tdCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity=".32" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} className="td-curve__grid" vectorEffect="non-scaling-stroke" />)}
          <path d={area} fill="url(#tdCurveFill)" />
          <path d={line} className="td-curve__line" vectorEffect="non-scaling-stroke" />
        </svg>
        {active && <span className="td-curve__guide" style={{ left: `${pct(shown)}%` }} />}
        <span className={`td-curve__dot${shown === last ? ' is-today' : ''}`} style={{ left: `${pct(shown)}%`, top: `${topPct(shown)}%` }} />
        <div className={`td-curve__tip${shown < 3 ? ' is-start' : shown > last - 3 ? ' is-end' : ''}`} style={{ left: `${pct(shown)}%`, top: `${topPct(shown)}%` }}>
          <b>{num(days[shown].n)}</b> {t('requests')}
          <small>{label(days[shown].key)}</small>
        </div>
      </div>
      <div className="td-bars__axis"><span>{label(days[0].key)}</span><span>{t('Peak')}: {num(max)} · {t('Total')}: {num(days.reduce((sum, d) => sum + d.n, 0))}</span><span>{label(days[last].key)}</span></div>
    </div>
  );
}

const CHART_RANGES = [7, 14, 30, 60];

/** "Requests per day" card: the curve plus filters (period, result, user, device). The default view uses the data the page already has. */
function RequestsChartCard({ id, s, t, locale, refreshKey }) {
  const retention = Number(s.retention_days) || 60;
  const ranges = CHART_RANGES.filter((d) => d <= retention);
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [device, setDevice] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const isDefault = days === 30 && !status && !userId && !device;

  useEffect(() => {
    if (isDefault) return undefined;
    let alive = true;
    setBusy(true); setFailed(false);
    const p = new URLSearchParams({ days: String(days) });
    if (status) p.set('status', status);
    if (userId) p.set('user_id', userId);
    if (device) p.set('device', device);
    api.get(`${API}/${id}/daily?${p}`)
      .then((r) => { if (alive) setRes(r.data); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [id, days, status, userId, device, isDefault, refreshKey]);

  const byDay = isDefault ? s.by_day : (res?.by_day || {});
  const reset = () => { setDays(30); setStatus(''); setUserId(''); setDevice(''); };
  const users = s.users || [];
  const devices = (s.devices || []).filter((d) => d.dev || d.ua);

  return (
    <Card icon="calendar" title={t('Requests per day (last {n} days)').replace('{n}', String(days))} hint={t('Logs are kept for {days} days.').replace('{days}', String(retention))}>
      <div className="td-toolbar">
        <Chips value={String(days)} onChange={(v) => setDays(Number(v))} label={t('Period')}
          options={ranges.map((d) => [String(d), `${d} ${t('days')}`])} />
        <Chips value={status} onChange={setStatus} label={t('Result')}
          options={[['', t('All')], ['ok', t('Successful')], ['error', t('Errors'), 'critical'], ['rejected', t('Rejected'), 'warning'], ['client', t('App-side failures'), 'critical']]} />
      </div>
      <div className="td-toolbar">
        {users.length > 0 && (
          <select className="td-select" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t('User')}>
            <option value="">{t('All users')}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        )}
        {devices.length > 0 && (
          <select className="td-select" value={device} onChange={(e) => setDevice(e.target.value)} aria-label={t('Devices')}>
            <option value="">{t('All devices')}</option>
            {devices.map((d, i) => { const k = d.dev || d.ua; return <option key={`${k}-${i}`} value={k}>{deviceName(d.ua)}{d.dev ? ` · ${String(d.dev).slice(0, 8)}` : ''}</option>; })}
          </select>
        )}
        {!isDefault && <button type="button" className="td-link" onClick={reset}>{t('Clear filter')}</button>}
      </div>
      {failed && <p className="form-error">{t('Could not load the chart.')}</p>}
      <div style={{ opacity: busy ? 0.5 : 1, transition: 'opacity .15s' }}>
        <DayBars byDay={byDay} count={days} t={t} locale={locale} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ request rows + dialog */
function RequestItem({ r, t, locale, onOpen }) {
  return (
    <button type="button" className="td-req" onClick={() => onOpen(r)}>
      <Method m={r.method} />
      <span className="td-req__main">
        <span className="td-req__path" title={r.route || r.path}>{r.path}</span>
        <span className="td-req__sub">
          <span><Icon name="user" size={12} />{r.user_name || t('Anonymous')}</span>
          <span dir="ltr"><Icon name="globe" size={12} />{r.ip || '—'}</span>
          <span><Icon name="smartphone" size={12} />{deviceName(r.user_agent)}</span>
        </span>
        {(r.request_bytes != null || r.duration_ms != null) && (
          <span className="td-req__sub">
            {r.request_bytes != null && <span dir="ltr">{fmtBytes(r.request_bytes)}</span>}
            {r.duration_ms != null && <span dir="ltr">{fmtMs(r.duration_ms)}</span>}
          </span>
        )}
        {isClient(r) && r.error_code && <span className="td-req__err" dir="ltr" style={{ textAlign: 'left' }}>{r.error_code}</span>}
        {r.error_message && <span className="td-req__err">{r.error_message}</span>}
      </span>
      <span className="td-req__side">
        <Code r={r} />
        <span className="td-req__time">{fmtTime(r.created_at, locale)}</span>
      </span>
    </button>
  );
}

/** Everything recorded about one request, with the reason it failed (when it did). */
function RequestDetail({ r, t, locale, onClose }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const failed = r.status >= 400 || r.outcome === 'revoked' || isClient(r);
  const meta = parseMeta(r);
  const userText = r.user_name ? `${r.user_name} (${r.user_email}) #${r.user_id}` : t('Anonymous');
  const fields = [
    [t('Time'), <>{fmt(r.created_at, locale, true)}<small>{rel(r.created_at, locale)}</small></>],
    [t('Result'), <><Code r={r} /> {httpText(r.status, locale)}{r.outcome === 'revoked' ? ` · ${t('Rejected')}` : ''}</>],
    [t('Method'), <Method m={r.method} />],
    [t('Path'), <span className="td-mono" dir="ltr">{r.path}</span>],
    r.route ? [t('Route pattern'), <span className="td-mono" dir="ltr">{r.route}</span>] : null,
    [t('User'), r.user_name ? <>{r.user_name}<small>{r.user_email} · #{r.user_id}</small></> : t('Anonymous')],
    [t('IP'), <span className="td-mono" dir="ltr">{r.ip || '—'}</span>],
    [t('Device / User-Agent'), <>{deviceName(r.user_agent)}<small dir="ltr" style={{ textAlign: 'left' }}>{r.user_agent || ''}</small></>],
    [t('Device ID'), <span className="td-mono" dir="ltr">{r.device_id || '—'}</span>],
    [t('Client'), r.client || '—'],
    r.request_bytes != null ? [t('Request size'), <span dir="ltr">{fmtBytes(r.request_bytes)}</span>] : null,
    r.duration_ms != null ? [t('Duration'), <span dir="ltr">{fmtMs(r.duration_ms)}</span>] : null,
    r.content_type ? [t('Content type'), <span className="td-mono" dir="ltr">{r.content_type}</span>] : null,
    meta ? [t('App diagnostics'), <pre className="td-mono" dir="ltr" style={{ whiteSpace: 'pre-wrap', margin: 0, textAlign: 'left', overflowWrap: 'anywhere' }}>{JSON.stringify(meta, null, 2)}</pre>] : null,
  ].filter(Boolean);

  const copyAll = async () => {
    const text = [
      `${r.method} ${r.path} -> ${isClient(r) ? 'APP-SIDE FAILURE' : r.status}`, `${t('Time')}: ${fmt(r.created_at, locale, true)}`, `${t('User')}: ${userText}`,
      `${t('IP')}: ${r.ip || '-'}`, `${t('Device / User-Agent')}: ${r.user_agent || '-'}`, `${t('Device ID')}: ${r.device_id || '-'}`,
      r.error_code ? `${t('Error code')}: ${r.error_code}` : '', r.error_message ? `${t('Error message')}: ${r.error_message}` : '',
      r.error_detail ? `${t('Exception')}: ${r.error_detail}` : '',
      r.request_bytes != null ? `${t('Request size')}: ${fmtBytes(r.request_bytes)}` : '', r.duration_ms != null ? `${t('Duration')}: ${fmtMs(r.duration_ms)}` : '',
      meta ? `${t('App diagnostics')}: ${JSON.stringify(meta)}` : '',
    ].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box card glass-panel td-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="td-modal__head">
          <h2 className="modal-box__title text-h3">{t('Request details')}</h2>
          <Code r={r} />
        </div>
        {failed && (
          <div className="td-alert">
            <strong><Icon name="alert-triangle" size={16} />{t('What went wrong')}</strong>
            {isClient(r) && <p>{t('Reported by the app itself: this failed on the phone and never reached the server.')}</p>}
            {r.outcome === 'revoked' && <p>{t('This request was rejected because the token had been revoked.')}</p>}
            {r.error_message && <p>{r.error_message}</p>}
            {r.error_code && <p>{isClient(r) ? t('Failure type') : t('Error code')}: <code>{r.error_code}</code></p>}
            {r.error_detail && <p dir="ltr" style={{ textAlign: 'left' }}>{t('Exception')}: <code>{r.error_detail}</code></p>}
            {!r.error_message && !r.error_code && !r.error_detail && r.outcome !== 'revoked' && <p>{t('No error text was recorded for this request.')}</p>}
          </div>
        )}
        <dl className="td-kv">
          {fields.map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>))}
        </dl>
        <div className="modal-box__actions">
          <button type="button" className="btn btn-outline" onClick={copyAll}><Icon name="copy" size={14} /> {copied ? t('Copied') : t('Copy')}</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}

function RequestLog({ id, t, locale, preset, onClearPreset, onOpen, refreshKey }) {
  const [filter, setFilter] = useState(preset?.status || '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ rows: null, meta: null, error: null });

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), per_page: '50' });
    if (filter) params.set('status', filter);
    if (q.trim()) params.set('q', q.trim());
    if (preset?.user_id) params.set('user_id', String(preset.user_id));
    if (preset?.ip) params.set('ip', preset.ip);
    if (preset?.status_code) params.set('status_code', String(preset.status_code));
    if (preset?.endpoint) params.set('endpoint', preset.endpoint);
    if (preset?.method) params.set('method', preset.method);
    if (preset?.device) params.set('device', preset.device);
    const h = setTimeout(() => {
      api.get(`${API}/${id}/requests?${params}`)
        .then((res) => { if (alive) setState({ rows: res.data || [], meta: res.meta || {}, error: null }); })
        .catch((e) => { if (alive) setState({ rows: [], meta: null, error: errorMessage(e) }); });
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [id, filter, q, page, preset, refreshKey]);

  const { rows, meta, error } = state;
  let lastDay = '';
  return (
    <Card icon="pulse" title={t('Request log')} hint={meta?.total != null ? `${num(meta.total)} ${t('requests')}` : undefined}>
      <div className="td-toolbar">
        <Chips value={filter} onChange={(v) => { setFilter(v); setPage(1); }} label={t('Result')}
          options={[['', t('All')], ['ok', t('Successful')], ['error', t('Errors'), 'critical'], ['rejected', t('Rejected'), 'warning'], ['client', t('App-side failures'), 'critical']]} />
        <label className="td-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder={t('Search path, IP or user…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
      </div>
      {preset && (
        <div className="td-filter">
          <Icon name="filter" size={14} /><span>{t('Filtered by')}: {preset.label}</span>
          <button type="button" aria-label={t('Clear filter')} onClick={() => { setPage(1); onClearPreset(); }}><Icon name="x" size={12} /></button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {rows === null ? <Skeleton rows={8} cols={3} /> : rows.length === 0 ? (
        <EmptyState icon="inbox" title={t('No matching requests.')} />
      ) : (
        <div className="td-list">
          {rows.map((r) => {
            const k = dayKey(r.created_at);
            const head = k !== lastDay ? <div className="td-day" key={`d-${r.id}`}>{dayLabel(r.created_at, locale, t)}</div> : null;
            lastDay = k;
            return <Fragment key={r.id}>{head}<RequestItem r={r} t={t} locale={locale} onOpen={onOpen} /></Fragment>;
          })}
        </div>
      )}
      {meta && meta.pages > 1 && (
        <div className="td-pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('Previous')}</button>
          <span>{t('Page')} {meta.page} {t('of')} {meta.pages} · {num(meta.total)} {t('requests')}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>{t('Next')}</button>
        </div>
      )}
    </Card>
  );
}

function LatestErrors({ id, t, locale, onOpen, onViewAll, refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`${API}/${id}/requests?status=error&per_page=10`)
      .then((res) => { if (alive) setRows((res.data || []).slice(0, 5)); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [id, refreshKey]);
  return (
    <Card icon="alert-triangle" title={t('Latest errors')} action={rows && rows.length > 0 ? <button type="button" className="td-link" onClick={onViewAll}>{t('View all')}</button> : null}>
      {rows === null ? <Skeleton rows={3} cols={3} /> : rows.length === 0 ? (
        <EmptyState icon="check-circle" title={t('No errors recorded — everything looks fine.')} />
      ) : (
        <div className="td-list">{rows.map((r) => <RequestItem key={r.id} r={r} t={t} locale={locale} onOpen={onOpen} />)}</div>
      )}
    </Card>
  );
}

/** Failure alerts: who gets a phone push when the app breaks, and how often (settings live on the server, global). */
function AlertSettingsCard({ id, t }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => {
    let alive = true;
    api.get(`${API}/alert-settings`).then((res) => { if (alive) setCfg(res.data); }).catch(() => { if (alive) setCfg(false); });
    return () => { alive = false; };
  }, []);

  const save = async (patch) => {
    const prev = cfg;
    setCfg({ ...cfg, ...patch });
    try { setCfg((await api.put(`${API}/alert-settings`, patch)).data); } catch (e) { setCfg(prev); setMsg({ ok: false, text: errorMessage(e) }); }
  };
  const test = async () => {
    setBusy('test'); setMsg(null);
    try { await api.post(`${API}/${id}/alert-test`, {}); setMsg({ ok: true, text: t('Test alert sent — it should appear on your phone in a few seconds.') }); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(''); }
  };

  const Row = ({ k, title, hint }) => (
    <label className="td-switch">
      <span><strong>{title}</strong><small>{hint}</small></span>
      <input type="checkbox" role="switch" checked={!!cfg?.[k]} disabled={k !== 'enabled' && !cfg?.enabled} onChange={(e) => save({ [k]: e.target.checked })} />
      <i aria-hidden="true" />
    </label>
  );

  return (
    <Card icon="bell" title={t('Failure alerts')} hint={t('A push notification on your phone the moment the app breaks.')}>
      {cfg === null ? <Skeleton rows={3} cols={2} /> : cfg === false ? <p className="form-error">{t('Could not load the alert settings.')}</p> : (
        <div className="td-alerts">
          <Row k="enabled" title={t('Send failure alerts')} hint={t('Admins get a push notification (even when the app is closed).')} />
          <Row k="server_errors" title={t('Server errors (5xx)')} hint={t('A request from the app crashed on the server.')} />
          <Row k="upload_failures" title={t('Failed uploads')} hint={t('A video / file upload reached the server and was rejected.')} />
          <Row k="app_failures" title={t('App-side failures')} hint={t('The app reports a failure that never reached the server (e.g. a video upload that died).')} />
          <div className="td-alerts__row">
            <span>{t('Repeat the same alert at most once every')}</span>
            <select className="td-select" value={cfg.cooldown_minutes} disabled={!cfg.enabled} onChange={(e) => save({ cooldown_minutes: Number(e.target.value) })}>
              {[2, 5, 10, 30, 60, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} ${t('min')}` : `${m / 60} ${t('h')}`}</option>)}
            </select>
          </div>
          <div className="td-alerts__row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={test} disabled={busy === 'test'}><Icon name="bell" size={14} /> {t('Send a test alert')}</button>
            {msg && <span className={msg.ok ? 'td-alerts__ok' : 'form-error'}>{msg.text}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ page */
export default function AdminMobileTokenDetail() {
  const { id } = useParams();
  const { locale } = useLanguage();
  const t = useTranslations(translations);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search] = useSearchParams(); // an alert opens /admin/mobile/:id?tab=log&status=client|error
  const qTab = search.get('tab');
  const qStatus = ['error', 'client', 'ok', 'rejected'].includes(search.get('status')) ? search.get('status') : '';
  const [tab, setTab] = useState(['overview', 'log', 'users', 'ips', 'devices', 'endpoints'].includes(qTab) ? qTab : 'overview');
  const [preset, setPreset] = useState(qStatus ? { status: qStatus, label: qStatus === 'client' ? t('App-side failures') : t('Errors') } : null);
  const [live, setLive] = useState(() => { try { return localStorage.getItem('uip_td_live') !== '0'; } catch { return true; } });
  const [lastSync, setLastSync] = useState(null); // { user_id | ip | status_code | endpoint+method | device, status?, label }
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [blockedList, setBlockedList] = useState([]);
  const [blockTarget, setBlockTarget] = useState(null);   // { device_id, label }
  const [unblockTarget, setUnblockTarget] = useState(null); // { id, label }
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.get(`${API}/${id}`)
      .then((res) => setData(res.data))
      .catch((e) => setError(errorMessage(e)));
    api.get(`${API}/blocked-devices`).then((res) => setBlockedList(res.data || [])).catch(() => {});
  }, [id]);

  async function confirmBlock(reason) {
    setDeviceBusy(true); setDeviceError(null);
    try {
      await api.post(`${API}/blocked-devices`, { device_id: blockTarget.device_id, label: blockTarget.label, reason });
      setBlockTarget(null); load();
    } catch (e) { setDeviceError(errorMessage(e)); setBlockTarget(null); } finally { setDeviceBusy(false); }
  }
  async function confirmUnblock() {
    setDeviceBusy(true); setDeviceError(null);
    try {
      await api.del(`${API}/blocked-devices/${unblockTarget.id}`);
      setUnblockTarget(null); load();
    } catch (e) { setDeviceError(errorMessage(e)); setUnblockTarget(null); } finally { setDeviceBusy(false); }
  }
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); setRefreshKey((k) => k + 1); };
  // Auto-sync: while the tab is visible, re-pull the summary + log + chart every 15 s, right after the tab/window regains focus,
  // and immediately when a push arrives (a failure alert is exactly the moment new rows exist).
  const sync = useCallback(() => {
    api.get(`${API}/${id}`).then((res) => { setData(res.data); setLastSync(new Date()); }).catch(() => {});
    setRefreshKey((k) => k + 1);
  }, [id]);
  useLive(sync, { interval: 15000, enabled: live && !!data });
  useEffect(() => {
    if (!live) return undefined;
    window.addEventListener('uip:push-received', sync);
    return () => window.removeEventListener('uip:push-received', sync);
  }, [live, sync]);
  const toggleLive = () => setLive((v) => { const n = !v; try { localStorage.setItem('uip_td_live', n ? '1' : '0'); } catch { /* storage blocked */ } return n; });

  const actions = (
    <>
      <button type="button" className={`td-live${live ? ' is-on' : ''}`} onClick={toggleLive} aria-pressed={live}
        title={live ? `${t('Auto-sync is on')}${lastSync ? ` · ${fmtTime(lastSync, locale)}` : ''}` : t('Auto-sync is off')}>
        <i aria-hidden="true" />{live ? t('Live') : t('Paused')}
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={reload}><Icon name="refresh" size={14} /> {t('Refresh')}</button>
      <Link to="/admin/mobile" className="btn btn-secondary btn-sm"><Icon name={locale === 'ar' ? 'arrow-right' : 'arrow-left'} size={14} /> {t('Back to tokens')}</Link>
    </>
  );

  if (error) return <AdminPage icon="smartphone" title={t('Token details')} actions={actions}><ErrorState error={error} onRetry={load} /></AdminPage>;
  if (!data) return <AdminPage icon="smartphone" title={t('Token details')} actions={actions}><Skeleton rows={6} cols={4} /></AdminPage>;

  const { token, summary: s } = data;
  const tot = s.totals || {};
  const total = Number(tot.total) || 0;
  const revoked = Boolean(token.revoked_at);
  const pct = (n) => (total ? (Number(n) / total) * 100 : 0);
  const showLog = (p) => { setPreset(p); setTab('log'); };
  const selectTab = (k) => { setPreset(null); setTab(k); };
  const errOf = (p) => ({ ...p, status: 'error', label: `${p.label} · ${t('Errors')}` });

  // 2xx / 3xx / 4xx / 5xx share of all requests
  const cls = { 2: 0, 3: 0, 4: 0, 5: 0 };
  (s.statuses || []).forEach((r) => { const k = Math.floor(Number(r.status) / 100); if (k in cls) cls[k] += Number(r.n); });
  const okRate = total ? Math.round(((cls[2] + cls[3]) / total) * 1000) / 10 : 0;
  const classLabel = { 2: t('Success (2xx)'), 3: t('Redirects (3xx)'), 4: t('Client errors (4xx)'), 5: t('Server errors (5xx)') };

  const tabs = [
    ['overview', t('Overview'), null], ['log', t('Request log'), total + (Number(tot.client_failures) || 0)], ['users', t('Users'), tot.users],
    ['ips', t('IP addresses'), tot.ips], ['devices', t('Devices'), tot.devices], ['endpoints', t('Endpoints'), (s.endpoints || []).length],
  ];

  const userRow = (u) => {
    const p = { user_id: u.id, label: u.full_name };
    return (
      <Entity key={u.id} lead={initials(u.full_name)}
        title={<>{u.full_name}{u.role && <Chip tone="primary">{u.role}</Chip>}</>} sub={u.email}
        meta={<>
          <Chip icon="clock">{t('Last seen')}: {rel(u.last_at, locale)}</Chip>
          <Chip icon="calendar">{t('First seen')}: {fmtDate(u.first_at, locale)}</Chip>
          {Number(u.errors) > 0 && <Chip tone="danger" icon="alert-triangle">{num(u.errors)} {t('errors')}</Chip>}
        </>}
        n={u.n} unit={t('requests')} pct={pct(u.n)}
        actions={<><Btn onClick={() => showLog(p)}>{t('Show requests')}</Btn>{Number(u.errors) > 0 && <Btn onClick={() => showLog(errOf(p))}>{t('Show errors')}</Btn>}</>} />
    );
  };
  const endpointRow = (e) => {
    const p = { endpoint: e.endpoint, method: e.method, label: `${e.method} ${e.endpoint}` };
    return (
      <Entity key={`${e.method}-${e.endpoint}`} lead={<Icon name="link" size={20} />}
        title={<><Method m={e.method} /><span className="td-mono" dir="ltr">{e.endpoint}</span></>}
        meta={<>
          <Chip icon="clock">{t('Last seen')}: {rel(e.last_at, locale)}</Chip>
          {Number(e.errors) > 0 && <Chip tone="danger" icon="alert-triangle">{num(e.errors)} {t('errors')}</Chip>}
        </>}
        n={e.n} unit={t('requests')} pct={pct(e.n)}
        actions={<><Btn onClick={() => showLog(p)}>{t('Show requests')}</Btn>{Number(e.errors) > 0 && <Btn onClick={() => showLog(errOf(p))}>{t('Show errors')}</Btn>}</>} />
    );
  };

  return (
    <AdminPage icon="smartphone" title={token.name} subtitle={`${t('Token ID')} #${token.id}`} actions={actions}>
      <div className="td-page">
        <div className="td-info">
          <Info label={t('Status')}><span className={`td-pill ${revoked ? 'td-pill--off' : 'td-pill--ok'}`}>{revoked ? t('Revoked') : t('Active')}</span></Info>
          <Info label={t('Issued by')}>{token.created_by_name || '—'}{token.created_by_email && <small>{token.created_by_email}</small>}</Info>
          <Info label={t('Issued on')}>{fmt(token.created_at, locale)}</Info>
          <Info label={t('Last used')}>{token.last_used_at ? <>{rel(token.last_used_at, locale)}<small>{fmt(token.last_used_at, locale)}</small></> : t('Never used')}</Info>
          {revoked && <Info label={t('Revoked on')}>{fmt(token.revoked_at, locale)}</Info>}
          <Info label={t('First seen')}>{fmt(tot.first_seen, locale)}</Info>
          <Info label={t('Last seen')}>{tot.last_seen ? <>{rel(tot.last_seen, locale)}<small>{fmt(tot.last_seen, locale)}</small></> : '—'}</Info>
        </div>

        <KpiGrid>
          <Kpi icon="pulse" title={t('Total requests')} value={num(tot.total)} />
          <Kpi icon="clock" title={t('Last 24 hours')} value={num(s.last_24h)} />
          <Kpi icon="calendar" title={t('Last 7 days')} value={num(s.last_7d)} />
          <Kpi icon="users" title={t('Unique users')} value={num(tot.users)} note={tot.anonymous ? `${num(tot.anonymous)} ${t('Before login')}` : undefined} />
          <Kpi icon="globe" title={t('Unique IPs')} value={num(tot.ips)} />
          <Kpi icon="smartphone" title={t('Devices')} value={num(tot.devices)} />
          <Kpi icon="alert-triangle" title={t('Errors (4xx/5xx)')} value={num(tot.errors)} tone={tot.errors ? 'warning' : undefined} />
          <Kpi icon="shield" title={t('Rejected (revoked)')} value={num(tot.rejected)} tone={tot.rejected ? 'critical' : undefined} />
          <Kpi icon="smartphone" title={t('App-side failures')} value={num(tot.client_failures)} tone={tot.client_failures ? 'critical' : undefined} note={tot.client_failures ? t('Never reached the server') : undefined} />
        </KpiGrid>

        {!total && !tot.client_failures ? (
          <section className="td-card">
            <EmptyState icon="inbox" title={t('No requests recorded yet')} hint={t('Usage is recorded from the moment this update is deployed. Anything this token did before that is only visible as the "last used" time.')} />
          </section>
        ) : (
          <>
            <div className="td-tabs" role="tablist" aria-label={t('Token details')}>
              {tabs.map(([k, label, n]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`td-tab${tab === k ? ' is-active' : ''}`} onClick={() => selectTab(k)}>
                  {label}{n != null && <b>{num(n)}</b>}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <>
                <RequestsChartCard id={id} s={s} t={t} locale={locale} refreshKey={refreshKey} />

                <div className="td-grid">
                  <Card icon="shield" title={t('Health')}>
                    <div className="td-rate"><strong>{okRate}%</strong><span>{t('Success rate')}</span></div>
                    <div className="td-stack" role="img" aria-label={t('Health')}>
                      {[2, 3, 4, 5].map((k) => cls[k] > 0 && <i key={k} className={`c${k}`} style={{ width: `${pct(cls[k])}%` }} title={`${classLabel[k]} — ${num(cls[k])}`} />)}
                    </div>
                    <div className="td-legend">
                      {[2, 3, 4, 5].map((k) => cls[k] > 0 && <span key={k} className={`c${k}`}>{classLabel[k]} · {num(cls[k])}</span>)}
                    </div>
                    <div className="td-codes">
                      {(s.statuses || []).map((r) => (
                        <div className="td-code" key={r.status}>
                          <span className={`badge ${statusTone(r.status)}`}>{r.status}</span>
                          <span className="td-code__name">{httpText(r.status, locale)}<small>{t('Last seen')}: {rel(r.last_at, locale)}</small></span>
                          <span className="td-code__n">{num(r.n)}</span>
                          <Btn onClick={() => showLog({ status_code: r.status, label: `HTTP ${r.status} · ${httpText(r.status, locale)}` })}>{t('Show requests')}</Btn>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <AlertSettingsCard id={id} t={t} />
                  <LatestErrors id={id} t={t} locale={locale} onOpen={setDetail} refreshKey={refreshKey}
                    onViewAll={() => showLog({ status: 'error', label: t('Errors') })} />
                </div>

                <div className="td-grid">
                  <Card icon="users" title={t('Top users')} action={(s.users || []).length > 5 ? <button type="button" className="td-link" onClick={() => selectTab('users')}>{t('View all')}</button> : null}>
                    {(s.users || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : <div className="td-list">{(s.users || []).slice(0, 5).map(userRow)}</div>}
                  </Card>
                  <Card icon="link" title={t('Top endpoints')} action={(s.endpoints || []).length > 5 ? <button type="button" className="td-link" onClick={() => selectTab('endpoints')}>{t('View all')}</button> : null}>
                    {(s.endpoints || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : <div className="td-list">{(s.endpoints || []).slice(0, 5).map(endpointRow)}</div>}
                  </Card>
                </div>
              </>
            )}

            {tab === 'log' && (
              <RequestLog id={id} t={t} locale={locale} preset={preset} onClearPreset={() => setPreset(null)} onOpen={setDetail} refreshKey={refreshKey} />
            )}

            {tab === 'users' && (
              <Card icon="users" title={t('Users')} hint={`${num(tot.users)} ${t('unique users')}`}>
                {(s.users || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : <div className="td-list">{(s.users || []).map(userRow)}</div>}
              </Card>
            )}

            {tab === 'ips' && (
              <Card icon="globe" title={t('IP addresses')}>
                {(s.ips || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : (
                  <div className="td-list">
                    {(s.ips || []).map((r) => {
                      const p = { ip: r.ip, label: r.ip };
                      return (
                        <Entity key={r.ip} lead={<Icon name="globe" size={20} />}
                          title={<span className="td-mono" dir="ltr">{r.ip}</span>} sub={`${num(r.users)} ${t('unique users')}`}
                          meta={<>
                            <Chip icon="clock">{t('Last seen')}: {rel(r.last_at, locale)}</Chip>
                            <Chip icon="calendar">{t('First seen')}: {fmtDate(r.first_at, locale)}</Chip>
                            {Number(r.errors) > 0 && <Chip tone="danger" icon="alert-triangle">{num(r.errors)} {t('errors')}</Chip>}
                          </>}
                          n={r.n} unit={t('requests')} pct={pct(r.n)}
                          actions={<><Btn onClick={() => showLog(p)}>{t('Show requests')}</Btn>{Number(r.errors) > 0 && <Btn onClick={() => showLog(errOf(p))}>{t('Show errors')}</Btn>}</>} />
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            {tab === 'devices' && (
              <Card icon="smartphone" title={t('Devices')}>
                {deviceError && <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>{deviceError}</div>}
                {(s.devices || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : (
                  <div className="td-list">
                    {(s.devices || []).map((d, i) => {
                      const key = d.dev || d.ua || '';
                      const p = { device: key, label: deviceName(d.ua) };
                      return (
                        <Entity key={`${key}-${i}`} lead={<Icon name="smartphone" size={20} />}
                          title={<>{deviceName(d.ua)}{d.blocked && <Chip tone="danger" icon="shield">{t('Blocked')}</Chip>}{d.client && <Chip tone="primary">{d.client}</Chip>}{isWebView(d.ua) && <Chip>WebView</Chip>}</>}
                          sub={d.dev ? <span className="td-mono" dir="ltr">{d.dev}</span> : t('No device ID')}
                          meta={<>
                            <Chip icon="users">{num(d.users)} {t('unique users')}</Chip>
                            <Chip icon="clock">{t('Last seen')}: {rel(d.last_at, locale)}</Chip>
                            <Chip icon="calendar">{t('First seen')}: {fmtDate(d.first_at, locale)}</Chip>
                            {Number(d.errors) > 0 && <Chip tone="danger" icon="alert-triangle">{num(d.errors)} {t('errors')}</Chip>}
                          </>}
                          extra={d.ua ? <details className="td-ua"><summary>User-Agent</summary><code>{d.ua}</code></details> : null}
                          n={d.n} unit={t('requests')} pct={pct(d.n)}
                          actions={key ? <>
                            <Btn onClick={() => showLog(p)}>{t('Show requests')}</Btn>
                            {Number(d.errors) > 0 && <Btn onClick={() => showLog(errOf(p))}>{t('Show errors')}</Btn>}
                            {d.dev && (d.blocked
                              ? <Btn onClick={() => setUnblockTarget({ id: d.block_id, label: deviceName(d.ua) })}>{t('Unblock')}</Btn>
                              : <Btn danger onClick={() => setBlockTarget({ device_id: d.dev, label: deviceName(d.ua) })}>{t('Block device')}</Btn>)}
                          </> : null} />
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            {tab === 'devices' && blockedList.length > 0 && (
              <Card icon="shield" title={t('Blocked devices')}>
                <div className="td-list">
                  {blockedList.map((b) => (
                    <Entity key={b.id} lead={<Icon name="shield" size={20} />}
                      title={<>{b.label || t('Device')}<Chip tone="danger">{t('Blocked')}</Chip></>}
                      sub={<span className="td-mono" dir="ltr">{b.device_id}</span>}
                      meta={<>
                        <Chip icon="calendar">{t('Blocked on')}: {fmt(b.created_at, locale)}</Chip>
                        {b.blocked_by_name && <Chip icon="user">{b.blocked_by_name}</Chip>}
                        {b.reason && <Chip>{b.reason}</Chip>}
                      </>}
                      n={0} unit="" pct={0}
                      actions={<Btn onClick={() => setUnblockTarget({ id: b.id, label: b.label || b.device_id })}>{t('Unblock')}</Btn>} />
                  ))}
                </div>
              </Card>
            )}

            {tab === 'endpoints' && (
              <Card icon="link" title={t('Endpoints')}>
                {(s.endpoints || []).length === 0 ? <EmptyState icon="inbox" title={t('Nothing here yet.')} /> : <div className="td-list">{(s.endpoints || []).map(endpointRow)}</div>}
              </Card>
            )}
          </>
        )}
      </div>
      {blockTarget && <BlockDeviceModal target={blockTarget} t={t} busy={deviceBusy} onConfirm={confirmBlock} onClose={() => setBlockTarget(null)} />}
      {unblockTarget && (
        <ConfirmModal
          title={t('Unblock device')}
          message={t('Unblock "{name}"? It can use the app again right away.').replace('{name}', unblockTarget.label)}
          confirmLabel={t('Unblock')}
          busy={deviceBusy}
          onConfirm={confirmUnblock}
          onClose={() => setUnblockTarget(null)}
        />
      )}
      {detail && <RequestDetail r={detail} t={t} locale={locale} onClose={() => setDetail(null)} />}
    </AdminPage>
  );
}
