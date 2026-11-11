import { useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import '../../styles/css/bulk-users.css';

/**
 * Bulk "Add users" dialog — a row editor, one card per account, each with its OWN role.
 *   Arabic name | English name | email | password | phone (optional) | role | super admin
 * Paste from Excel/Sheets works two ways: into the first field of any row (fills rows from there),
 * or through the "Paste from Excel" panel. Pasted columns: ar, en, email, password, phone, role?, joker?
 * (separators: tab, | or comma). POST /api/v1/admin/users/bulk — every row is independent.
 */
const MAX_ROWS = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let uid = 0;
const blankRow = (role) => ({ id: ++uid, name_ar: '', name_en: '', email: '', password: '', phone: '', role, is_joker: false });
const isEmpty = (r) => !(r.name_ar || r.name_en || r.email || r.password || r.phone);
const looksLikeTable = (s) => /[\n\t|]/.test(s.trim());

function rowProblems(r) {
  const p = {};
  if (!r.name_ar.trim()) p.name_ar = true;
  if (!r.name_en.trim()) p.name_en = true;
  if (!EMAIL_RE.test(r.email.trim())) p.email = true;
  if (!r.password) p.password = true;
  if (!r.role) p.role = true;
  return p;
}

export default function BulkUsersModal({ roles, onClose, onDone }) {
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const defaultRole = roles.find((r) => r.slug === 'student')?.slug || roles[0]?.slug || '';

  const [rows, setRows] = useState(() => [blankRow(defaultRole), blankRow(defaultRole), blankRow(defaultRole)]);
  const [newRole, setNewRole] = useState(defaultRole);
  const [showPass, setShowPass] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const sentIds = useRef([]);

  const filled = useMemo(() => rows.filter((r) => !isEmpty(r)), [rows]);
  const invalidCount = useMemo(() => filled.filter((r) => Object.keys(rowProblems(r)).length).length, [filled]);
  const roleName = (slug) => roles.find((r) => r.slug === slug)?.name || slug;
  const roleCounts = useMemo(() => {
    const m = {};
    filled.forEach((r) => { m[r.role] = (m[r.role] || 0) + 1; });
    return Object.entries(m);
  }, [filled]);

  const patch = (id, changes) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const remove = (id) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [blankRow(newRole)]));
  const addRow = () => setRows((rs) => (rs.length >= MAX_ROWS ? rs : [...rs, blankRow(newRole)]));

  function resolveRole(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return newRole;
    const hit = roles.find((r) => r.slug.toLowerCase() === s || String(r.name || '').toLowerCase() === s);
    return hit ? hit.slug : newRole;
  }

  function parseTable(text) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const sep = line.includes('|') ? '|' : line.includes('\t') ? '\t' : ',';
      const [name_ar = '', name_en = '', email = '', password = '', phone = '', role = '', joker = ''] = line.split(sep).map((c) => c.trim());
      return {
        id: ++uid, name_ar, name_en, email, password, phone,
        role: resolveRole(role),
        is_joker: /^(1|true|yes|y|joker|super_admin|superadmin|super admin|سوبر أدمن|نعم)$/i.test(joker),
      };
    });
  }

  /** Replace the row at `startId` (and the ones after it) with pasted rows; extra rows are appended. */
  function insertPasted(text, startId) {
    const parsed = parseTable(text);
    if (!parsed.length) return;
    setRows((rs) => {
      const at = startId == null ? rs.length : Math.max(0, rs.findIndex((r) => r.id === startId));
      const head = rs.slice(0, at);
      // Overwrite blank rows that follow the start point, keep any filled rows after the pasted block.
      let tail = rs.slice(at);
      while (tail.length && isEmpty(tail[0]) && parsed.length) { tail = tail.slice(1); }
      return [...head, ...parsed, ...tail].slice(0, MAX_ROWS);
    });
  }

  function onFieldPaste(e, id) {
    const text = e.clipboardData?.getData('text') || '';
    if (!looksLikeTable(text)) return; // single value: normal paste
    e.preventDefault();
    insertPasted(text, id);
  }

  function applyRoleToAll() { setRows((rs) => rs.map((r) => ({ ...r, role: newRole }))); }

  async function submit() {
    if (busy) return;
    if (filled.length === 0) { setError(tr('Add at least one account.', 'ضيف حساب واحد على الأقل.')); return; }
    if (filled.length > MAX_ROWS) { setError(tr(`Maximum ${MAX_ROWS} accounts per batch.`, `الحد الأقصى ${MAX_ROWS} حساب في المرة.`)); return; }
    if (invalidCount > 0) {
      setShowErrors(true);
      setError(tr(`${invalidCount} account(s) have missing or invalid fields (marked in red).`, `${invalidCount} حساب فيهم بيانات ناقصة أو غلط (متعلّمة بالأحمر).`));
      return;
    }
    setBusy(true); setError(null);
    sentIds.current = filled.map((r) => r.id);
    try {
      const res = await api.post('/api/v1/admin/users/bulk', {
        users: filled.map((r) => ({
          name_ar: r.name_ar.trim(), name_en: r.name_en.trim(), email: r.email.trim(),
          password: r.password, phone: r.phone.trim(), role: r.role, is_joker: r.is_joker,
        })),
      });
      setResult(res.data);
      if (res.data?.created > 0) onDone?.();
    } catch (err) {
      const d = err?.payload?.data;
      if (d?.results) setResult(d); else setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  /** Back to the editor keeping only the rows that failed, so they can be fixed and re-sent. */
  function backToFailed() {
    const failedIds = new Set();
    (result?.results || []).forEach((r, i) => { if (!r.ok && sentIds.current[i] != null) failedIds.add(sentIds.current[i]); });
    setRows((rs) => {
      const keep = rs.filter((r) => failedIds.has(r.id));
      return keep.length ? keep : [blankRow(newRole)];
    });
    setResult(null); setError(null); setShowErrors(false);
  }

  const cls = (r, k) => `bu-input${showErrors && !isEmpty(r) && rowProblems(r)[k] ? ' bu-input--bad' : ''}`;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-box card glass-panel bu-modal" role="dialog" aria-modal="true" aria-labelledby="bu-title">
        <header className="bu-head">
          <span className="bu-head__icon" aria-hidden="true"><Icon name="users" size={22} /></span>
          <div className="bu-head__text">
            <h2 id="bu-title" className="modal-box__title text-h3">{tr('Add multiple users', 'إضافة عدة مستخدمين')}</h2>
            {!result && (
              <p className="bu-sub">{tr('Each account has its own role. Paste rows from Excel into the first field to fill several at once.',
                'كل حساب له الدور الخاص بيه. الصق صفوف من Excel في أول خانة في أي صف وهتتوزع لوحدها.')}</p>
            )}
          </div>
          <button type="button" className="bu-x" onClick={onClose} disabled={busy} aria-label={tr('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>

        {!result && (
          <>
            <div className="bu-toolbar">
              <div className="bu-tool">
                <span className="bu-tool__label">{tr('Role for new rows', 'الدور للصفوف الجديدة')}</span>
                <div className="bu-tool__row">
                  <select className="bu-input" aria-label={tr('Role for new rows', 'الدور للصفوف الجديدة')} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    {roles.map((r) => <option key={r.slug} value={r.slug}>{r.name || r.slug}</option>)}
                  </select>
                  <button type="button" className="btn btn-outline btn-sm" onClick={applyRoleToAll}>{tr('Apply to all rows', 'طبّقه على كل الصفوف')}</button>
                </div>
              </div>
              <span className="bu-spacer" />
              <label className="bu-switch">
                <input type="checkbox" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} />
                <span className="bu-switch__track" aria-hidden="true" />
                <span>{tr('Show passwords', 'إظهار كلمات المرور')}</span>
              </label>
              <button type="button" className={`btn btn-sm ${pasteOpen ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
                <Icon name="copy" size={15} /> {tr('Paste from Excel', 'لصق من Excel')}
              </button>
            </div>

            {pasteOpen && (
              <div className="bu-paste">
                <textarea
                  dir="ltr" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'هيثم محمد كامل | Haitham Mohamed Kamel | haitham@example.com | Str0ng!Pass1 | +201000000000 | student'}
                  className="bu-input bu-mono"
                />
                <div className="bu-paste__foot">
                  <small>{tr('Columns: Arabic name, English name, email, password, phone, role (optional), super admin (optional). Rows without a role get the role chosen above.',
                    'الأعمدة: الاسم عربي، الاسم إنجليزي، الإيميل، كلمة المرور، الهاتف، الدور (اختياري)، سوبر أدمن (اختياري). الصف من غير دور ياخد الدور المختار فوق.')}</small>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!pasteText.trim()}
                    onClick={() => { insertPasted(pasteText, null); setPasteText(''); setPasteOpen(false); }}>
                    {tr('Add these rows', 'ضيف الصفوف دي')}
                  </button>
                </div>
              </div>
            )}

            <div className="bu-table">
              <div className="bu-cols" aria-hidden="true">
                <span>#</span>
                <span>{tr('Name (Arabic)', 'الاسم بالعربي')}</span>
                <span>{tr('Name (English)', 'الاسم بالإنجليزي')}</span>
                <span>{tr('Email', 'الإيميل')}</span>
                <span>{tr('Password', 'كلمة المرور')}</span>
                <span>{tr('Phone', 'الهاتف')}</span>
                <span>{tr('Role', 'الدور')}</span>
                <span>{tr('Super Admin', 'سوبر أدمن')}</span>
                <span />
              </div>
              <ol className="bu-rows">
                {rows.map((r, i) => (
                  <li key={r.id} className={`bu-row${isEmpty(r) ? ' bu-row--empty' : ''}`}>
                    <span className="bu-num" aria-hidden="true">{i + 1}</span>
                    <input className={`${cls(r, 'name_ar')} bu-f-ar`} dir="rtl" value={r.name_ar} placeholder={tr('Name (Arabic)', 'الاسم بالعربي')}
                      aria-label={tr('Arabic name', 'الاسم بالعربي')} onChange={(e) => patch(r.id, { name_ar: e.target.value })} onPaste={(e) => onFieldPaste(e, r.id)} />
                    <input className={`${cls(r, 'name_en')} bu-f-en`} dir="ltr" value={r.name_en} placeholder={tr('Name (English)', 'الاسم بالإنجليزي')}
                      aria-label={tr('English name', 'الاسم بالإنجليزي')} onChange={(e) => patch(r.id, { name_en: e.target.value })} />
                    <input className={`${cls(r, 'email')} bu-f-email`} dir="ltr" type="email" value={r.email} placeholder="email@example.com" autoComplete="off"
                      aria-label={tr('Email', 'الإيميل')} onChange={(e) => patch(r.id, { email: e.target.value })} />
                    <input className={`${cls(r, 'password')} bu-f-pass`} dir="ltr" type={showPass ? 'text' : 'password'} value={r.password} placeholder={tr('Password', 'كلمة المرور')} autoComplete="new-password"
                      aria-label={tr('Password', 'كلمة المرور')} onChange={(e) => patch(r.id, { password: e.target.value })} />
                    <input className={`${cls(r, 'phone')} bu-f-phone`} dir="ltr" value={r.phone} placeholder={tr('Phone (optional)', 'الهاتف (اختياري)')}
                      aria-label={tr('Phone', 'الهاتف')} onChange={(e) => patch(r.id, { phone: e.target.value })} />
                    <select className={`${cls(r, 'role')} bu-f-role`} value={r.role} aria-label={tr('Role', 'الدور')} onChange={(e) => patch(r.id, { role: e.target.value })}>
                      {roles.map((o) => <option key={o.slug} value={o.slug}>{o.name || o.slug}</option>)}
                    </select>
                    <label className="bu-joker bu-f-joker" title={tr('Super Admin: all roles + role switcher', 'سوبر أدمن: كل الأدوار + تبديل')}>
                      <input type="checkbox" checked={r.is_joker} onChange={(e) => patch(r.id, { is_joker: e.target.checked })} />
                      <Icon name="star" size={14} />
                      <span>{tr('Super Admin', 'سوبر أدمن')}</span>
                    </label>
                    <button type="button" className="bu-del" onClick={() => remove(r.id)} aria-label={tr('Remove row', 'احذف الصف')}><Icon name="trash" size={16} /></button>
                  </li>
                ))}
              </ol>
              <button type="button" className="bu-add-strip" onClick={addRow} disabled={rows.length >= MAX_ROWS}>
                <Icon name="plus" size={16} /> {tr('Add another account', 'إضافة حساب تاني')}
              </button>
            </div>

            {error && <p className="um-msg um-msg--error" role="alert">{error}</p>}

            <footer className="bu-foot">
              <div className="bu-summary" aria-live="polite">
                <strong className="bu-count">{tr(`${filled.length} account(s)`, `${filled.length} حساب`)}</strong>
                {roleCounts.map(([slug, n]) => (
                  <span key={slug} className="bu-chip">{roleName(slug)} <b>{n}</b></span>
                ))}
              </div>
              <div className="bu-actions">
                <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>{tr('Cancel', 'إلغاء')}</button>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || filled.length === 0}>
                  <Icon name="plus" size={16} /> {busy ? tr('Creating…', 'جاري الإنشاء…') : tr(`Create ${filled.length || ''} account(s)`, `إنشاء ${filled.length || ''} حساب`)}
                </button>
              </div>
            </footer>
          </>
        )}

        {result && (
          <>
            <p className="bu-sub">
              {tr(`${result.created} created, ${result.failed} failed.`, `اتعمل ${result.created} حساب، وفشل ${result.failed}.`)}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table" style={{ width: '100%' }}>
                <thead><tr><th>#</th><th>{tr('Email', 'الإيميل')}</th><th>{tr('Role', 'الدور')}</th><th>{tr('Result', 'النتيجة')}</th></tr></thead>
                <tbody>
                  {result.results.map((r, i) => {
                    const sent = rows.find((x) => x.id === sentIds.current[i]);
                    return (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td dir="ltr">{r.email}</td>
                        <td>{sent ? roleName(sent.role) : '—'}</td>
                        <td style={{ color: r.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>{r.ok ? tr('Created', 'تم') : r.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="bu-actions" style={{ marginTop: 12 }}>
              {result.failed > 0 && <button type="button" className="btn btn-outline" onClick={backToFailed}>{tr('Fix the failed ones', 'صلّح الفاشلين')}</button>}
              <button type="button" className="btn btn-primary" onClick={onClose}>{tr('Done', 'تم')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
