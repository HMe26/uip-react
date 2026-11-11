import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { api, errorMessage } from '../../api/client';
import { postsApi } from '../../api/postsApi';
import { avatarUrl, initials, peerLabel } from '../messaging/format';
import { useAuth } from '../../context/AuthContext';
import { PAvatar, useTt } from './shared';

const toneOf = (n) => { let h = 0; for (const ch of String(n || '')) h = (h * 31 + ch.charCodeAt(0)) % 5; return h; };
const convAvatar = (c) => (c.is_saved ? c.saved_avatar : c.is_group ? c.group_avatar : c.peer_deleted ? null : c.peer_avatar);

function Chat({ c, state, onSend }) {
  const name = peerLabel(c);
  const url = avatarUrl(convAvatar(c));
  return (
    <button type="button" className={`sh-chat is-${state || 'idle'}`} onClick={() => onSend(c)} disabled={state === 'busy' || state === 'sent'} title={name}>
      <span className={`sh-chat__av fc-tone-${toneOf(name)}`}>
        {url ? <img src={url} alt="" /> : c.is_group ? <Icon name="users" size={22} /> : initials(name)}
        {state === 'sent' && <span className="sh-chat__ok"><Icon name="check" size={14} /></span>}
        {state === 'busy' && <span className="sh-chat__spin" />}
      </span>
      <span className="sh-chat__n">{name}</span>
    </button>
  );
}

/** Share sheet: share now (repost with a note), send to a chat, or share the link through other apps. */
export default function ShareDialog({ post, onClose, onShared }) {
  const { tt, rtl } = useTt();
  const { user } = useAuth();
  // Public posts get the open page (/post/:id) so anyone with the link can read it; limited-audience posts keep the in-app link.
  const url = post.visibility === 'public' ? `${window.location.origin}/post/${post.id}` : `${window.location.origin}${window.location.pathname}?post=${post.id}`;
  const title = post.title || (post.body || '').slice(0, 90) || tt('A post on UIPE', 'منشور على UIPE');
  const canRepost = post.can?.repost;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [chats, setChats] = useState(null);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState({}); // conv id -> busy | sent | err
  const [copied, setCopied] = useState(false);
  const rail = useRef(null);

  useEffect(() => { api.get('/api/v1/messaging/inbox').then((r) => setChats((Array.isArray(r?.data) ? r.data : []))).catch(() => setChats([])); }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  const shown = useMemo(() => (chats || []).filter((c) => !q.trim() || peerLabel(c).toLowerCase().includes(q.trim().toLowerCase())), [chats, q]);
  const record = (channel) => postsApi.share(post.id, channel).then(() => onShared?.()).catch(() => {});

  const shareNow = async () => {
    setBusy(true); setErr('');
    try { await postsApi.repost(post.id, note.trim() || undefined); setDone(tt('Shared to your profile.', 'تمت المشاركة على ملفك الشخصي.')); onShared?.('repost'); setTimeout(onClose, 900); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const sendTo = async (c) => {
    setSent((s) => ({ ...s, [c.id]: 'busy' })); setErr('');
    try {
      const fd = new FormData(); fd.append('body', `${note.trim() ? `${note.trim()}\n` : ''}${url}`);
      await api.postForm(`/api/v1/messaging/conversations/${c.id}/messages`, fd);
      setSent((s) => ({ ...s, [c.id]: 'sent' })); record('chat');
    } catch (e) { setSent((s) => ({ ...s, [c.id]: 'err' })); setErr(errorMessage(e)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); record('link'); } catch { setErr(tt('Could not copy the link.', 'تعذّر نسخ الرابط.')); } };
  const open = (href) => { window.open(href, '_blank', 'noopener,noreferrer'); record('external'); };
  const enc = encodeURIComponent;
  const native = async () => { try { await navigator.share({ url, title }); record('external'); } catch { /* cancelled */ } };

  const targets = [
    ['whatsapp', 'WhatsApp', '#25D366', 'M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Zm4.6 12.4c-.2.6-1.2 1.1-1.7 1.1-.4 0-1 .2-3.2-.7a10.7 10.7 0 0 1-4-3.5c-.6-.8-1-1.7-1-2.6 0-.9.5-1.4.7-1.6.2-.2.4-.2.6-.2h.4c.1 0 .3 0 .5.4l.7 1.7c.1.1.1.3 0 .4l-.3.5-.4.4c-.1.1-.3.3-.1.5.5.8 1.2 1.5 2 2 .3.2.5.3.7.2l.5-.6c.2-.2.3-.2.5-.1l1.6.8c.2.1.3.2.4.3.1.2.1.8-.1 1.2Z', () => open(`https://wa.me/?text=${enc(`${title} ${url}`)}`)],
    ['telegram', 'Telegram', '#229ED9', 'M21 4 3 11l5 2 2 6 3-4 5 4 3-15ZM9 13l9-6-7 7', () => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`)],
    ['facebook', 'Facebook', '#1877F2', 'M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v8h4v-8h3l1-4h-4V8Z', () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`)],
    ['x', 'X', '#111827', 'M4 4l16 16M20 4 4 20', () => open(`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(title)}`)],
    ['linkedin', 'LinkedIn', '#0A66C2', 'M5 9v10M5 5v.01M10 19V9m0 4a4 4 0 0 1 8 0v6', () => open(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`)],
    ['email', tt('Email', 'البريد'), '#EA4335', 'M3 6h18v12H3zM3 7l9 7 9-7', () => { window.location.href = `mailto:?subject=${enc(title)}&body=${enc(url)}`; record('external'); }],
  ];

  return (
    <div className="sh-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sh-sheet" role="dialog" aria-modal="true" aria-label={tt('Share', 'مشاركة')} dir={rtl ? 'rtl' : 'ltr'}>
        <header className="sh-head">
          <h3>{tt('Share', 'مشاركة')}</h3>
          <button type="button" className="sh-x" onClick={onClose} aria-label={tt('Close', 'إغلاق')}><Icon name="x" size={18} /></button>
        </header>

        <div className="sh-body">
          <section className="sh-sec sh-compose">
            <div className="sh-me">
              <PAvatar user={user} size={44} />
              <div className="sh-me__t"><strong>{user?.full_name || tt('Your profile', 'ملفك الشخصي')}</strong><span><Icon name="globe" size={11} /> {tt('Shared as a repost', 'تُنشر كإعادة نشر')}</span></div>
            </div>
            <textarea className="sh-note" dir="auto" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tt('Say something about this…', 'قل شيئًا عن هذا…')} />
            <div className="sh-preview">
              <PAvatar user={post.author} size={32} />
              <div><strong>{post.author?.full_name}</strong><p dir="auto">{title}</p></div>
              {post.media?.length > 0 && <span className="sh-preview__m"><Icon name="image" size={14} /> {post.media.length}</span>}
            </div>
            {canRepost ? (
              <button type="button" className="sh-now" onClick={shareNow} disabled={busy || !!done}>{done ? <><Icon name="check" size={16} /> {done}</> : busy ? tt('Sharing…', 'جارٍ المشاركة…') : tt('Share now', 'مشاركة الآن')}</button>
            ) : <p className="sh-hint"><Icon name="lock" size={13} /> {tt('This post can’t be reposted, but you can send or share its link.', 'لا يمكن إعادة نشر هذا المنشور، لكن يمكنك إرسال رابطه أو مشاركته.')}</p>}
          </section>

          <section className="sh-sec">
            <div className="sh-sec__h"><h4>{tt('Send in chat', 'إرسال في المحادثات')}</h4>
              <label className="sh-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search', 'بحث')} /></label></div>
            <div className="sh-rail-wrap">
              <button type="button" className="sh-arrow is-prev" onClick={() => rail.current?.scrollBy({ left: rtl ? 260 : -260, behavior: 'smooth' })} aria-label="prev"><Icon name="chevron-left" size={18} /></button>
              <div className="sh-rail" ref={rail}>
                {chats === null && [0, 1, 2, 3, 4].map((i) => <span key={i} className="sh-chat sh-chat--skel" />)}
                {chats && shown.length === 0 && <p className="sh-empty">{tt('No chats found', 'لا توجد محادثات')}</p>}
                {shown.map((c) => <Chat key={c.id} c={c} state={sent[c.id]} onSend={sendTo} />)}
              </div>
              <button type="button" className="sh-arrow is-next" onClick={() => rail.current?.scrollBy({ left: rtl ? -260 : 260, behavior: 'smooth' })} aria-label="next"><Icon name="chevron-right" size={18} /></button>
            </div>
          </section>

          <section className="sh-sec">
            <h4>{tt('Share to', 'مشاركة على')}</h4>
            <div className="sh-apps">
              <button type="button" className="sh-app" onClick={copy}><span className={`sh-app__i${copied ? ' is-ok' : ''}`}><Icon name={copied ? 'check' : 'link'} size={22} /></span><small>{copied ? tt('Copied!', 'تم النسخ!') : tt('Copy link', 'نسخ الرابط')}</small></button>
              {targets.map(([k, label, color, d, fn]) => (
                <button type="button" key={k} className="sh-app" onClick={fn}>
                  <span className="sh-app__i" style={{ '--c': color }}><svg width="22" height="22" viewBox="0 0 24 24" fill={k === 'facebook' || k === 'whatsapp' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={k === 'facebook' || k === 'whatsapp' ? 0 : 2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></span>
                  <small>{label}</small>
                </button>
              ))}
              {typeof navigator.share === 'function' && <button type="button" className="sh-app" onClick={native}><span className="sh-app__i"><Icon name="share" size={22} /></span><small>{tt('More', 'المزيد')}</small></button>}
            </div>
            <div className="sh-link"><input readOnly dir="ltr" value={url} onFocus={(e) => e.target.select()} /><button type="button" onClick={copy}>{copied ? tt('Copied', 'تم') : tt('Copy', 'نسخ')}</button></div>
          </section>
          {err && <div className="sh-err" role="alert">{err}</div>}
        </div>
      </div>
    </div>
  );
}
