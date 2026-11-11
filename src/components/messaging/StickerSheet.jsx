import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import StickerMedia from './StickerMedia';
import { copyImageToClipboard, downloadFromUrl, loadFavourites, setFavLocal } from './MessageMenu';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import {
  addToPack, cachedPacks, createPack, deletePack, invalidateFavourites, loadPack, loadPacks, removeFromPack, renamePack, stickerState, toSticker,
} from '../../lib/stickerStore';
import '../../styles/css/sticker-sheet.css';

/**
 * Tap a sticker / GIF in a chat -> this sheet (bottom sheet on phones, centred card on desktop):
 *   main   large animated preview + Favourites · Add to sticker pack · View sticker pack · Send · Copy · Save
 *   packs  "Add to sticker pack": New pack (inline name) + my packs with live check marks (tap = add / remove)
 *   pack   a pack's stickers: tap to send, remove from pack, rename, delete the pack
 * Packs are personal groups over the sticker library; a sticker received from someone is copied into the library once.
 */
const MAX_PACK_ITEMS = 120;

export default function StickerSheet({ message: m, canSend, onSend, onClose }) {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const isGif = m.message_type === 'gif';
  const url = m.metadata?.url || m.attachments?.[0]?.url || '';
  const kind = m.metadata?.kind || m.attachments?.[0]?.kind;
  const sticker = useMemo(() => toSticker({ url, kind }), [url, kind]);
  const src = !isGif && (sticker.libId || sticker.attId) ? { libId: sticker.libId, attId: sticker.attId } : null;

  const [view, setView] = useState({ name: 'main' });
  const [fav, setFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const [packs, setPacks] = useState(cachedPacks() || []);
  const [inPacks, setInPacks] = useState([]);
  const [libId, setLibId] = useState(sticker.libId || null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);

  const say = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const fail = (err) => say(err?.message || t('Something went wrong', 'حصلت مشكلة'));

  useEffect(() => {
    let dead = false;
    loadFavourites().then((set) => { if (!dead) setFav(set.has(url)); });
    loadPacks(true).then((p) => { if (!dead) setPacks(p); }).catch(() => {});
    if (src) {
      stickerState(src).then((s) => { if (!dead) { setInPacks(s.pack_ids || []); if (s.sticker_id) setLibId(s.sticker_id); } }).catch(() => {});
    }
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const back = useCallback(() => {
    if (view.name === 'main') onClose();
    else if (view.name === 'pack') setView(view.from === 'main' ? { name: 'main' } : { name: 'packs', mode: view.mode });
    else setView({ name: 'main' });
  }, [view, onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); back(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [back]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ---- actions ---- */
  const toggleFav = async () => {
    if (favBusy) return;
    setFavBusy(true);
    try {
      const r = await api.post('/api/v1/messaging/messages/' + m.id + '/favourite');
      const on = !!r.data?.is_favourite;
      setFavLocal(url, on); invalidateFavourites(); setFav(on);
      say(on ? t('Added to Favourites', 'تمت الإضافة للمفضلة') : t('Removed from Favourites', 'تمت الإزالة من المفضلة'));
    } catch (err) { fail(err); } finally { setFavBusy(false); }
  };
  const send = (s) => { onSend?.(s); onClose(); };
  const copy = async () => {
    try { await copyImageToClipboard(url); say(t('Image copied', 'تم نسخ الصورة')); } catch { say(t('Could not copy the image', 'تعذّر نسخ الصورة')); }
  };
  const save = async () => {
    try { await downloadFromUrl(url, m.metadata?.label || m.metadata?.title || (isGif ? 'gif' : 'sticker')); } catch { say(t('Could not save the file', 'تعذّر حفظ الملف')); }
  };

  const packOf = (id) => packs.find((p) => p.id === id);
  const myPacks = inPacks.map(packOf).filter(Boolean);
  const openPackFromMain = () => {
    if (myPacks.length === 1) setView({ name: 'pack', id: myPacks[0].id, from: 'main' });
    else setView({ name: 'packs', mode: 'view' });
  };

  const title = isGif ? 'GIF' : t('Sticker', 'ملصق');
  const sender = m.sender_name || m.sender?.full_name || '';

  return createPortal(
    <div className="ss-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ss" role="dialog" aria-modal="true" aria-label={title}>
        <span className="ss-grip" aria-hidden="true" />

        {view.name === 'main' && (
          <>
            <div className="ss-head">
              <button type="button" className="ss-x" onClick={onClose} aria-label={t('Close', 'إغلاق')}><Icon name="x" size={20} /></button>
              <span className="ss-head__chip">{title}{sender ? ` · ${sender}` : ''}</span>
            </div>
            <div className="ss-stage">
              {isGif
                ? <img className="ss-stage__img" src={url} alt={m.metadata?.title || 'GIF'} />
                : <StickerMedia className="ss-stage__img" url={url} kind={kind} alt={m.metadata?.label || title} />}
            </div>
            {(m.metadata?.label || m.metadata?.title) && <p className="ss-label" dir="auto">{m.metadata.label || m.metadata.title}</p>}

            <div className="ss-list">
              <button type="button" className="ss-act" onClick={toggleFav} disabled={favBusy}>
                <span className={`ss-act__ic${fav ? ' is-on' : ''}`}><Icon name="star" size={20} /></span>
                <span className="ss-act__t">{fav ? t('Remove from Favourites', 'إزالة من المفضلة') : t('Add to Favourites', 'إضافة للمفضلة')}</span>
              </button>
              {!isGif && src && (
                <button type="button" className="ss-act" onClick={() => setView({ name: 'packs', mode: 'add' })}>
                  <span className="ss-act__ic"><Icon name="plus-circle" size={20} /></span>
                  <span className="ss-act__t">{t('Add to sticker pack', 'إضافة إلى باك ستيكرز')}</span>
                  {myPacks.length > 0 && <span className="ss-act__badge">{t(`In ${myPacks.length}`, `في ${myPacks.length}`)}</span>}
                </button>
              )}
              {!isGif && myPacks.length > 0 && (
                <button type="button" className="ss-act" onClick={openPackFromMain}>
                  <span className="ss-act__ic"><Icon name="grid" size={20} /></span>
                  <span className="ss-act__t">{t('View sticker pack', 'عرض باك الستيكرز')}</span>
                  <span className="ss-act__sub" dir="auto">{myPacks.length === 1 ? myPacks[0].name : ''}</span>
                </button>
              )}
              {canSend && (
                <button type="button" className="ss-act" onClick={() => send(isGif ? { ...sticker, isGif: true, url, title: m.metadata?.title, preview: m.metadata?.preview } : sticker)}>
                  <span className="ss-act__ic"><Icon name="send" size={20} /></span>
                  <span className="ss-act__t">{isGif ? t('Send this GIF', 'إرسال الـ GIF ده') : t('Send this sticker', 'إرسال الستيكر ده')}</span>
                </button>
              )}
              <div className="ss-mini">
                {!!window.ClipboardItem && (
                  <button type="button" onClick={copy}><Icon name="copy" size={16} /> {t('Copy image', 'نسخ الصورة')}</button>
                )}
                <button type="button" onClick={save}><Icon name="download" size={16} /> {t('Save', 'حفظ')}</button>
              </div>
            </div>
          </>
        )}

        {view.name === 'packs' && (
          <PacksView
            t={t} locale={locale} mode={view.mode} src={src} packs={packs} setPacks={setPacks} inPacks={inPacks} setInPacks={setInPacks}
            libId={libId} setLibId={setLibId} say={say} fail={fail}
            onBack={() => setView({ name: 'main' })} onOpen={(id) => setView({ name: 'pack', id, from: 'packs', mode: view.mode })}
          />
        )}

        {view.name === 'pack' && (
          <PackView
            t={t} id={view.id} say={say} fail={fail} canSend={canSend} libId={libId}
            onSend={send} setPacks={setPacks}
            onRemoved={(stickerId, packId) => { if (stickerId === libId) setInPacks((x) => x.filter((p) => p !== packId)); }}
            onBack={back}
            onDeleted={(id) => { setInPacks((x) => x.filter((p) => p !== id)); setView({ name: 'main' }); }}
          />
        )}

        {toast && <div className="ss-toast" role="status">{toast}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ add to pack / choose pack */
function PacksView({ t, mode, src, packs, setPacks, inPacks, setInPacks, libId, setLibId, say, fail, onBack, onOpen }) {
  const [creating, setCreating] = useState(!packs.length && mode === 'add');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null); // pack id | 'new'
  const inputRef = useRef(null);
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);
  const viewOnly = mode === 'view';
  const shown = viewOnly ? packs.filter((p) => inPacks.includes(p.id)) : packs;

  const create = async (e) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy('new');
    try {
      const r = await createPack(name.trim(), src);
      setPacks(r.packs);
      if (r.sticker_id) setLibId(r.sticker_id);
      setInPacks((x) => [...x, r.pack_id]);
      setName(''); setCreating(false);
      say(t('Pack created', 'تم إنشاء الباك'));
    } catch (err) { fail(err); } finally { setBusy(null); }
  };
  const toggle = async (p) => {
    if (busy) return;
    const has = inPacks.includes(p.id);
    if (!has && p.count >= MAX_PACK_ITEMS) { say(t('This pack is full', 'الباك دي مليانة')); return; }
    setBusy(p.id);
    try {
      if (has) {
        const list = await removeFromPack(p.id, libId);
        setPacks(list); setInPacks((x) => x.filter((id) => id !== p.id));
        say(t(`Removed from “${p.name}”`, `اتشال من “${p.name}”`));
      } else {
        const r = await addToPack(p.id, src);
        setPacks(r.packs); if (r.sticker_id) setLibId(r.sticker_id); setInPacks((x) => [...x, p.id]);
        say(t(`Added to “${p.name}”`, `اتضاف إلى “${p.name}”`));
      }
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  return (
    <>
      <div className="ss-head">
        <button type="button" className="ss-x" onClick={onBack} aria-label={t('Back', 'رجوع')}><Icon name="arrow-left" size={20} className="ss-flip" /></button>
        <strong className="ss-head__title">{viewOnly ? t('Sticker packs', 'باكات الستيكرز') : t('Add to sticker pack', 'إضافة إلى باك ستيكرز')}</strong>
      </div>
      <div className="ss-list ss-list--scroll">
        {!viewOnly && !creating && (
          <button type="button" className="ss-pack ss-pack--new" onClick={() => setCreating(true)}>
            <span className="ss-pack__cover ss-pack__cover--plus"><Icon name="plus" size={20} /></span>
            <span className="ss-pack__name">{t('New pack', 'باك جديدة')}</span>
          </button>
        )}
        {!viewOnly && creating && (
          <form className="ss-new" onSubmit={create}>
            <input ref={inputRef} type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
              placeholder={t('Pack name, e.g. Funny cats', 'اسم الباك، مثلًا: قطط مضحكة')} aria-label={t('Pack name', 'اسم الباك')} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || busy === 'new'}>{busy === 'new' ? '…' : t('Create', 'إنشاء')}</button>
            {packs.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCreating(false); setName(''); }}>{t('Cancel', 'إلغاء')}</button>}
          </form>
        )}
        {shown.map((p) => {
          const has = inPacks.includes(p.id);
          return (
            <div className="ss-pack" key={p.id}>
              <button type="button" className="ss-pack__main" onClick={() => (viewOnly ? onOpen(p.id) : toggle(p))} disabled={busy === p.id}>
                <span className="ss-pack__cover">{p.cover ? <StickerMedia url={p.cover.url} kind={p.cover.kind} className="ss-pack__img" /> : <Icon name="layers" size={18} />}</span>
                <span className="ss-pack__name" dir="auto">{p.name}</span>
                <span className="ss-pack__count">{p.count}</span>
                {!viewOnly && <span className={`ss-pack__check${has ? ' is-on' : ''}`} aria-hidden="true">{busy === p.id ? <span className="ss-spin" /> : has ? <Icon name="check" size={14} /> : null}</span>}
                {viewOnly && <Icon name="chevron-right" size={16} className="ss-flip" />}
              </button>
              {!viewOnly && has && (
                <button type="button" className="ss-pack__open" onClick={() => onOpen(p.id)} title={t('View pack', 'عرض الباك')} aria-label={t('View pack', 'عرض الباك')}><Icon name="grid" size={16} /></button>
              )}
            </div>
          );
        })}
        {!shown.length && !creating && <p className="ss-empty">{t('No packs yet. Create your first one.', 'مفيش باكات لسه. اعمل أول باك.')}</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ one pack */
function PackView({ t, id, say, fail, canSend, libId, onSend, setPacks, onRemoved, onBack, onDeleted }) {
  const [pack, setPack] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    loadPack(id).then((p) => { if (!dead) { setPack(p); setName(p.name); } }).catch((e) => { if (!dead) fail(e); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveName = async (e) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n || n === pack.name) { setRenaming(false); setName(pack.name); return; }
    setBusy(true);
    try { setPacks(await renamePack(id, n)); setPack((p) => ({ ...p, name: n })); setRenaming(false); say(t('Renamed', 'تم تغيير الاسم')); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };
  const remove = async (s) => {
    try {
      setPacks(await removeFromPack(id, s.libId));
      setPack((p) => ({ ...p, count: p.count - 1, items: p.items.filter((x) => x.libId !== s.libId) }));
      onRemoved(s.libId, id);
      say(t('Removed from the pack', 'اتشال من الباك'));
    } catch (err) { fail(err); }
  };
  const del = async () => {
    setBusy(true);
    try { setPacks(await deletePack(id)); say(t('Pack deleted', 'تم حذف الباك')); onDeleted(id); }
    catch (err) { fail(err); setBusy(false); }
  };

  return (
    <>
      <div className="ss-head">
        <button type="button" className="ss-x" onClick={onBack} aria-label={t('Back', 'رجوع')}><Icon name="arrow-left" size={20} className="ss-flip" /></button>
        {renaming ? (
          <form className="ss-rename" onSubmit={saveName}>
            <input type="text" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t('Pack name', 'اسم الباك')} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t('Save', 'حفظ')}</button>
          </form>
        ) : (
          <>
            <strong className="ss-head__title" dir="auto">{pack?.name || '…'}{pack && <small>{pack.count}</small>}</strong>
            {pack && <button type="button" className="ss-x" onClick={() => setRenaming(true)} aria-label={t('Rename', 'تغيير الاسم')}><Icon name="edit" size={18} /></button>}
          </>
        )}
      </div>
      <div className="ss-list ss-list--scroll">
        {!pack ? <div className="ss-loading"><span className="ss-spin ss-spin--lg" /></div> : (
          <>
            <div className="ss-grid">
              {pack.items.map((s) => (
                <div className={`ss-cell${s.libId === libId ? ' is-current' : ''}`} key={s.key}>
                  <button type="button" className="ss-cell__pick" onClick={() => canSend && onSend(s)} disabled={!canSend} title={canSend ? t('Send', 'إرسال') : ''}>
                    <StickerMedia url={s.url} kind={s.kind} hover className="ss-cell__img" />
                  </button>
                  <button type="button" className="ss-cell__x" onClick={() => remove(s)} aria-label={t('Remove from pack', 'إزالة من الباك')} title={t('Remove from pack', 'إزالة من الباك')}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
            {!pack.items.length && <p className="ss-empty">{t('This pack is empty.', 'الباك فاضية.')}</p>}
            {canSend && pack.items.length > 0 && <p className="ss-hint">{t('Tap a sticker to send it.', 'اضغط على أي ستيكر عشان تبعته.')}</p>}
            <div className="ss-danger">
              {confirmDel ? (
                <>
                  <span>{t('Delete this pack? The stickers stay in My stickers.', 'تمسح الباك دي؟ الستيكرات هتفضل في ستيكراتي.')}</span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDel(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={del} disabled={busy}>{t('Delete', 'حذف')}</button>
                </>
              ) : (
                <button type="button" className="ss-link-danger" onClick={() => setConfirmDel(true)}><Icon name="trash" size={14} /> {t('Delete pack', 'حذف الباك')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
