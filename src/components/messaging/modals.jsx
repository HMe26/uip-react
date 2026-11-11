import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import VideoPlayer from '../VideoPlayer';
import { Avatar } from './ConversationRail';
import { fmtTime, peerLabel, bi } from './format';
import { useLanguage } from '../../context/LanguageContext';
import { useProtectedSrc } from '../../lib/chatMedia';

/** Inline bilingual picker: const t = useT(); t('English', 'عربي'). */
function useT() {
  const { locale } = useLanguage();
  return (en, ar) => (locale === 'ar' ? ar : en);
}

/** Generic modal shell — ported from openModal()/closeModal() in messaging.js. */
export function Modal({ title, onClose, children, footer }) {
  const t = useT();
  const backdropRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="msg-modal-backdrop"
      ref={backdropRef}
      onClick={(e) => e.target === backdropRef.current && onClose()}
    >
      <div className="msg-modal">
        <div className="msg-modal__head">
          <h3>{title}</h3>
          <button type="button" className="msg-icon-btn" onClick={onClose} aria-label={t('Close', 'إغلاق')}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="msg-modal__body">{children}</div>
        {footer && <div className="msg-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}


const ROLE_LABELS = {
  student: ['Student', 'الطالب'], university: ['University', 'الجامعة'], faculty: ['Faculty', 'الكلية'], supervisor: ['Supervisor', 'المشرف'],
  academic_staff: ['Academic staff', 'عضو هيئة التدريس'], admin: ['Admin', 'مدير النظام'], super_admin: ['Admin', 'مدير النظام'], security_admin: ['Security', 'الأمان'],
  security_officer: ['Security', 'الأمان'], data_analyst: ['Data analyst', 'محلل البيانات'], investor: ['Investor', 'مستثمر'],
  researcher: ['Researcher', 'باحث'], designer: ['Designer', 'مصمم'],
};
const roleLabel = (r) => {
  if (!r) return '';
  const known = ROLE_LABELS[r];
  return known ? bi(known[0], known[1]) : String(r).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

/** Search-result row: photo (or initials when the person hides it), name, role, org, email. */
function PersonRow({ p, selected, onClick }) {
  const org = p.org_en || p.org_ar || '';
  return (
    <div className={`msg-picker-item msg-person${selected ? ' is-selected' : ''}`} onClick={onClick}>
      <Avatar name={p.full_name} src={p.avatar_path} size="sm" />
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ fontSize: 13, display: 'block' }}>{p.full_name}</strong>
        <span className="msg-person__meta">
          {[roleLabel(p.role), org].filter(Boolean).join(' · ')}
          {p.email ? `${roleLabel(p.role) || org ? ' · ' : ''}${p.email}` : ''}
        </span>
      </span>
    </div>
  );
}

/** Debounced recipient search box shared by the direct/group modals. */
function useRecipientSearch(searchRecipients) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const timerRef = useRef(null);

  const onChange = (value) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        setResults(await searchRecipients(q));
      } catch {
        setResults([]);
      }
    }, 250);
  };

  return { query, setQuery, results, setResults, onChange };
}

export function NewDirectModal({ onClose, onSearchRecipients, onSubmit }) {
  const t = useT();
  const { query, setQuery, results, setResults, onChange } = useRecipientSearch(onSearchRecipients);
  const [selected, setSelected] = useState(null);
  const [searched, setSearched] = useState(false);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const pick = (p) => {
    setSelected(p);
    setResults([]);
    setError('');
  };
  const reset = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    setBody('');
    setError('');
  };

  const submit = async () => {
    if (!selected) return setError(t('Pick a recipient first.', 'اختر المستلم أولًا.'));
    if (!body.trim()) return setError(t('Write a message first.', 'اكتب رسالة أولًا.'));
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ recipient_email: selected.email, body: body.trim() });
    } catch (err) {
      setError(err?.message || t('Something went wrong.', 'حدث خطأ ما.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={selected ? t('Send message', 'إرسال رسالة') : t('Find people', 'البحث عن أشخاص')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          {selected && (
            <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={submitting}>
              {t('Start conversation', 'بدء المحادثة')}
            </button>
          )}
        </>
      }
    >
      {!selected ? (
        <>
          <input
            type="text"
            autoFocus
            placeholder={t('Search people by name or email…', 'ابحث عن أشخاص بالاسم أو البريد الإلكتروني…')}
            value={query}
            onChange={(e) => {
              setSearched(e.target.value.trim().length >= 2);
              onChange(e.target.value);
            }}
          />
          <div className="msg-picker-list msg-picker-list--people">
            {results.length === 0 ? (
              <p className="text-small text-muted" style={{ padding: 'var(--space-3)', margin: 0 }}>
                {searched ? t('No matches.', 'لا توجد نتائج مطابقة.') : t('Type at least 2 letters of a name or email.', 'اكتب حرفين على الأقل من الاسم أو البريد الإلكتروني.')}
              </p>
            ) : (
              results.map((p) => <PersonRow key={p.id} p={p} onClick={() => pick(p)} />)
            )}
          </div>
        </>
      ) : (
        <>
          {/* Confirm it's the right person (photo, role, org, email) before writing. */}
          <div className="msg-person-card">
            <span className="msg-person-card__avatar"><Avatar name={selected.full_name} src={selected.avatar_path} /></span>
            <div className="msg-person-card__info">
              <strong>{selected.full_name}</strong>
              {roleLabel(selected.role) && <span className="msg-person-card__role">{roleLabel(selected.role)}</span>}
              {(selected.org_en || selected.org_ar) && <span>{selected.org_en || selected.org_ar}</span>}
              {selected.email && <span>{selected.email}</span>}
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={reset}>{t('Not them? Search again', 'ليس هو؟ ابحث مرة أخرى')}</button>
          </div>
          <textarea rows={3} autoFocus placeholder={t('Write your first message…', 'اكتب رسالتك الأولى…')} value={body} onChange={(e) => setBody(e.target.value)} />
        </>
      )}
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

export function NewGroupModal({ onClose, onSearchRecipients, onSubmit }) {
  const t = useT();
  const { query, results, onChange, setResults } = useRecipientSearch(onSearchRecipients);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState({}); // id -> full_name
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const pick = (p) => {
    setPicked((prev) => ({ ...prev, [p.id]: p.full_name }));
    setResults([]);
  };
  const unpick = (id) => setPicked((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const submit = async () => {
    const ids = Object.keys(picked);
    if (!name.trim()) return setError(t('Group name is required.', 'اسم المجموعة مطلوب.'));
    if (ids.length < 1) return setError(t('Add at least one member.', 'أضف عضوًا واحدًا على الأقل.'));
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), member_ids: ids, description: description.trim() });
    } catch (err) {
      setError(err?.message || t('Something went wrong.', 'حدث خطأ ما.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('New group', 'مجموعة جديدة')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={submitting}>
            {t('Create group', 'إنشاء المجموعة')}
          </button>
        </>
      }
    >
      <input type="text" placeholder={t('Group name', 'اسم المجموعة')} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      <textarea rows={2} maxLength={500} placeholder={t('Description (optional)', 'وصف المجموعة (اختياري)')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <input type="text" placeholder={t('Add people…', 'أضف أشخاصًا…')} value={query} onChange={(e) => onChange(e.target.value)} />
      <div className="msg-selected-chips">
        {Object.entries(picked).map(([id, fullName]) => (
          <span className="msg-selected-chip" key={id}>
            {fullName}
            <button type="button" onClick={() => unpick(id)} aria-label={t('Remove', 'إزالة')}>&times;</button>
          </span>
        ))}
      </div>
      <div className="msg-picker-list">
        {results.map((p) => (
          <PersonRow key={p.id} p={p} selected={!!picked[p.id]} onClick={() => pick(p)} />
        ))}
      </div>
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

export function AddMemberModal({ onClose, onSearchRecipients, onSubmit }) {
  const t = useT();
  const { query, results, onChange, setResults } = useRecipientSearch(onSearchRecipients);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const pick = async (p) => {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(p.id);
      setResults([]);
      onClose();
    } catch (err) {
      setError(err?.message || t('Something went wrong.', 'حدث خطأ ما.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={t('Add member', 'إضافة عضو')} onClose={onClose}>
      <input
        type="text"
        placeholder={t('Search people by name or email…', 'ابحث عن أشخاص بالاسم أو البريد الإلكتروني…')}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        disabled={submitting}
      />
      <div className="msg-picker-list">
        {results.map((p) => (
          <PersonRow key={p.id} p={p} onClick={() => !submitting && pick(p)} />
        ))}
      </div>
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

/** Ported from openForwardModal() in messaging.js — pick a conversation to forward a message into. */
export function ForwardModal({ conversations, onClose, onForward, count = 1 }) {
  const t = useT();
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const list = q.trim()
    ? conversations.filter((c) => peerLabel(c).toLowerCase().includes(q.trim().toLowerCase()))
    : conversations;

  const send = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    setError('');
    try {
      await onForward(picked);
    } catch (err) {
      setError(err?.message || t('Something went wrong.', 'حدث خطأ ما.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={count > 1 ? t(`Forward ${count} messages`, `إعادة توجيه ${count} رسائل`) : t('Forward message', 'إعادة توجيه الرسالة')}
      onClose={busy ? () => {} : onClose}
      footer={(
        <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={!picked.length || busy}>
          {busy ? t('Sending…', 'جارٍ الإرسال…') : t(`Send (${picked.length})`, `إرسال (${picked.length})`)}
        </button>
      )}
    >
      <input
        type="search"
        className="msg-forward-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('Search', 'بحث')}
        style={{ width: '100%', marginBottom: 8, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--glass-border, rgba(128,128,128,.3))', background: 'transparent', color: 'inherit', font: 'inherit' }}
      />
      <div className="msg-picker-list">
        {list.length === 0 ? (
          <p className="text-small text-muted">{t('No conversations yet.', 'لا توجد محادثات بعد.')}</p>
        ) : (
          list.map((c) => {
            const on = picked.includes(c.id);
            return (
              <div className={`msg-picker-item${on ? ' is-picked' : ''}`} key={c.id} onClick={() => !busy && toggle(c.id)} role="checkbox" aria-checked={on}>
                <Avatar name={peerLabel(c)} isGroup={c.is_group} saved={c.is_saved} src={c.is_saved ? c.saved_avatar : undefined} size="sm" />
                <span style={{ flex: 1 }}>{peerLabel(c)}</span>
                <span className={`msg-sel-dot${on ? ' is-on' : ''}`} aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
              </div>
            );
          })
        )}
      </div>
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

/** Bulk delete: "for me" always, "for everyone" only when every selected message is mine. */
export function BulkDeleteModal({ count, canAll, onClose, onDelete }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (mode) => {
    setBusy(true);
    try { await onDelete(mode); } finally { setBusy(false); }
  };
  return (
    <Modal
      title={t(`Delete ${count} messages?`, `حذف ${count} رسائل؟`)}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => run('for-me')} disabled={busy}>{t('Delete for me', 'حذف عندي')}</button>
          {canAll && (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => run('for-everyone')} disabled={busy}>{t('Delete for everyone', 'حذف للجميع')}</button>
          )}
        </>
      )}
    >
      <p className="text-small" style={{ margin: 0, lineHeight: 1.7 }}>
        {canAll
          ? t('Choose how to delete the selected messages.', 'اختر طريقة حذف الرسائل المحددة.')
          : t('These will be removed from your chat only.', 'سيتم حذفها من عندك فقط.')}
      </p>
    </Modal>
  );
}

/** Ported from openPollModal() in messaging.js — question + 2+ options, options growable. */
export function PollModal({ onClose, onSubmit }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const setOption = (i, value) => setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  const addOption = () => setOptions((prev) => [...prev, '']);

  const submit = async () => {
    const q = question.trim();
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) {
      setError(t('Add a question and at least two options.', 'أضف سؤالًا وخيارين على الأقل.'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ question: q, options: opts });
    } catch (err) {
      setError(err?.message || t('Something went wrong.', 'حدث خطأ ما.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('Create poll', 'إنشاء استطلاع')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={submitting}>
            {t('Create poll', 'إنشاء الاستطلاع')}
          </button>
        </>
      }
    >
      <input type="text" placeholder={t('Ask a question…', 'اطرح سؤالًا…')} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <div data-poll-options>
        {options.map((opt, i) => (
          <div className="msg-poll-option-row" key={i}>
            <input type="text" placeholder={`${t('Option', 'الخيار')} ${i + 1}`} value={opt} onChange={(e) => setOption(i, e.target.value)} />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-outline btn-sm" onClick={addOption}>{t('+ Add option', '+ إضافة خيار')}</button>
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

/**
 * Image lightbox — ported from openLightbox()/renderLightbox() in
 * messaging.js. `images` is every image attachment url in the current
 * thread (for prev/next); `initialSrc` is the one that was clicked.
 */
export function Lightbox({ images, initialSrc, onClose }) {
  const t = useT();
  const list = images && images.length ? images : [initialSrc];
  const [index, setIndex] = useState(Math.max(0, list.indexOf(initialSrc)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const rawSrc = list[index];
  const { src: shown } = useProtectedSrc(rawSrc); // chat images are private: fetched with the token, shown from a blob: URL
  const src = shown || '';

  const goPrev = () => {
    setIndex((i) => (i - 1 + list.length) % list.length);
    setZoom(1);
    setRotation(0);
  };
  const goNext = () => {
    setIndex((i) => (i + 1) % list.length);
    setZoom(1);
    setRotation(0);
  };
  const zoomIn = () => setZoom((z) => Math.min(3, z + 0.25));
  const zoomOut = () => setZoom((z) => Math.max(0.5, z - 0.25));
  const rotate = () => setRotation((r) => (r + 90) % 360);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && list.length > 1) goPrev();
      else if (e.key === 'ArrowRight' && list.length > 1) goNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length, onClose]);

  // Portal to <body>: inside the page it was trapped in the content's stacking context, so the top bar painted over it.
  return createPortal(
    <div className="msg-lightbox" data-lightbox onClick={onClose}>
      <button type="button" className="msg-icon-btn msg-lightbox__close" onClick={onClose} aria-label={t('Close', 'إغلاق')} title={t('Close', 'إغلاق')}>
        <Icon name="x" size={20} />
      </button>
      {list.length > 1 && (
        <>
          <button
            type="button"
            className="msg-icon-btn msg-lightbox__nav msg-lightbox__nav--prev"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label={t('Previous', 'السابق')}
            title={t('Previous', 'السابق')}
          >
            <Icon name="chevron-left" size={22} />
          </button>
          <button
            type="button"
            className="msg-icon-btn msg-lightbox__nav msg-lightbox__nav--next"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label={t('Next', 'التالي')}
            title={t('Next', 'التالي')}
          >
            <Icon name="chevron-right" size={22} />
          </button>
        </>
      )}
      <div className="msg-lightbox__stage" data-lightbox-stage onClick={(e) => e.stopPropagation()}>
        <img src={src || undefined} alt="" style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }} />
      </div>
      <div className="msg-lightbox__tools" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="msg-icon-btn" onClick={zoomOut} aria-label={t('Zoom out', 'تصغير')} title={t('Zoom out', 'تصغير')}>
          <Icon name="search" size={16} />−
        </button>
        <button type="button" className="msg-icon-btn" onClick={zoomIn} aria-label={t('Zoom in', 'تكبير')} title={t('Zoom in', 'تكبير')}>
          <Icon name="search" size={16} />+
        </button>
        <button type="button" className="msg-icon-btn" onClick={rotate} aria-label={t('Rotate', 'تدوير')} title={t('Rotate', 'تدوير')}>
          <Icon name="refresh" size={16} />
        </button>
        <a className="msg-icon-btn" href={src || undefined} download aria-label={t('Download', 'تنزيل')} title={t('Download', 'تنزيل')}>
          <Icon name="download" size={16} />
        </a>
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Chat privacy" — per-user switches that apply to every role (the old
 * read-receipts card only existed in the Student settings page). Loads and
 * saves through GET/PATCH /api/v1/messaging/privacy.
 */
export function ChatPrivacyModal({ onClose, loadPrivacy, savePrivacy }) {
  const t = useT();
  const [state, setState] = useState(null); // { show_avatar, read_receipts_enabled }
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    loadPrivacy()
      .then((d) => alive && setState(d))
      .catch((err) => alive && setError(err?.message || t('Could not load your privacy settings.', 'تعذّر تحميل إعدادات الخصوصية.')));
    return () => {
      alive = false;
    };
  }, [loadPrivacy]);

  const toggle = async (key) => {
    if (!state || saving) return;
    const next = !state[key];
    setSaving(key);
    setError('');
    try {
      setState(await savePrivacy({ [key]: next }));
    } catch (err) {
      setError(err?.message || t('Could not save.', 'تعذّر الحفظ.'));
    } finally {
      setSaving('');
    }
  };

  const rows = [
    {
      key: 'show_avatar',
      label: t('Show my profile photo', 'إظهار صورة ملفي الشخصي'),
      hint: t('When off, other people see your initials instead of your photo in chats.', 'عند الإيقاف، يرى الآخرون الأحرف الأولى من اسمك بدل صورتك في المحادثات.'),
    },
    {
      key: 'read_receipts_enabled',
      label: t('Read receipts', 'إشعارات القراءة'),
      hint: t("Let others see when you've read their messages.", 'اسمح للآخرين برؤية متى قرأت رسائلهم.'),
    },
  ];

  return (
    <Modal
      title={t('Chat privacy', 'خصوصية المحادثات')}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{t('Done', 'تم')}</button>}
    >
      {!state && !error && <p className="text-small text-muted">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {state &&
        rows.map((r) => (
          <div className="msg-info__toggle-row" key={r.key} style={{ alignItems: 'flex-start', gap: 12 }}>
            <span>
              <strong style={{ display: 'block', fontSize: 13 }}>{r.label}</strong>
              <span className="text-small text-muted">{r.hint}</span>
            </span>
            <button
              type="button"
              className={`msg-switch${state[r.key] ? ' is-on' : ''}`}
              onClick={() => toggle(r.key)}
              aria-pressed={!!state[r.key]}
              aria-label={r.label}
              disabled={saving === r.key}
            />
          </div>
        ))}
      {error && <p className="text-small" style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
    </Modal>
  );
}

/**
 * Full-size video player. The chat bubble only shows a small tile; opening it
 * plays the video using the whole viewport (letterboxed, never cropped).
 */
export function VideoViewer({ video, onClose }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="msg-videoviewer" role="dialog" aria-modal="true" aria-label={t('Video player', 'مشغّل الفيديو')} onClick={onClose}>
      <button type="button" className="msg-icon-btn msg-videoviewer__close" onClick={onClose} aria-label={t('Close', 'إغلاق')} title={t('Close', 'إغلاق')}>
        <Icon name="x" size={22} />
      </button>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'contents' }}>
        <VideoPlayer src={video.src} poster={video.poster} autoPlay />
      </div>
    </div>
  );
}

