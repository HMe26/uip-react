import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';
import { L } from '../../i18n/localize';
import {
  EMPTY_FILTERS, QUICK_VIEWS, activeFilterCount, activeFilterKeys, clearKey,
  loadSavedViews, quickViewActive, storeSavedViews,
} from '../../lib/userFilters';

/**
 * Advanced filter toolbar for the admin users directory.
 * Fully controlled: parent owns `filters` (see lib/userFilters.js) and reloads when it changes.
 */

function Seg({ value, onChange, options, label }) {
  return (
    <div className="uf-seg" role="group" aria-label={label}>
      {options.map(([v, name]) => (
        <button key={v || 'any'} type="button" aria-pressed={value === v}
          className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>{name}</button>
      ))}
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <div className={`uf-field${wide ? ' uf-field--wide' : ''}`}>
      <span className="uf-field__label">{label}</span>
      {children}
    </div>
  );
}

function Group({ icon, title, children }) {
  return (
    <fieldset className="uf-group">
      <legend><Icon name={icon} size={15} /> {title}</legend>
      <div className="uf-group__grid">{children}</div>
    </fieldset>
  );
}


// "Newest first" / "A → Z" … instead of a bare arrow, so the current order is always readable.
function dirLabel(tr, sort, dir) {
  const isDate = sort === 'created_at' || sort === 'last_login_at';
  if (isDate) return dir === 'asc' ? tr('Oldest first', 'الأقدم أولاً') : tr('Newest first', 'الأحدث أولاً');
  return dir === 'asc' ? tr('A → Z', 'أ → ي') : tr('Z → A', 'ي → أ');
}

export default function UserFilters({ filters, onChange, roles, universities, facets, total, loading }) {
  const { locale } = useLanguage();
  const tr = (en, ar) => (locale === 'ar' ? ar : en);
  const lt = { locale };
  const name = (o) => (o ? L(lt, o.name_en, o.name_ar) : '');

  const [open, setOpen] = useState(false);
  const [views, setViews] = useState(loadSavedViews);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState('');

  // Debounced search box.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [qText, setQText] = useState(filters.q);
  useEffect(() => { setQText(filters.q); }, [filters.q]);
  useEffect(() => {
    if (qText === filtersRef.current.q) return undefined;
    const id = setTimeout(() => onChange({ ...filtersRef.current, q: qText }), 350);
    return () => clearTimeout(id);
  }, [qText]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => onChange({ ...filters, ...patch });
  const toggleIn = (key, val) => {
    const cur = filters[key];
    let next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
    if (key === 'status') next = val === 'deleted' ? (cur.includes('deleted') ? [] : ['deleted']) : next.filter((x) => x !== 'deleted');
    set({ [key]: next });
  };

  // University -> faculty -> department cascade.
  const uni = universities.find((u) => String(u.id) === filters.university_id);
  const faculties = uni?.faculties || [];
  const fac = faculties.find((f) => String(f.id) === filters.faculty_id);
  const departments = fac?.departments || [];
  const dep = departments.find((d) => String(d.id) === filters.department_id);

  const isTrash = filters.status.includes('deleted');
  const count = activeFilterCount(filters);
  const roleName = (slug) => { const r = roles.find((x) => x.slug === slug); return r ? name(r) || slug : slug; };

  const STATUS = [
    ['active', tr('Active', 'نشط')], ['pending', tr('Pending', 'قيد الانتظار')], ['suspended', tr('Suspended', 'موقوف')],
    ['banned', tr('Banned', 'محظور')], ['deleted', tr('Deleted', 'محذوف')],
  ];
  const INVITE = [
    ['', tr('Any', 'الكل')], ['pending', tr('Not joined yet', 'لسه ماانضمش')], ['accepted', tr('Joined', 'انضم')],
    ['expired', tr('Invite expired', 'الدعوة انتهت')], ['none', tr('No invitation', 'بدون دعوة')],
  ];
  const ANY_YES_NO = [['', tr('Any', 'الكل')], ['yes', tr('Yes', 'نعم')], ['no', tr('No', 'لا')]];
  const JOINED = [
    ['', tr('Any time', 'أي وقت')], ['d1', tr('Today', 'النهارده')], ['d7', tr('Last 7 days', 'آخر 7 أيام')],
    ['d30', tr('Last 30 days', 'آخر 30 يوم')], ['d90', tr('Last 90 days', 'آخر 90 يوم')],
    ['y1', tr('More than a year ago', 'من أكتر من سنة')], ['custom', tr('Custom range…', 'فترة مخصصة…')],
  ];
  const LOGIN = [
    ['', tr('Any', 'أي وقت')], ['never', tr('Never signed in', 'ماسجّلش دخول أبدًا')],
    ['d1', tr('Active today', 'دخل النهارده')], ['d7', tr('Active in last 7 days', 'دخل آخر 7 أيام')], ['d30', tr('Active in last 30 days', 'دخل آخر 30 يوم')],
    ['inactive30', tr('Inactive 30+ days', 'غايب +30 يوم')], ['inactive90', tr('Inactive 90+ days', 'غايب +90 يوم')],
    ['custom', tr('Custom range…', 'فترة مخصصة…')],
  ];
  const SORTS = [
    ['created_at', tr('Join date', 'تاريخ الانضمام')], ['last_login_at', tr('Last sign-in', 'آخر دخول')],
    ['full_name', tr('Name', 'الاسم')], ['email', tr('Email', 'الإيميل')], ['status', tr('Status', 'الحالة')], ['role', tr('Role', 'الدور')],
  ];

  // Human labels for the active-filter chips.
  const chips = useMemo(() => {
    const f = filters;
    const pick = (list, v) => (list.find(([x]) => x === v) || [])[1] || v;
    const rangeLabel = (a, b) => `${a || '…'} → ${b || '…'}`;
    const out = [];
    for (const k of activeFilterKeys(f)) {
      let label = '';
      switch (k) {
        case 'q': label = `${tr('Search', 'بحث')}: ${f.q}`; break;
        case 'role': label = `${tr('Role', 'الدور')}: ${f.role.map(roleName).join('، ')}`; break;
        case 'status': label = `${tr('Status', 'الحالة')}: ${f.status.map((s) => pick(STATUS, s)).join('، ')}`; break;
        case 'university_id': label = `${tr('University', 'الجامعة')}: ${name(uni) || f.university_id}`; break;
        case 'faculty_id': label = `${tr('Faculty', 'الكلية')}: ${name(fac) || f.faculty_id}`; break;
        case 'department_id': label = `${tr('Department', 'القسم')}: ${name(dep) || f.department_id}`; break;
        case 'academic_year': label = `${tr('Academic year', 'السنة الدراسية')}: ${f.academic_year}`; break;
        case 'affiliation': label = f.affiliation === 'none' ? tr('No university', 'بدون جامعة') : tr('Has a university', 'مرتبط بجامعة'); break;
        case 'invitation': label = `${tr('Invitation', 'الدعوة')}: ${pick(INVITE, f.invitation)}`; break;
        case 'verified': label = f.verified === 'yes' ? tr('Email verified', 'إيميل مُفعَّل') : tr('Email not verified', 'إيميل غير مُفعَّل'); break;
        case 'two_factor': label = f.two_factor === 'yes' ? tr('2FA on', '2FA مفعّل') : tr('2FA off', '2FA غير مفعّل'); break;
        case 'locked': label = f.locked === 'yes' ? tr('Locked', 'مقفول') : tr('Not locked', 'غير مقفول'); break;
        case 'joined': label = f.joined === 'custom' ? `${tr('Joined', 'الانضمام')}: ${rangeLabel(f.joined_from, f.joined_to)}` : `${tr('Joined', 'الانضمام')}: ${pick(JOINED, f.joined)}`; break;
        case 'login': label = f.login === 'custom' ? `${tr('Sign-in', 'آخر دخول')}: ${rangeLabel(f.login_from, f.login_to)}` : `${tr('Sign-in', 'آخر دخول')}: ${pick(LOGIN, f.login)}`; break;
        case 'email_domain': label = `${tr('Email domain', 'دومين الإيميل')}: @${f.email_domain.replace(/^@/, '')}`; break;
        case 'has_phone': label = f.has_phone === 'yes' ? tr('Has phone', 'عنده تليفون') : tr('No phone', 'بدون تليفون'); break;
        case 'has_avatar': label = f.has_avatar === 'yes' ? tr('Has photo', 'عنده صورة') : tr('No photo', 'بدون صورة'); break;
        default: label = k;
      }
      out.push({ key: k, label });
    }
    return out;
  }, [filters, universities, roles, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveView() {
    const n = viewName.trim();
    if (!n) return;
    const { sort, dir, per_page, ...rest } = filters; // eslint-disable-line no-unused-vars
    const next = [{ id: String(Date.now()), name: n, filters: { ...rest, sort, dir } }, ...views.filter((v) => v.name !== n)];
    setViews(next); storeSavedViews(next);
    setNaming(false); setViewName('');
  }
  function removeView(id) {
    const next = views.filter((v) => v.id !== id);
    setViews(next); storeSavedViews(next);
  }
  const applyQuick = (v) => {
    if (quickViewActive(filters, v)) {
      let n = filters;
      for (const k of Object.keys(v.patch)) n = clearKey(n, k);
      onChange(n);
    } else onChange({ ...filters, ...v.patch });
  };
  const reset = () => onChange({ ...EMPTY_FILTERS, per_page: filters.per_page, sort: filters.sort, dir: filters.dir });

  return (
    <section className="uf" aria-label={tr('Filters', 'الفلاتر')}>
      <div className="uf-bar">
        <label className="uf-search">
          <Icon name="search" size={16} />
          <input className="form-input" value={qText} onChange={(e) => setQText(e.target.value)}
            placeholder={tr('Search name, email, phone, student number…', 'ابحث بالاسم أو الإيميل أو التليفون أو الرقم الجامعي…')} />
          {qText && <button type="button" className="uf-search__x" onClick={() => { setQText(''); set({ q: '' }); }} aria-label={tr('Clear search', 'مسح البحث')}><Icon name="x" size={14} /></button>}
        </label>


        <div className="uf-controls">
          <button type="button" className={`btn btn-outline uf-toggle${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="filter" size={16} /> {tr('Filters', 'فلاتر')}
            {count > 0 && <span className="uf-badge">{count}</span>}
            <Icon name="chevron-down" size={14} />
          </button>
          <div className="uf-sort" role="group" aria-label={tr('Sorting', 'الترتيب')}>
            <span className="uf-sort__lbl">{tr('Sort', 'ترتيب')}</span>
            <select className="form-input" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} aria-label={tr('Sort by', 'ترتيب حسب')}>
              {SORTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
            <button type="button" className="uf-dir" onClick={() => set({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
              title={tr('Reverse the order', 'عكس الترتيب')} aria-label={tr('Toggle sort direction', 'عكس الترتيب')}>
              <svg className="uf-dir__ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {filters.dir === 'asc' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
              </svg>
              <span>{dirLabel(tr, filters.sort, filters.dir)}</span>
            </button>
          </div>
          <label className="uf-per-wrap">
            <span className="uf-sr">{tr('Rows per page', 'عدد الصفوف')}</span>
            <select className="form-input uf-per" value={filters.per_page} onChange={(e) => set({ per_page: e.target.value })}>
              {['20', '50', '100'].map((n) => <option key={n} value={n}>{n} / {tr('page', 'صفحة')}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="uf-quick" role="group" aria-label={tr('Quick views', 'عروض سريعة')}>
        <span className="uf-quick__lbl">{tr('Quick views', 'عروض سريعة')}</span>
        {QUICK_VIEWS.map((v) => (
          <button key={v.id} type="button" className={`uf-pill${quickViewActive(filters, v) ? ' is-on' : ''}`} aria-pressed={quickViewActive(filters, v)} onClick={() => applyQuick(v)}>
            <Icon name={v.icon} size={14} /> {tr(v.en, v.ar)}
          </button>
        ))}
        {views.map((v) => (
          <span key={v.id} className="uf-pill uf-pill--saved">
            <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS, per_page: filters.per_page, ...v.filters })}><Icon name="bookmark" size={14} /> {v.name}</button>
            <button type="button" className="uf-pill__x" onClick={() => removeView(v.id)} aria-label={tr('Delete saved view', 'حذف العرض المحفوظ')}><Icon name="x" size={12} /></button>
          </span>
        ))}
      </div>

      {open && (
        <div className="uf-panel">
          {isTrash && <p className="uf-note"><Icon name="info" size={15} /> {tr('The deleted list only supports text search. Pick another status to use the other filters.', 'قائمة المحذوفين بتدعم البحث النصي بس. اختار حالة تانية عشان تستخدم باقي الفلاتر.')}</p>}

          <Group icon="user" title={tr('Account', 'الحساب')}>
            <Field wide label={tr('Role (multi-select)', 'الدور (اختيار متعدد)')}>
              <div className="uf-multi">
                {roles.map((r) => (
                  <button key={r.slug} type="button" aria-pressed={filters.role.includes(r.slug)} className={`uf-tag${filters.role.includes(r.slug) ? ' is-on' : ''}`} onClick={() => toggleIn('role', r.slug)}>{name(r) || r.slug}</button>
                ))}
              </div>
            </Field>
            <Field wide label={tr('Status (multi-select)', 'الحالة (اختيار متعدد)')}>
              <div className="uf-multi">
                {STATUS.map(([v, n]) => (
                  <button key={v} type="button" aria-pressed={filters.status.includes(v)} className={`uf-tag uf-tag--${v}${filters.status.includes(v) ? ' is-on' : ''}`} onClick={() => toggleIn('status', v)}>{n}</button>
                ))}
              </div>
            </Field>
            <Field label={tr('Invitation / joining', 'الدعوة / الانضمام')}>
              <select className="form-input" value={filters.invitation} disabled={isTrash} onChange={(e) => set({ invitation: e.target.value })}>
                {INVITE.map(([v, n]) => <option key={v || 'any'} value={v}>{n}</option>)}
              </select>
            </Field>
            <Field label={tr('Email verified', 'الإيميل مُفعَّل')}><Seg label="verified" value={filters.verified} onChange={(v) => set({ verified: v })} options={ANY_YES_NO} /></Field>
            <Field label={tr('Two-factor enabled', 'التحقق بخطوتين')}><Seg label="2fa" value={filters.two_factor} onChange={(v) => set({ two_factor: v })} options={ANY_YES_NO} /></Field>
            <Field label={tr('Account locked', 'الحساب مقفول')}><Seg label="locked" value={filters.locked} onChange={(v) => set({ locked: v })} options={ANY_YES_NO} /></Field>
          </Group>

          <Group icon="building" title={tr('University & academic', 'الجامعة والأكاديمي')}>
            <Field label={tr('University', 'الجامعة')}>
              <select className="form-input" value={filters.university_id} disabled={isTrash}
                onChange={(e) => set({ university_id: e.target.value, faculty_id: '', department_id: '', affiliation: e.target.value ? '' : filters.affiliation })}>
                <option value="">{tr('All universities', 'كل الجامعات')}</option>
                {universities.map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}
              </select>
            </Field>
            <Field label={tr('Faculty', 'الكلية')}>
              <select className="form-input" value={filters.faculty_id} disabled={isTrash || !uni} onChange={(e) => set({ faculty_id: e.target.value, department_id: '' })}>
                <option value="">{uni ? tr('All faculties', 'كل الكليات') : tr('Pick a university first', 'اختار جامعة الأول')}</option>
                {faculties.map((f) => <option key={f.id} value={f.id}>{name(f)}</option>)}
              </select>
            </Field>
            <Field label={tr('Department', 'القسم')}>
              <select className="form-input" value={filters.department_id} disabled={isTrash || !fac} onChange={(e) => set({ department_id: e.target.value })}>
                <option value="">{fac ? tr('All departments', 'كل الأقسام') : tr('Pick a faculty first', 'اختار كلية الأول')}</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
              </select>
            </Field>
            <Field label={tr('Academic year (students)', 'السنة الدراسية (الطلاب)')}>
              <select className="form-input" value={filters.academic_year} disabled={isTrash} onChange={(e) => set({ academic_year: e.target.value })}>
                <option value="">{tr('Any', 'الكل')}</option>
                {(facets.academic_years?.length ? facets.academic_years : [1, 2, 3, 4, 5, 6]).map((y) => <option key={y} value={y}>{tr('Year', 'سنة')} {y}</option>)}
              </select>
            </Field>
            <Field label={tr('University link', 'الربط بجامعة')}>
              <Seg label="affiliation" value={filters.affiliation} onChange={(v) => set({ affiliation: v, university_id: v === 'none' ? '' : filters.university_id, faculty_id: v === 'none' ? '' : filters.faculty_id, department_id: v === 'none' ? '' : filters.department_id })}
                options={[['', tr('Any', 'الكل')], ['has', tr('Linked', 'مرتبط')], ['none', tr('Not linked', 'غير مرتبط')]]} />
            </Field>
          </Group>

          <Group icon="calendar" title={tr('Dates', 'التواريخ')}>
            <Field label={tr('Joined', 'تاريخ الانضمام')}>
              <select className="form-input" value={filters.joined} disabled={isTrash} onChange={(e) => set({ joined: e.target.value, joined_from: '', joined_to: '' })}>
                {JOINED.map(([v, n]) => <option key={v || 'any'} value={v}>{n}</option>)}
              </select>
            </Field>
            {filters.joined === 'custom' && (
              <Field label={tr('Joined between', 'انضم بين')}>
                <div className="uf-range">
                  <input type="date" className="form-input" value={filters.joined_from} max={filters.joined_to || undefined} onChange={(e) => set({ joined_from: e.target.value })} aria-label={tr('From', 'من')} />
                  <span>→</span>
                  <input type="date" className="form-input" value={filters.joined_to} min={filters.joined_from || undefined} onChange={(e) => set({ joined_to: e.target.value })} aria-label={tr('To', 'إلى')} />
                </div>
              </Field>
            )}
            <Field label={tr('Last sign-in', 'آخر تسجيل دخول')}>
              <select className="form-input" value={filters.login} disabled={isTrash} onChange={(e) => set({ login: e.target.value, login_from: '', login_to: '' })}>
                {LOGIN.map(([v, n]) => <option key={v || 'any'} value={v}>{n}</option>)}
              </select>
            </Field>
            {filters.login === 'custom' && (
              <Field label={tr('Signed in between', 'دخل بين')}>
                <div className="uf-range">
                  <input type="date" className="form-input" value={filters.login_from} max={filters.login_to || undefined} onChange={(e) => set({ login_from: e.target.value })} aria-label={tr('From', 'من')} />
                  <span>→</span>
                  <input type="date" className="form-input" value={filters.login_to} min={filters.login_from || undefined} onChange={(e) => set({ login_to: e.target.value })} aria-label={tr('To', 'إلى')} />
                </div>
              </Field>
            )}
          </Group>

          <Group icon="mail" title={tr('Email & profile', 'الإيميل والملف الشخصي')}>
            <Field label={tr('Email domain', 'دومين الإيميل')}>
              <input className="form-input" dir="ltr" list="uf-domains" value={filters.email_domain} disabled={isTrash}
                onChange={(e) => set({ email_domain: e.target.value.trim() })} placeholder="example.edu.eg" />
              <datalist id="uf-domains">
                {(facets.email_domains || []).map((d) => <option key={d.domain} value={d.domain}>{d.count}</option>)}
              </datalist>
            </Field>
            <Field label={tr('Has phone number', 'عنده رقم تليفون')}><Seg label="phone" value={filters.has_phone} onChange={(v) => set({ has_phone: v })} options={ANY_YES_NO} /></Field>
            <Field label={tr('Has profile photo', 'عنده صورة شخصية')}><Seg label="avatar" value={filters.has_avatar} onChange={(v) => set({ has_avatar: v })} options={ANY_YES_NO} /></Field>
          </Group>
        </div>
      )}

      {(chips.length > 0 || count > 0) && (
        <div className="uf-active">
          <span className="uf-result" aria-live="polite">{loading ? tr('Updating…', 'جاري التحديث…') : `${total.toLocaleString()} ${tr('result(s)', 'نتيجة')}`}</span>
          {chips.map((c) => (
            <button key={c.key} type="button" className="uf-chip" onClick={() => onChange(clearKey(filters, c.key))} title={tr('Remove filter', 'إزالة الفلتر')}>
              {c.label} <Icon name="x" size={12} />
            </button>
          ))}
          <span className="uf-active__tools">
            {naming ? (
              <span className="uf-save">
                <input className="form-input" autoFocus value={viewName} maxLength={40} onChange={(e) => setViewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveView(); if (e.key === 'Escape') setNaming(false); }} placeholder={tr('View name', 'اسم العرض')} />
                <button type="button" className="btn btn-primary btn-sm" disabled={!viewName.trim()} onClick={saveView}>{tr('Save', 'حفظ')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(false)}>{tr('Cancel', 'إلغاء')}</button>
              </span>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(true)}><Icon name="bookmark" size={14} /> {tr('Save this view', 'احفظ العرض')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>{tr('Clear all', 'مسح الكل')}</button>
              </>
            )}
          </span>
        </div>
      )}
    </section>
  );
}
