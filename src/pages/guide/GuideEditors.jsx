import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../components/Icon';
import { errorMessage } from '../../api/client';
import { parseServerDate } from '../../utils/serverDate';
import { ItemCard, TaskTile } from './GuideParts';
import { guideApi } from './guideApi';
import {
  GUIDE_ICONS, ROLE_OPTIONS, SECTION_KINDS, bareRoute, slugify, undocumentedPages,
} from './guideUtils';

/* ───────────────────────────── shell: modal / drawer / confirm ───────────────────────────── */

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Locks page scroll while a dialog is open. */
function useBodyLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
}

export function GuideModal({ title, icon = 'edit', wide, onClose, footer, children, busy }) {
  useEscape(busy ? undefined : onClose);
  useBodyLock();
  return createPortal(
    <div className="gd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className={`gd-modal${wide ? ' gd-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="gd-modal__head">
          <span className="gd-modal__icon"><Icon name={icon} size={18} /></span>
          <h2>{title}</h2>
          <button type="button" className="gd-iconbtn" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="gd-modal__body">{children}</div>
        {footer && <footer className="gd-modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function GuideDrawer({ title, icon, onClose, children }) {
  useEscape(onClose);
  useBodyLock();
  return createPortal(
    <div className="gd-overlay gd-overlay--drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <aside className="gd-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="gd-modal__head">
          <span className="gd-modal__icon"><Icon name={icon} size={18} /></span>
          <h2>{title}</h2>
          <button type="button" className="gd-iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </header>
        <div className="gd-drawer__body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, body, danger, busy, confirmLabel, onConfirm, onClose, tx }) {
  return (
    <GuideModal
      title={title}
      icon={danger ? 'alert-triangle' : 'info'}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="gd-btn gd-btn--ghost" onClick={onClose} disabled={busy}>{tx.cancel}</button>
          <button type="button" className={`gd-btn ${danger ? 'gd-btn--danger' : 'gd-btn--primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? '…' : (confirmLabel || tx.confirm)}
          </button>
        </>
      )}
    >
      <p className="gd-confirm__text">{body}</p>
    </GuideModal>
  );
}

/* ───────────────────────────── form pieces ───────────────────────────── */

function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`gd-field${error ? ' has-error' : ''} ${className}`}>
      <span className="gd-field__label">{label}</span>
      {children}
      {hint && !error && <span className="gd-field__hint">{hint}</span>}
      {error && <span className="gd-field__error">{error}</span>}
    </label>
  );
}

function IconPicker({ value, onChange, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gd-field gd-iconpicker">
      <span className="gd-field__label">{label}</span>
      <button type="button" className="gd-iconpicker__current" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="gd-iconpicker__preview"><Icon name={value || 'file'} size={20} /></span>
        <bdi dir="ltr">{value || '—'}</bdi>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="gd-iconpicker__grid" role="listbox">
          {GUIDE_ICONS.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={value === n}
              title={n}
              className={value === n ? 'is-on' : ''}
              onClick={() => { onChange(n); setOpen(false); }}
            >
              <Icon name={n} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleChips({ value, onChange, locale }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((r) => r !== k) : [...value, k]);
  return (
    <div className="gd-chips">
      {ROLE_OPTIONS.map((r) => (
        <button key={r.key} type="button" className={`gd-chip${value.includes(r.key) ? ' is-on' : ''}`} aria-pressed={value.includes(r.key)} onClick={() => toggle(r.key)}>
          {value.includes(r.key) && <Icon name="check" size={12} />} {r[locale]}
        </button>
      ))}
    </div>
  );
}

function PairList({ title, rows, onChange, labelAr, labelEn, addLabel, removeLabel, max, errorText, maxLen }) {
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="gd-pairs">
      <div className="gd-pairs__head"><span className="gd-field__label">{title}</span></div>
      {rows.map((r, i) => (
        <div className="gd-pairs__row" key={i}>
          <span className="gd-pairs__n">{i + 1}</span>
          <div className="gd-pairs__cols">
            <textarea dir="rtl" rows={2} maxLength={maxLen} placeholder={labelAr} value={r.ar} onChange={(e) => set(i, { ar: e.target.value })} />
            <textarea dir="ltr" rows={2} maxLength={maxLen} placeholder={labelEn} value={r.en} onChange={(e) => set(i, { en: e.target.value })} />
          </div>
          <div className="gd-pairs__ctl">
            <button type="button" className="gd-iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Up"><Icon name="arrow-up" size={14} /></button>
            <button type="button" className="gd-iconbtn" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Down"><Icon name="arrow-down" size={14} /></button>
            <button type="button" className="gd-iconbtn gd-iconbtn--danger" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} aria-label={removeLabel}><Icon name="trash" size={14} /></button>
          </div>
        </div>
      ))}
      {errorText && <span className="gd-field__error">{errorText}</span>}
      {rows.length < max && (
        <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => onChange([...rows, { ar: '', en: '' }])}>
          <Icon name="plus" size={14} /> {addLabel}
        </button>
      )}
    </div>
  );
}

const cleanPairs = (rows) => rows
  .map((r) => ({ ar: (r.ar || '').trim(), en: (r.en || '').trim() }))
  .filter((r) => r.ar || r.en);

/** Shared save flow: runs `submit`, maps 422 `errors.<field>` back onto the form. */
function useSubmit(submit) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const run = async () => {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      await submit();
    } catch (err) {
      const fields = err?.payload?.errors;
      if (fields && typeof fields === 'object') {
        const flat = {};
        Object.entries(fields).forEach(([k, v]) => { flat[k] = Array.isArray(v) ? v.join(' ') : String(v); });
        setErrors(flat);
      }
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, formError, run };
}

/* ───────────────────────────── item editor ───────────────────────────── */

export function ItemEditor({ guide, item, sectionId, prefill, navItems, tx, locale, onSubmit, onClose }) {
  const isNew = !item;
  const sections = guide.sections || [];
  const allKeys = useMemo(() => new Set(sections.flatMap((s) => (s.items || []).map((i) => i.key))), [sections]);

  const [v, setV] = useState(() => {
    if (item) {
      return {
        section_id: item.section_id,
        key: item.key,
        title_ar: item.title_ar || '', title_en: item.title_en || '',
        summary_ar: item.summary_ar || '', summary_en: item.summary_en || '',
        body_ar: item.body_ar || '', body_en: item.body_en || '',
        route: item.route || '', permission: item.permission || '', icon: item.icon || '',
        steps: (item.steps || []).map((s) => ({ ar: s.ar || '', en: s.en || '' })),
        tips: (item.tips || []).map((s) => ({ ar: s.ar || '', en: s.en || '' })),
        audience_roles: item.audience_roles || [],
        is_hidden: !!item.is_hidden,
      };
    }
    return {
      section_id: sectionId || prefill?.section_id || sections[0]?.id,
      key: '', title_ar: '', title_en: '', summary_ar: '', summary_en: '', body_ar: '', body_en: '',
      route: '', permission: '', icon: '', steps: [], tips: [], audience_roles: [], is_hidden: false,
      ...(prefill || {}),
    };
  });
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  // Auto key for new entries: from the English title, else the route, else a random suffix; kept unique.
  const autoKey = useMemo(() => {
    let base = slugify(v.title_en) || slugify(bareRoute(v.route).split('/').filter(Boolean).slice(1).join('-')) || slugify(bareRoute(v.route));
    if (!base) base = `entry-${Date.now().toString(36).slice(-4)}`;
    let k = base;
    let n = 2;
    while (allKeys.has(k)) { k = `${base}-${n}`; n += 1; }
    return k;
  }, [v.title_en, v.route, allKeys]);
  const key = keyTouched ? v.key : autoKey;

  const onRoute = (value) => {
    const hit = navItems.find((n) => n.route === value);
    if (hit && !v.title_ar && !v.title_en) {
      set({ route: value, title_ar: hit.ar, title_en: hit.en, icon: v.icon || hit.icon, permission: v.permission || hit.perm || '' });
    } else {
      set({ route: value });
    }
  };

  const { busy, errors, formError, run } = useSubmit(async () => {
    const body = {
      title_ar: v.title_ar.trim(), title_en: v.title_en.trim(),
      summary_ar: v.summary_ar.trim(), summary_en: v.summary_en.trim(),
      body_ar: v.body_ar.trim(), body_en: v.body_en.trim(),
      route: v.route.trim() || null,
      permission: v.permission.trim() || null,
      icon: v.icon || null,
      steps: cleanPairs(v.steps),
      tips: cleanPairs(v.tips),
      audience_roles: v.audience_roles,
      is_hidden: v.is_hidden,
    };
    if (isNew || key !== item.key) body.key = key;
    if (!isNew && v.section_id !== item.section_id) body.section_id = v.section_id;
    await onSubmit({ body, sectionId: v.section_id, item });
  });

  const kind = sections.find((s) => String(s.id) === String(v.section_id))?.kind || 'group';
  const previewItem = {
    ...v, key, id: item?.id, is_custom: item ? item.is_custom : true, locked: false,
    steps: cleanPairs(v.steps), tips: cleanPairs(v.tips),
  };

  return (
    <GuideModal
      wide
      busy={busy}
      title={isNew ? tx.itemNew : tx.itemEdit}
      icon={isNew ? 'plus-circle' : 'edit'}
      onClose={onClose}
      footer={(
        <>
          {formError && <span className="gd-modal__error">{formError}</span>}
          <button type="button" className="gd-btn gd-btn--ghost" onClick={onClose} disabled={busy}>{tx.cancel}</button>
          <button type="button" className="gd-btn gd-btn--primary" onClick={run} disabled={busy || (!v.title_ar.trim() && !v.title_en.trim())}>
            <Icon name="save" size={15} /> {busy ? tx.saving : tx.save}
          </button>
        </>
      )}
    >
      <div className="gd-editor">
        <div className="gd-editor__form">
          <div className="gd-grid2">
            <Field label={tx.fSection} error={errors.section_id}>
              <select value={v.section_id || ''} onChange={(e) => set({ section_id: Number(e.target.value) })}>
                {sections.map((s) => <option key={s.id} value={s.id}>{(locale === 'ar' ? s.title_ar : s.title_en) || s.title_en || s.title_ar}</option>)}
              </select>
            </Field>
            <IconPicker label={tx.fIcon} value={v.icon} onChange={(icon) => set({ icon })} />
          </div>

          <p className="gd-editor__note"><Icon name="info" size={14} /> {tx.langHint}</p>
          <div className="gd-grid2">
            <Field label={tx.fTitleAr} error={errors.title_ar}>
              <input dir="rtl" maxLength={160} value={v.title_ar} onChange={(e) => set({ title_ar: e.target.value })} autoFocus />
            </Field>
            <Field label={tx.fTitleEn} error={errors.title_en}>
              <input dir="ltr" maxLength={160} value={v.title_en} onChange={(e) => set({ title_en: e.target.value })} />
            </Field>
            <Field label={tx.fSummaryAr} error={errors.summary_ar}>
              <textarea dir="rtl" rows={3} maxLength={500} value={v.summary_ar} onChange={(e) => set({ summary_ar: e.target.value })} />
            </Field>
            <Field label={tx.fSummaryEn} error={errors.summary_en}>
              <textarea dir="ltr" rows={3} maxLength={500} value={v.summary_en} onChange={(e) => set({ summary_en: e.target.value })} />
            </Field>
            <Field label={tx.fBodyAr} error={errors.body_ar} hint={tx.fBodyHint}>
              <textarea dir="rtl" rows={5} maxLength={4000} value={v.body_ar} onChange={(e) => set({ body_ar: e.target.value })} />
            </Field>
            <Field label={tx.fBodyEn} error={errors.body_en} hint={tx.fBodyHint}>
              <textarea dir="ltr" rows={5} maxLength={4000} value={v.body_en} onChange={(e) => set({ body_en: e.target.value })} />
            </Field>
          </div>

          <div className="gd-grid2">
            <Field label={tx.fRoute} hint={tx.fRouteHint} error={errors.route}>
              <input dir="ltr" list="gd-routes" placeholder="/student/projects" value={v.route} onChange={(e) => onRoute(e.target.value)} />
              <datalist id="gd-routes">
                {navItems.map((n) => <option key={n.route} value={n.route}>{`${n.ar} · ${n.en}`}</option>)}
              </datalist>
            </Field>
            <Field label={tx.fPermission} hint={tx.fPermissionHint} error={errors.permission}>
              <input dir="ltr" list="gd-perms" placeholder="ai.request_analysis" value={v.permission} onChange={(e) => set({ permission: e.target.value })} />
              <datalist id="gd-perms">
                {[...new Set(navItems.map((n) => n.perm).filter(Boolean))].map((p) => <option key={p} value={p} />)}
              </datalist>
            </Field>
          </div>

          <PairList
            title={tx.fSteps} rows={v.steps} onChange={(steps) => set({ steps })} max={15} maxLen={400}
            labelAr={tx.fStepAr} labelEn={tx.fStepEn} addLabel={tx.addStep} removeLabel={tx.removeRow} errorText={errors.steps}
          />
          <PairList
            title={tx.fTips} rows={v.tips} onChange={(tips) => set({ tips })} max={10} maxLen={400}
            labelAr={tx.fTipAr} labelEn={tx.fTipEn} addLabel={tx.addTip} removeLabel={tx.removeRow} errorText={errors.tips}
          />

          <Field label={tx.fAudience} hint={tx.fAudienceHint} error={errors.audience_roles}>
            <RoleChips value={v.audience_roles} onChange={(audience_roles) => set({ audience_roles })} locale={locale} />
          </Field>

          <div className="gd-grid2">
            <Field label={tx.fKey} hint={tx.fKeyHint} error={errors.key}>
              <input dir="ltr" value={key} onChange={(e) => { setKeyTouched(true); set({ key: e.target.value.toLowerCase() }); }} />
            </Field>
            <label className="gd-switch">
              <input type="checkbox" checked={v.is_hidden} onChange={(e) => set({ is_hidden: e.target.checked })} />
              <span className="gd-switch__track" aria-hidden="true" />
              <span>{tx.fHidden}</span>
            </label>
          </div>
        </div>

        <aside className="gd-editor__preview" aria-label={tx.preview}>
          <div className="gd-editor__previewTitle"><Icon name="eye" size={14} /> {tx.preview}</div>
          {kind === 'tasks'
            ? <TaskTile item={previewItem} tx={tx} locale={locale} editing />
            : <ItemCard item={previewItem} tx={tx} locale={locale} variant={kind === 'faq' ? 'faq' : kind === 'overview' ? 'overview' : 'page'} open preview />}
        </aside>
      </div>
    </GuideModal>
  );
}

/* ───────────────────────────── section editor ───────────────────────────── */

export function SectionEditor({ guide, section, tx, locale, onSubmit, onClose }) {
  const isNew = !section;
  const allKeys = useMemo(() => new Set((guide.sections || []).map((s) => s.key)), [guide]);
  const [v, setV] = useState(() => (section ? {
    key: section.key, kind: section.kind,
    title_ar: section.title_ar || '', title_en: section.title_en || '',
    summary_ar: section.summary_ar || '', summary_en: section.summary_en || '',
    icon: section.icon || '', audience_roles: section.audience_roles || [], is_hidden: !!section.is_hidden,
  } : {
    key: '', kind: 'group', title_ar: '', title_en: '', summary_ar: '', summary_en: '', icon: '', audience_roles: [], is_hidden: false,
  }));
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  const autoKey = useMemo(() => {
    const base = slugify(v.title_en) || `section-${Date.now().toString(36).slice(-4)}`;
    let k = base;
    let n = 2;
    while (allKeys.has(k)) { k = `${base}-${n}`; n += 1; }
    return k;
  }, [v.title_en, allKeys]);
  const key = keyTouched ? v.key : autoKey;

  const { busy, errors, formError, run } = useSubmit(async () => {
    const body = {
      kind: v.kind,
      title_ar: v.title_ar.trim(), title_en: v.title_en.trim(),
      summary_ar: v.summary_ar.trim(), summary_en: v.summary_en.trim(),
      icon: v.icon || null, audience_roles: v.audience_roles, is_hidden: v.is_hidden,
    };
    if (isNew || key !== section.key) body.key = key;
    await onSubmit({ body, section });
  });

  return (
    <GuideModal
      busy={busy}
      title={isNew ? tx.sectionNew : tx.sectionEdit}
      icon={isNew ? 'plus-circle' : 'edit'}
      onClose={onClose}
      footer={(
        <>
          {formError && <span className="gd-modal__error">{formError}</span>}
          <button type="button" className="gd-btn gd-btn--ghost" onClick={onClose} disabled={busy}>{tx.cancel}</button>
          <button type="button" className="gd-btn gd-btn--primary" onClick={run} disabled={busy || (!v.title_ar.trim() && !v.title_en.trim())}>
            <Icon name="save" size={15} /> {busy ? tx.saving : tx.save}
          </button>
        </>
      )}
    >
      <div className="gd-editor__form">
        <p className="gd-editor__note"><Icon name="info" size={14} /> {tx.langHint}</p>
        <div className="gd-grid2">
          <Field label={tx.fTitleAr} error={errors.title_ar}><input dir="rtl" maxLength={160} value={v.title_ar} onChange={(e) => set({ title_ar: e.target.value })} autoFocus /></Field>
          <Field label={tx.fTitleEn} error={errors.title_en}><input dir="ltr" maxLength={160} value={v.title_en} onChange={(e) => set({ title_en: e.target.value })} /></Field>
          <Field label={tx.fSummaryAr} error={errors.summary_ar}><textarea dir="rtl" rows={3} maxLength={500} value={v.summary_ar} onChange={(e) => set({ summary_ar: e.target.value })} /></Field>
          <Field label={tx.fSummaryEn} error={errors.summary_en}><textarea dir="ltr" rows={3} maxLength={500} value={v.summary_en} onChange={(e) => set({ summary_en: e.target.value })} /></Field>
        </div>
        <div className="gd-grid2">
          <Field label={tx.fKind} hint={tx.sectionKindHint} error={errors.kind}>
            <select value={v.kind} onChange={(e) => set({ kind: e.target.value })}>
              {SECTION_KINDS.map((k) => <option key={k} value={k}>{tx.kinds[k]}</option>)}
            </select>
          </Field>
          <IconPicker label={tx.fIcon} value={v.icon} onChange={(icon) => set({ icon })} />
        </div>
        <Field label={tx.fAudience} hint={tx.fAudienceHint} error={errors.audience_roles}>
          <RoleChips value={v.audience_roles} onChange={(audience_roles) => set({ audience_roles })} locale={locale} />
        </Field>
        <div className="gd-grid2">
          <Field label={tx.fKey} hint={tx.fKeyHint} error={errors.key}>
            <input dir="ltr" value={key} onChange={(e) => { setKeyTouched(true); set({ key: e.target.value.toLowerCase() }); }} />
          </Field>
          <label className="gd-switch">
            <input type="checkbox" checked={v.is_hidden} onChange={(e) => set({ is_hidden: e.target.checked })} />
            <span className="gd-switch__track" aria-hidden="true" />
            <span>{tx.fHidden}</span>
          </label>
        </div>
      </div>
    </GuideModal>
  );
}

/* ───────────────────────────── guide details (title / intro / published) ───────────────────────────── */

export function MetaEditor({ guide, tx, onSubmit, onClose }) {
  const [v, setV] = useState({
    title_ar: guide.title_ar || '', title_en: guide.title_en || '',
    subtitle_ar: guide.subtitle_ar || '', subtitle_en: guide.subtitle_en || '',
    intro_ar: guide.intro_ar || '', intro_en: guide.intro_en || '',
    icon: guide.icon || 'book-open', is_published: !!guide.is_published,
  });
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));
  const { busy, errors, formError, run } = useSubmit(async () => {
    await onSubmit({
      title_ar: v.title_ar.trim(), title_en: v.title_en.trim(),
      subtitle_ar: v.subtitle_ar.trim(), subtitle_en: v.subtitle_en.trim(),
      intro_ar: v.intro_ar.trim(), intro_en: v.intro_en.trim(),
      icon: v.icon || 'book-open', is_published: v.is_published,
    });
  });
  return (
    <GuideModal
      busy={busy}
      title={tx.metaEdit}
      icon="book-open"
      onClose={onClose}
      footer={(
        <>
          {formError && <span className="gd-modal__error">{formError}</span>}
          <button type="button" className="gd-btn gd-btn--ghost" onClick={onClose} disabled={busy}>{tx.cancel}</button>
          <button type="button" className="gd-btn gd-btn--primary" onClick={run} disabled={busy || (!v.title_ar.trim() && !v.title_en.trim())}>
            <Icon name="save" size={15} /> {busy ? tx.saving : tx.save}
          </button>
        </>
      )}
    >
      <div className="gd-editor__form">
        <div className="gd-grid2">
          <Field label={tx.fTitleAr} error={errors.title_ar}><input dir="rtl" maxLength={160} value={v.title_ar} onChange={(e) => set({ title_ar: e.target.value })} autoFocus /></Field>
          <Field label={tx.fTitleEn} error={errors.title_en}><input dir="ltr" maxLength={160} value={v.title_en} onChange={(e) => set({ title_en: e.target.value })} /></Field>
          <Field label={tx.fSubtitleAr} error={errors.subtitle_ar}><input dir="rtl" maxLength={255} value={v.subtitle_ar} onChange={(e) => set({ subtitle_ar: e.target.value })} /></Field>
          <Field label={tx.fSubtitleEn} error={errors.subtitle_en}><input dir="ltr" maxLength={255} value={v.subtitle_en} onChange={(e) => set({ subtitle_en: e.target.value })} /></Field>
          <Field label={tx.fIntroAr} error={errors.intro_ar}><textarea dir="rtl" rows={5} maxLength={2000} value={v.intro_ar} onChange={(e) => set({ intro_ar: e.target.value })} /></Field>
          <Field label={tx.fIntroEn} error={errors.intro_en}><textarea dir="ltr" rows={5} maxLength={2000} value={v.intro_en} onChange={(e) => set({ intro_en: e.target.value })} /></Field>
        </div>
        <div className="gd-grid2">
          <IconPicker label={tx.fIcon} value={v.icon} onChange={(icon) => set({ icon })} />
          <label className="gd-switch">
            <input type="checkbox" checked={v.is_published} onChange={(e) => set({ is_published: e.target.checked })} />
            <span className="gd-switch__track" aria-hidden="true" />
            <span>{tx.fPublished}</span>
          </label>
        </div>
      </div>
    </GuideModal>
  );
}

/* ───────────────────────────── history (revisions + restore) ───────────────────────────── */

export function HistoryDrawer({ portal, tx, locale, onClose, onRestored, toast }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    guideApi.revisions(portal, 80).then((d) => setRows(d || [])).catch((e) => setError(errorMessage(e)));
  }, [portal]);
  useEffect(() => { load(); }, [load]);

  const doRestore = async () => {
    setBusy(true);
    try {
      await guideApi.restore(confirm.id);
      toast(tx.restored);
      setConfirm(null);
      load();
      onRestored();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const when = (value) => {
    const d = parseServerDate(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <GuideDrawer title={tx.historyTitle} icon="history" onClose={onClose}>
      {error && <div className="gd-inlineError">{error} <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={load}>{tx.retry}</button></div>}
      {!rows && !error && <div className="gd-skel" style={{ height: 80 }} />}
      {rows && rows.length === 0 && <p className="gd-muted">{tx.historyEmpty}</p>}
      <ul className="gd-history">
        {(rows || []).map((r) => (
          <li key={r.id} className={`gd-history__row gd-history__row--${r.action}`}>
            <span className="gd-history__dot" aria-hidden="true" />
            <div className="gd-history__main">
              <div className="gd-history__top">
                <span className={`gd-badge gd-badge--${r.action === 'delete' ? 'danger' : r.action === 'create' ? 'ok' : 'neutral'}`}>{tx.actions[r.action] || r.action}</span>
                <span className="gd-history__time">{when(r.created_at)}</span>
              </div>
              <div className="gd-history__label">{r.label}</div>
              {r.user_name && <div className="gd-history__by">{tx.by} {r.user_name}</div>}
            </div>
            {r.restorable && (
              <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => setConfirm(r)}>
                <Icon name="refresh" size={13} /> {tx.restore}
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog tx={tx} title={tx.restoreTitle} body={`${tx.restoreBody}\n${confirm.label || ''}`} busy={busy} confirmLabel={tx.restore} onConfirm={doRestore} onClose={() => setConfirm(null)} />
      )}
    </GuideDrawer>
  );
}

/* ───────────────────────────── undocumented pages ───────────────────────────── */

export function UndocumentedDrawer({ portal, guide, tx, locale, onCreate, onClose }) {
  const missing = useMemo(() => undocumentedPages(portal, guide), [portal, guide]);
  const groups = useMemo(() => {
    const map = new Map();
    missing.forEach((m) => {
      if (!map.has(m.groupKey)) map.set(m.groupKey, { title: m.groupTitle, items: [] });
      map.get(m.groupKey).items.push(m);
    });
    return [...map.values()];
  }, [missing]);

  return (
    <GuideDrawer title={tx.undocTitle} icon="alert-triangle" onClose={onClose}>
      <p className="gd-muted">{tx.undocBody}</p>
      {missing.length === 0 && (
        <div className="gd-allgood"><Icon name="check-circle" size={22} /> {tx.undocNone}</div>
      )}
      {groups.map((g) => (
        <div className="gd-undoc" key={g.title.en}>
          <div className="gd-undoc__group">{tx.sidebarGroup}: <strong>{g.title[locale]}</strong></div>
          {g.items.map((m) => (
            <div className="gd-undoc__row" key={m.route}>
              <span className="gd-item__icon"><Icon name={m.icon} size={18} /></span>
              <div className="gd-undoc__text">
                <strong>{m[locale]}</strong>
                <bdi dir="ltr" className="gd-undoc__route">{m.route}</bdi>
              </div>
              <button type="button" className="gd-btn gd-btn--soft gd-btn--sm" onClick={() => onCreate(m)}>
                <Icon name="plus" size={13} /> {tx.undocCreate}
              </button>
            </div>
          ))}
        </div>
      ))}
    </GuideDrawer>
  );
}

/* ───────────────────────────── tiny helper hooks for the page ───────────────────────────── */

/** Toast with auto-dismiss. */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, tone = 'ok') => {
    setToast({ message, tone, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tone === 'error' ? 6000 : 2800);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}
