import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { usePageMeta } from '../context/PageMetaContext';
import { Avatar } from '../components/messaging/ConversationRail';
import { Modal } from '../components/messaging/modals';
import WallpaperPicker from '../components/messaging/WallpaperPicker';
import { BioEditor, BioBubble } from '../components/messaging/BioNote';
import { useCustomWallpapers, isCustomWall } from '../lib/customWallpapers';
import { useChatSettings, wallFor } from '../lib/chatSettings';
import { peerLabel } from '../components/messaging/format';

/**
 * Chat settings — one full page (replaces the old "⋮" menu in the conversation list).
 *   /{portal}/messages/settings
 * Every choice is saved on the account (PATCH /api/v1/messaging/settings) and enforced by the server:
 * who sees my photo / bio / last seen / stories, who can message / call / add me, wallpapers, notifications…
 */

const BASE = '/api/v1/messaging';
const SECTIONS = [
  ['profile', 'user'],
  ['privacy', 'lock'],
  ['stories', 'sparkles'],
  ['chats', 'palette'],
  ['notifications', 'bell'],
  ['manage', 'inbox'],
];

/* ------------------------------------------------------------------ small building blocks */

function Switch({ on, onChange, label, disabled }) {
  return <button type="button" className={`msg-switch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} aria-pressed={!!on} aria-label={label} disabled={disabled} />;
}

function Group({ title, hint, children }) {
  return (
    <section className="cs-group">
      {title && <h3 className="cs-group__title">{title}</h3>}
      {hint && <p className="cs-group__hint">{hint}</p>}
      <div className="cs-rows">{children}</div>
    </section>
  );
}

function Row({ icon, title, hint, children, onClick, value, chevron }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`cs-row${onClick ? ' is-click' : ''}`} onClick={onClick}>
      {icon && <span className="cs-row__icon"><Icon name={icon} size={18} /></span>}
      <span className="cs-row__text">
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {value && <span className="cs-row__value">{value}</span>}
      {children}
      {chevron && <Icon name="chevron-right" size={16} className="cs-row__chev" />}
    </Tag>
  );
}

/* ------------------------------------------------------------------ audience picker */

const FIELD_META = {
  avatar: { icon: 'image', options: ['everyone', 'contacts', 'contacts_except', 'only', 'nobody'] },
  bio: { icon: 'note', options: ['everyone', 'contacts', 'contacts_except', 'only', 'nobody'] },
  last_seen: { icon: 'clock', options: ['everyone', 'contacts', 'contacts_except', 'only', 'nobody'] },
  stories: { icon: 'sparkles', options: ['everyone', 'contacts', 'contacts_except', 'only'] },
  // messages / calls = NEW people (nobody has talked to me and been answered yet); *_contacts = people I already replied to
  messages: { icon: 'message', options: ['everyone', 'only', 'nobody'] },
  calls: { icon: 'phone', options: ['everyone', 'only', 'nobody'] },
  messages_contacts: { icon: 'message', options: ['everyone', 'contacts_except', 'only', 'nobody'] },
  calls_contacts: { icon: 'phone', options: ['everyone', 'contacts_except', 'only', 'nobody'] },
  groups: { icon: 'users', options: ['everyone', 'contacts', 'contacts_except', 'only', 'nobody'] },
};

function useCopy() {
  const { locale } = useLanguage();
  const t = (en, ar) => (locale === 'ar' ? ar : en);
  const fields = {
    avatar: [t('Who can see my profile photo', 'مين يشوف صورتي الشخصية'), t('Everyone else sees your initials instead of the photo.', 'الباقي هيشوفوا الحروف الأولى من اسمك بدل الصورة.')],
    bio: [t('Who can see my bio', 'مين يشوف البايو بتاعي'), t('The short text under your name in chats.', 'النص القصير اللي تحت اسمك في المحادثات.')],
    last_seen: [t('Who can see my last seen & online status', 'مين يشوف آخر ظهور وحالة الاتصال'), t('Others will see no status at all.', 'الباقي مش هيشوفوا أي حالة اتصال.')],
    stories: [t('Who can see my stories', 'مين يشوف الاستوري بتاعتي'), t('This also sets the default audience for new stories.', 'ده كمان بيحدد الجمهور الافتراضي للاستوري الجديدة.')],
    messages: [t('Who can message me', 'مين يقدر يراسلني'), t('Applies to new people only — nobody you have answered yet.', 'للناس الجديدة بس — أي حد لسه ما رديتش عليه.')],
    calls: [t('Who can call me', 'مين يقدر يتصل بيا'), t('Applies to new people only. Their call is refused.', 'للناس الجديدة بس. مكالمتهم بتترفض.')],
    messages_contacts: [t('Who can message me', 'مين يقدر يراسلني'), t('People you already replied to. If off, their chat with you is locked.', 'الناس اللي رديت عليهم بالفعل. لو قفلتها شاتهم معاك بيتقفل.')],
    calls_contacts: [t('Who can call me', 'مين يقدر يتصل بيا'), t('People you already replied to.', 'الناس اللي رديت عليهم بالفعل.')],
    groups: [t('Who can add me to groups', 'مين يقدر يضيفني لمجموعات'), t('Others can still invite you with a link.', 'ممكن يدعوك بالرابط برضه.')],
  };
  const aud = (field) => ({
    everyone: [t('Everyone', 'الجميع'), t('Anyone on the platform', 'أي حد على المنصة')],
    contacts: field === 'messages'
      ? [t('Only people I already chat with', 'اللي بتكلمهم بالفعل بس'), t('No new chats from strangers', 'مفيش محادثات جديدة من غرباء')]
      : [t('My contacts', 'جهات اتصالي'), t('People you have a direct chat with', 'الناس اللي بينك وبينهم محادثة مباشرة')],
    contacts_except: field === 'messages_contacts' || field === 'calls_contacts'
      ? [t('Everyone except…', 'الكل ما عدا…'), t('All of them, minus the people you pick', 'كلهم ما عدا ناس تختارهم')]
      : [t('My contacts except…', 'جهات اتصالي ما عدا…'), t('Contacts, minus the people you pick', 'جهات الاتصال ما عدا ناس تختارهم')],
    only: [t('Only share with…', 'ناس محددين فقط…'), t('Just the people you pick', 'الناس اللي تختارهم بس')],
    nobody: field === 'messages' || field === 'calls' ? [t('No new people', 'لا أحد جديد'), t('New people cannot reach me', 'الناس الجديدة مش هتقدر توصلّي')] : [t('Nobody', 'لا أحد'), t('Only you', 'أنت فقط')],
  });
  return { t, fields, aud };
}

function summary(p, t) {
  const n = p.ids.length;
  switch (p.audience) {
    case 'everyone': return t('Everyone', 'الجميع');
    case 'contacts': return t('My contacts', 'جهات اتصالي');
    case 'contacts_except': return n ? t(`Everyone except ${n}`, `الكل ما عدا ${n}`) : t('Everyone', 'الجميع');
    case 'only': return t(`${n} selected`, `${n} محدد`);
    default: return t('Nobody', 'لا أحد');
  }
}

function AudienceModal({ field, current, people, onClose, onSave }) {
  const { t, fields, aud } = useCopy();
  const [audience, setAudience] = useState(current.audience);
  const [ids, setIds] = useState(current.ids);
  const [known, setKnown] = useState(() => ({ ...people }));
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsPeople = audience === 'only' || audience === 'contacts_except';
  const labels = aud(field);

  useEffect(() => {
    if (!needsPeople) return undefined;
    let dead = false;
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`${BASE}/stories/contacts`, q.trim() ? { q: q.trim() } : undefined);
        if (!dead) {
          const rows = Array.isArray(res.data) ? res.data : [];
          setList(rows);
          setKnown((k) => { const n = { ...k }; rows.forEach((r) => { n[r.id] = r; }); return n; });
        }
      } catch { if (!dead) setList([]); } finally { if (!dead) setLoading(false); }
    }, q ? 250 : 0);
    return () => { dead = true; clearTimeout(h); };
  }, [needsPeople, q]);

  const toggle = (id) => setIds((cur) => (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]));
  const picked = ids.map((id) => known[id] || { id, full_name: `#${id}` });
  const canSave = !busy && !(audience === 'only' && ids.length === 0);

  const save = async () => {
    setBusy(true); setError('');
    try { await onSave({ audience, ids: needsPeople ? ids : [] }); onClose(); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <Modal
      title={fields[field][0]}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!canSave}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save', 'حفظ')}</button>
        </>
      )}
    >
      <p className="cs-group__hint" style={{ marginTop: 0 }}>{fields[field][1]}</p>
      <div className="cs-radios" role="radiogroup">
        {FIELD_META[field].options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={audience === o} className={`cs-radio${audience === o ? ' is-on' : ''}`} onClick={() => setAudience(o)}>
            <i className="cs-radio__dot" />
            <span><strong>{labels[o][0]}</strong><small>{labels[o][1]}</small></span>
          </button>
        ))}
      </div>

      {needsPeople && (
        <div className="cs-people">
          <div className="cs-people__title">
            {audience === 'only' ? t('Share only with', 'شارك مع الناس دول فقط') : t('Hide from', 'أخفِ عن')}
            <b>{ids.length}</b>
          </div>
          {picked.length > 0 && (
            <div className="cs-chips">
              {picked.map((p) => (
                <button key={p.id} type="button" className="cs-pchip" onClick={() => toggle(p.id)} title={t('Remove', 'إزالة')}>
                  <Avatar name={p.full_name} src={p.avatar_path} size="sm" />
                  <span>{p.full_name}</span><Icon name="x" size={12} />
                </button>
              ))}
            </div>
          )}
          <label className="mc-search" style={{ maxWidth: 'none' }}>
            <Icon name="search" size={15} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name or email…', 'ابحث بالاسم أو الإيميل…')} />
          </label>
          <div className="cs-plist">
            {loading && <p className="cs-empty">{t('Loading…', 'جارٍ التحميل…')}</p>}
            {!loading && list.length === 0 && <p className="cs-empty">{q ? t('No one found.', 'لا توجد نتائج.') : t('No contacts yet — search to find anyone.', 'لا توجد جهات اتصال بعد — ابحث للعثور على أي شخص.')}</p>}
            {list.map((p) => {
              const on = ids.includes(p.id);
              return (
                <button key={p.id} type="button" className={`cs-person${on ? ' is-on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                  <Avatar name={p.full_name} src={p.avatar_path} size="sm" />
                  <span>{p.full_name}</span>
                  <i className="cs-check">{on && <Icon name="check" size={13} />}</i>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && <p className="mc-alert" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

function AudienceRow({ field, settings, onOpen }) {
  const { t, fields } = useCopy();
  return <Row icon={FIELD_META[field].icon} title={fields[field][0]} hint={fields[field][1]} value={summary(settings.privacy[field], t)} onClick={() => onOpen(field)} chevron />;
}

/* ------------------------------------------------------------------ sections */

function ProfileSection({ settings, save, openAudience }) {
  const { t } = useCopy();
  const { user } = useAuth();
  const name = user?.full_name || user?.name || user?.fullName || '';
  return (
    <>
      <div className="cs-profile">
        <Avatar name={name} src={user?.avatar_path || user?.avatar} />
        <div className="cs-profile__text">
          <strong>{name}</strong>
          <span dir="ltr">{user?.email}</span>
          {(settings.bio || '').trim() ? <BioBubble text={settings.bio.trim()} styleId={settings.bio_style} tail={false} className="cs-profile__bio" /> : <em className="cs-profile__bio">{t('No bio yet', 'لا يوجد بايو بعد')}</em>}
        </div>
      </div>
      <Group title={t('Bio', 'البايو')} hint={t('A short note (emoji welcome) shown in a bubble under the chat header, in the design you pick. You decide who sees it below.', 'ملاحظة قصيرة (والإيموجي مرحّب بيه) بتظهر في فقاعة تحت هيدر المحادثة بالتصميم اللي تختاره. وإنت تحدد مين يشوفها من تحت.')}>
        <BioEditor settings={settings} save={save} />
      </Group>
      <Group title={t('Who sees my profile', 'مين يشوف ملفي الشخصي')}>
        <AudienceRow field="bio" settings={settings} onOpen={openAudience} />
        <AudienceRow field="avatar" settings={settings} onOpen={openAudience} />
        <AudienceRow field="last_seen" settings={settings} onOpen={openAudience} />
      </Group>
    </>
  );
}


/* ------------------------------------------------------------------ availability timer */

const DAY_NAMES = (t) => [t('Sun', 'أحد'), t('Mon', 'اثنين'), t('Tue', 'ثلاثاء'), t('Wed', 'أربعاء'), t('Thu', 'خميس'), t('Fri', 'جمعة'), t('Sat', 'سبت')];
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fmt12 = (hhmm, ar) => { const [h, m] = String(hhmm).split(':').map(Number); const hh = h % 12 || 12; return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM')}`; };
const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'UTC']; } };

/** Same rule as the server: is "now" (in the schedule's time zone) inside the open window? (overnight windows supported) */
function isOpenNow(sch) {
  if (!sch.enabled) return true;
  let parts;
  try { parts = new Intl.DateTimeFormat('en-US', { timeZone: sch.tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()); } catch { return true; }
  const get = (ty) => parts.find((p) => p.type === ty)?.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  const s = toMin(sch.start); const e = toMin(sch.end);
  const has = (d) => sch.days.includes(d);
  if (s < e) return has(dow) && mins >= s && mins < e;
  if (mins >= s) return has(dow);
  if (mins < e) return has((dow + 6) % 7);
  return false;
}

function ScheduleCard({ settings, save }) {
  const { t } = useCopy();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const saved = settings.schedule;
  const [d, setD] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setD(saved); }, [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  const names = DAY_NAMES(t);
  const set = (p) => { setErr(''); setD((x) => ({ ...x, ...p })); };
  const toggleDay = (i) => set({ days: d.days.includes(i) ? d.days.filter((x) => x !== i) : [...d.days, i].sort() });
  const tzList = useMemo(() => { const z = zones(); return z.includes(d.tz) ? z : [d.tz, ...z]; }, [d.tz]);
  const browserTz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } }, []);

  const s = toMin(d.start); const e = toMin(d.end);
  const overnight = s > e;
  const open = isOpenNow(saved);
  const scopes = [
    ['new', t('New people', 'الناس الجديدة'), t('Nobody you have answered yet', 'أي حد ما رديتش عليه')],
    ['contacts', t('People I chat with', 'اللي بكلمهم'), t('People you already replied to', 'اللي رديت عليهم بالفعل')],
    ['all', t('Everyone', 'الكل'), t('New and current', 'الجديد والحالي')],
  ];

  async function onSave() {
    setBusy(true); setErr('');
    try { await save({ schedule: d }); } catch (ex) { setErr(errorMessage(ex)); } finally { setBusy(false); }
  }

  return (
    <div className="cs-sched">
      <div className="cs-sched__top">
        <span className="cs-row__icon"><Icon name="clock" size={18} /></span>
        <span className="cs-row__text">
          <strong>{t('Open my chat only during set hours', 'افتح الشات في ساعات محددة بس')}</strong>
          <small>{saved.enabled
            ? (open ? t('Open right now', 'مفتوح دلوقتي') : t('Closed right now', 'مقفول دلوقتي'))
            : t('Off — people can reach you any time', 'مقفول — الناس توصلك في أي وقت')}</small>
        </span>
        {saved.enabled && <span className={`cs-sched__state${open ? ' is-open' : ''}`}>{open ? t('Open', 'مفتوح') : t('Closed', 'مقفول')}</span>}
        <Switch on={d.enabled} onChange={(v) => set({ enabled: v })} label={t('Availability timer', 'تايمر التواصل')} />
      </div>

      {d.enabled && (
        <div className="cs-sched__body">
          <div className="cs-sched__label">{t('Days', 'الأيام')}</div>
          <div className="cs-sched__days" role="group" aria-label={t('Days', 'الأيام')}>
            {names.map((n, i) => (
              <button key={i} type="button" className={d.days.includes(i) ? 'is-on' : ''} aria-pressed={d.days.includes(i)} onClick={() => toggleDay(i)}>{n}</button>
            ))}
          </div>
          <div className="cs-sched__presets">
            <button type="button" onClick={() => set({ days: [0, 1, 2, 3, 4] })}>{t('Sun–Thu', 'الأحد–الخميس')}</button>
            <button type="button" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>{t('Mon–Fri', 'الاثنين–الجمعة')}</button>
            <button type="button" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })}>{t('Every day', 'كل الأيام')}</button>
          </div>

          <div className="cs-sched__label">{t('Hours', 'الساعات')}</div>
          <div className="cs-sched__times">
            <label><span>{t('From', 'من')}</span><input type="time" value={d.start} onChange={(ev) => set({ start: ev.target.value || '09:00' })} /></label>
            <label><span>{t('To', 'إلى')}</span><input type="time" value={d.end} onChange={(ev) => set({ end: ev.target.value || '16:00' })} /></label>
          </div>
          <div className="cs-sched__bar" aria-hidden="true" dir="ltr">
            {overnight ? (<><i style={{ left: 0, width: `${(e / 1440) * 100}%` }} /><i style={{ left: `${(s / 1440) * 100}%`, right: 0 }} /></>) : <i style={{ left: `${(s / 1440) * 100}%`, width: `${((e - s) / 1440) * 100}%` }} />}
            <em>0</em><em>6</em><em>12</em><em>18</em><em>24</em>
          </div>
          <p className="cs-sched__sum">
            {t('Open', 'مفتوح')} {fmt12(d.start, ar)} → {fmt12(d.end, ar)}{overnight ? ` ${t('(next day)', '(لليوم التالي)')}` : ''}
          </p>

          <div className="cs-sched__label">{t('Time zone', 'المنطقة الزمنية')}</div>
          <div className="cs-sched__tz">
            <select value={d.tz} onChange={(ev) => set({ tz: ev.target.value })} aria-label={t('Time zone', 'المنطقة الزمنية')}>
              {tzList.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            {browserTz && browserTz !== d.tz && <button type="button" onClick={() => set({ tz: browserTz })}>{t('Use my device', 'استخدم جهازي')}</button>}
          </div>

          <div className="cs-sched__label">{t('Who does it apply to?', 'ينطبق على مين؟')}</div>
          <div className="cs-sched__scopes" role="radiogroup">
            {scopes.map(([id, label, sub]) => (
              <button key={id} type="button" role="radio" aria-checked={d.applies_to === id} className={d.applies_to === id ? 'is-on' : ''} onClick={() => set({ applies_to: id })}>
                <strong>{label}</strong><small>{sub}</small>
              </button>
            ))}
          </div>

          <div className="cs-sched__label">{t('What closes outside the hours?', 'إيه اللي بيتقفل خارج الساعات؟')}</div>
          <div className="cs-sched__affects">
            <label><input type="checkbox" checked={d.affects.messages} onChange={(ev) => set({ affects: { ...d.affects, messages: ev.target.checked } })} /> {t('Messages (chat is locked)', 'الرسائل (الشات بيتقفل)')}</label>
            <label><input type="checkbox" checked={d.affects.calls} onChange={(ev) => set({ affects: { ...d.affects, calls: ev.target.checked } })} /> {t('Calls', 'المكالمات')}</label>
          </div>
        </div>
      )}

      {err && <p className="mc-alert" role="alert">{err}</p>}
      {dirty && (
        <div className="cs-sched__foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setD(saved); setErr(''); }} disabled={busy}>{t('Discard', 'تراجع')}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={busy}>{busy ? t('Saving…', 'جارٍ الحفظ…') : t('Save timer', 'حفظ التايمر')}</button>
        </div>
      )}
    </div>
  );
}

function PrivacySection({ settings, save, openAudience, base }) {
  const { t } = useCopy();
  return (
    <>
      <Group title={t('Who can see my info', 'مين يشوف معلوماتي')}>
        <AudienceRow field="avatar" settings={settings} onOpen={openAudience} />
        <AudienceRow field="bio" settings={settings} onOpen={openAudience} />
        <AudienceRow field="last_seen" settings={settings} onOpen={openAudience} />
        <AudienceRow field="stories" settings={settings} onOpen={openAudience} />
      </Group>
      <Group title={t('New people', 'الناس الجديدة')} hint={t("Anyone who hasn't chatted with you yet, or you haven't answered.", 'أي حد لسه ما اتكلمش معاك، أو إنت ما رديتش عليه.')}>
        <AudienceRow field="messages" settings={settings} onOpen={openAudience} />
        <AudienceRow field="calls" settings={settings} onOpen={openAudience} />
        <AudienceRow field="groups" settings={settings} onOpen={openAudience} />
      </Group>
      <Group title={t('People I already chat with', 'اللي بتكلمهم بالفعل')} hint={t('People who messaged you and you replied. Their settings are separate from the new-people ones above.', 'الناس اللي راسلوك ورديت عليهم. إعداداتهم منفصلة عن إعدادات الناس الجديدة فوق.')}>
        <AudienceRow field="messages_contacts" settings={settings} onOpen={openAudience} />
        <AudienceRow field="calls_contacts" settings={settings} onOpen={openAudience} />
      </Group>
      <Group title={t('Availability timer', 'تايمر التواصل')} hint={t('Open and close your chat on a schedule — outside these hours people cannot message or call you.', 'افتح وقفل الشات بمواعيد — خارج الساعات دي محدش يقدر يراسلك أو يتصل بيك.')}>
        <ScheduleCard settings={settings} save={save} />
      </Group>
      <Group title={t('Activity', 'النشاط')}>
        <Row icon="check-circle" title={t('Read receipts', 'إشعارات القراءة')} hint={t("Let others see when you've read their messages (and stories). If you turn it off you won't see theirs either.", 'خلّي الناس تعرف إنك قرأت رسايلهم (والاستوري). لو قفلتها مش هتشوف بتوعهم.')}>
          <Switch on={settings.read_receipts_enabled} onChange={(v) => save({ read_receipts_enabled: v })} label={t('Read receipts', 'إشعارات القراءة')} />
        </Row>
        <Row icon="pulse" title={t('Typing indicator', 'مؤشر الكتابة')} hint={t('Show "typing…" to the other person while you write.', 'اعرض "يكتب…" للطرف التاني وإنت بتكتب.')}>
          <Switch on={settings.typing_indicator} onChange={(v) => save({ typing_indicator: v })} label={t('Typing indicator', 'مؤشر الكتابة')} />
        </Row>
        <Row icon="search" title={t('Appear in people search', 'أظهر في البحث عن الأشخاص')} hint={t('When off, only your contacts can find you by name when starting a chat.', 'لو قفلتها، بس جهات اتصالك يقدروا يلاقوك بالاسم لما يبدأوا محادثة.')}>
          <Switch on={settings.discoverable} onChange={(v) => save({ discoverable: v })} label={t('Appear in people search', 'أظهر في البحث')} />
        </Row>
      </Group>
      <Group title={t('Blocking', 'الحظر')}>
        <Row icon="shield" title={t('Blocked people & my reports', 'المحظورون وبلاغاتي')} hint={t("Blocked people can't message or call you.", 'المحظور لا يقدر يراسلك أو يتصل بك.')} onClick={() => base.go('blocked')} chevron />
      </Group>
    </>
  );
}

function StoriesSection({ settings, save, openAudience }) {
  const { t } = useCopy();
  return (
    <>
      <Group title={t('Audience', 'الجمهور')}>
        <AudienceRow field="stories" settings={settings} onOpen={openAudience} />
      </Group>
      <Group title={t('New stories', 'الاستوري الجديدة')} hint={t('Defaults used every time you post (you can still change them per story).', 'قيم افتراضية بتتطبق كل ما تنشر (وتقدر تغيّرها لكل استوري).')}>
        <Row icon="message" title={t('Allow replies', 'السماح بالردود')} hint={t('People who see a story can reply to you in chat.', 'اللي بيشوف الاستوري يقدر يرد عليك في الشات.')}>
          <Switch on={settings.stories_allow_replies} onChange={(v) => save({ stories_allow_replies: v })} label={t('Allow replies', 'السماح بالردود')} />
        </Row>
        <Row icon="clock" title={t('Disappears after', 'تختفي بعد')}>
          <div className="cs-seg" role="radiogroup">
            {[6, 12, 24, 48].map((h) => (
              <button key={h} type="button" role="radio" aria-checked={settings.stories_expiry_hours === h} className={settings.stories_expiry_hours === h ? 'is-on' : ''} onClick={() => save({ stories_expiry_hours: h })}>
                {t(`${h}h`, `${h} س`)}
              </button>
            ))}
          </div>
        </Row>
      </Group>
    </>
  );
}

function ChatWallModal({ chat, settings, wp, save, onClose }) {
  const { t } = useCopy();
  const own = settings.wallpaper.per_chat[String(chat.id)] || '';
  const setOwn = (id) => save({ wallpaper: { per_chat: { [chat.id]: id } } });
  return (
    <Modal title={t('Background — ', 'خلفية — ') + peerLabel(chat)} onClose={onClose} footer={<button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{t('Done', 'تم')}</button>}>
      <WallpaperPicker
        value={own}
        usingDefault={!own}
        onChange={setOwn}
        onUseDefault={() => setOwn(null)}
        customWalls={wp.items}
        onAddCustomWall={async (f, st) => { const id = await wp.add(f, st); await setOwn(`img:${id}`); }}
        onRemoveCustomWall={async (id) => { await wp.remove(id); if (own === `img:${id}`) await setOwn(null); }}
      />
    </Modal>
  );
}

function ChatsSection({ settings, save, wp }) {
  const { t, } = useCopy();
  const [inbox, setInbox] = useState(null);
  const [q, setQ] = useState('');
  const [chat, setChat] = useState(null);
  useEffect(() => { api.get(BASE + '/inbox').then((r) => setInbox(r.data || [])).catch(() => setInbox([])); }, []);
  const chats = useMemo(() => (inbox || []).filter((c) => !c.is_saved && (!q.trim() || peerLabel(c).toLowerCase().includes(q.trim().toLowerCase()))), [inbox, q]);
  const mine = (inbox || []).filter((c) => settings.wallpaper.per_chat[String(c.id)]);
  const wallLabel = (id) => (isCustomWall(id) ? t('My photo', 'صورتي') : id);
  const defWall = settings.wallpaper.default;
  const setDefault = (id) => save({ wallpaper: { default: id } });

  return (
    <>
      <Group title={t('Default background', 'الخلفية الافتراضية')} hint={t('Applies to every chat that has no background of its own.', 'بتتطبق على كل المحادثات اللي مالهاش خلفية خاصة.')}>
        <div className="cs-pad">
          <WallpaperPicker
            value={defWall}
            onChange={setDefault}
            customWalls={wp.items}
            onAddCustomWall={async (f, st) => { const id = await wp.add(f, st); await setDefault(`img:${id}`); }}
            onRemoveCustomWall={async (id) => { await wp.remove(id); if (defWall === `img:${id}`) await setDefault('dots'); }}
            anim={settings.wallpaper.anim}
            onAnim={(v) => save({ wallpaper: { anim: v } })}
          />
        </div>
      </Group>

      <Group title={t('Background for a specific chat', 'خلفية لمحادثة معيّنة')} hint={t('Pick a chat and give it its own background. It overrides the default only there.', 'اختار محادثة وادّيها خلفية خاصة. بتغلب الافتراضية في المحادثة دي بس.')}>
        <div className="cs-pad">
          <label className="mc-search" style={{ maxWidth: 'none' }}>
            <Icon name="search" size={15} />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search chats…', 'ابحث في المحادثات…')} />
          </label>
          {mine.length > 0 && !q && <p className="cs-mini">{t(`${mine.length} chat(s) with their own background`, `${mine.length} محادثة لها خلفية خاصة`)}</p>}
          <div className="cs-chatlist">
            {inbox === null && <p className="cs-empty">{t('Loading…', 'جارٍ التحميل…')}</p>}
            {inbox !== null && chats.length === 0 && <p className="cs-empty">{t('No chats found.', 'لا توجد محادثات.')}</p>}
            {chats.slice(0, 60).map((c) => {
              const own = settings.wallpaper.per_chat[String(c.id)];
              const shown = own || defWall;
              return (
                <button key={c.id} type="button" className="cs-chatrow" onClick={() => setChat(c)}>
                  <Avatar name={peerLabel(c)} isGroup={c.is_group} src={c.is_group ? c.group_avatar : c.peer_avatar} size="sm" />
                  <span className="cs-chatrow__name">{peerLabel(c)}</span>
                  <span className={`cs-chatrow__wall${own ? ' is-own' : ''}`}>
                    {isCustomWall(shown) ? <span className="msg-wall-swatch" style={{ backgroundImage: `url("${wp.items.find((w) => `img:${w.id}` === shown)?.url || ''}")`, backgroundSize: 'cover' }} /> : <span className={`msg-wall-swatch msg-wall-swatch--${shown}`} />}
                    <small>{own ? wallLabel(own) : t('Default', 'افتراضي')}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Group>

      <Group title={t('Text & typing', 'النص والكتابة')}>
        <Row icon="ed-type" title={t('Message text size', 'حجم خط الرسائل')}>
          <div className="cs-seg" role="radiogroup">
            {[['sm', t('Small', 'صغير')], ['md', t('Medium', 'متوسط')], ['lg', t('Large', 'كبير')]].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={settings.font_size === k} className={settings.font_size === k ? 'is-on' : ''} onClick={() => save({ font_size: k })}>{l}</button>
            ))}
          </div>
        </Row>
        <Row icon="send" title={t('Enter key sends the message', 'زر Enter يرسل الرسالة')} hint={t('When off, Enter adds a new line (use the Send button).', 'لو قفلته، Enter بينزل سطر جديد (استخدم زر الإرسال).')}>
          <Switch on={settings.enter_to_send} onChange={(v) => save({ enter_to_send: v })} label={t('Enter sends', 'Enter يرسل')} />
        </Row>
      </Group>

      {chat && <ChatWallModal chat={chat} settings={settings} wp={wp} save={save} onClose={() => setChat(null)} />}
    </>
  );
}

function NotificationsSection({ settings, save }) {
  const { t } = useCopy();
  return (
    <Group title={t('Messages', 'الرسائل')} hint={t('Per-chat muting is still in each chat\'s details panel.', 'كتم محادثة بعينها لسه من لوحة تفاصيل المحادثة.')}>
      <Row icon="bell" title={t('Message notifications', 'إشعارات الرسائل')} hint={t('Get a notification when someone writes to you.', 'يوصلك إشعار لما حد يكتبلك.')}>
        <Switch on={settings.notify_messages} onChange={(v) => save({ notify_messages: v })} label={t('Message notifications', 'إشعارات الرسائل')} />
      </Row>
      <Row icon="eye" title={t('Show message preview', 'إظهار معاينة الرسالة')} hint={t('When off, notifications only say "message" without the text.', 'لو قفلته، الإشعار بيقول "رسالة" من غير النص.')}>
        <Switch on={settings.notify_preview} onChange={(v) => save({ notify_preview: v })} label={t('Message preview', 'معاينة الرسالة')} />
      </Row>
      <Row icon="volume" title={t('Sounds in chat', 'أصوات الشات')} hint={t('Play a sound when a new message arrives.', 'شغّل صوت لما توصل رسالة جديدة.')}>
        <Switch on={settings.sounds} onChange={(v) => save({ sounds: v })} label={t('Sounds', 'الأصوات')} />
      </Row>
    </Group>
  );
}

function ManageSection({ base }) {
  const { t } = useCopy();
  return (
    <Group title={t('Manage chats', 'إدارة المحادثات')}>
      <Row icon="check-circle" title={t('Select & delete chats', 'تحديد وحذف محادثات')} hint={t('Pick several chats and move them to the trash.', 'اختار أكتر من محادثة وانقلها لسلة المحذوفات.')} onClick={() => base.go('', { selectChats: true })} chevron />
      <Row icon="archive" title={t('Archived chats', 'المحادثات المؤرشفة')} onClick={() => base.go('archived')} chevron />
      <Row icon="shield" title={t('Blocked people', 'المحظورون')} onClick={() => base.go('blocked')} chevron />
      <Row icon="flag" title={t('My reports', 'بلاغاتي')} onClick={() => base.go('reports')} chevron />
      <Row icon="trash" title={t('Trash', 'المحذوفات')} hint={t('Deleted chats are kept for 30 days.', 'المحادثات المحذوفة بتتحفظ 30 يوم.')} onClick={() => base.go('trash')} chevron />
    </Group>
  );
}

/* ------------------------------------------------------------------ page */

export default function ChatSettings() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const navigate = useNavigate();
  const location = useLocation();
  const base = location.pathname.replace(/\/messages(\/.*)?$/, '/messages');
  const { settings, loaded, error, patch } = useChatSettings();
  const wp = useCustomWallpapers();

  usePageMeta(t('Chat settings', 'إعدادات الشات'), t('Privacy, profile, backgrounds and notifications for your chats.', 'الخصوصية والملف الشخصي والخلفيات والإشعارات للمحادثات.'));
  useEffect(() => {
    document.body.classList.add('msg-center-active');
    return () => document.body.classList.remove('msg-center-active');
  }, []);

  const [section, setSection] = useState(() => {
    const h = (location.hash || '').replace('#', '');
    return SECTIONS.some(([k]) => k === h) ? h : 'profile';
  });
  const [audienceField, setAudienceField] = useState(null);
  const [notice, setNotice] = useState(null);
  const flash = useCallback((text, err = false) => setNotice({ text, err }), []);
  useEffect(() => {
    if (!notice) return undefined;
    const h = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(h);
  }, [notice]);

  const save = useCallback(async (p) => {
    try { await patch(p); flash(t('Saved', 'تم الحفظ')); } catch (e) { flash(errorMessage(e), true); throw e; }
  }, [patch, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = { go: (sub, state) => navigate(sub ? `${base}/${sub}` : base, state ? { state } : undefined) };
  const titles = {
    profile: t('Profile & bio', 'الملف الشخصي والبايو'),
    privacy: t('Privacy', 'الخصوصية'),
    stories: t('Stories', 'الاستوري'),
    chats: t('Chats & backgrounds', 'المحادثات والخلفيات'),
    notifications: t('Notifications', 'الإشعارات'),
    manage: t('Manage', 'إدارة'),
  };
  const pick = (k) => { setSection(k); try { window.history.replaceState(null, '', `#${k}`); } catch { /* ignore */ } };

  return (
    <div className="mc cs-page">
      <div className="mc-top">
        <Link to={base} className="mc-back" aria-label={t('Back to messages', 'العودة للرسائل')}>
          <Icon name={ar ? 'arrow-right' : 'arrow-left'} size={18} /> <span>{t('Back to messages', 'العودة للرسائل')}</span>
        </Link>
        <h1 className="mc-title">{t('Chat settings', 'إعدادات الشات')}</h1>
        <p className="mc-sub">{t('Privacy, profile, backgrounds and notifications for your chats.', 'الخصوصية والملف الشخصي والخلفيات والإشعارات للمحادثات.')}</p>
      </div>

      {error && !loaded && <div className="mc-alert" role="alert">{t('Could not load your settings. Showing defaults.', 'تعذّر تحميل إعداداتك. بعرض القيم الافتراضية.')}</div>}

      <div className="cs">
        <nav className="cs-nav" aria-label={t('Settings sections', 'أقسام الإعدادات')}>
          {SECTIONS.map(([k, icon]) => (
            <button key={k} type="button" className={`cs-nav__item${section === k ? ' is-active' : ''}`} onClick={() => pick(k)} aria-current={section === k ? 'page' : undefined}>
              <Icon name={icon} size={17} /><span>{titles[k]}</span>
            </button>
          ))}
        </nav>

        <div className="cs-main card glass-panel" aria-busy={!loaded}>
          <h2 className="cs-main__title">{titles[section]}</h2>
          {section === 'profile' && <ProfileSection settings={settings} save={save} openAudience={setAudienceField} />}
          {section === 'privacy' && <PrivacySection settings={settings} save={save} openAudience={setAudienceField} base={nav} />}
          {section === 'stories' && <StoriesSection settings={settings} save={save} openAudience={setAudienceField} />}
          {section === 'chats' && <ChatsSection settings={settings} save={save} wp={wp} />}
          {section === 'notifications' && <NotificationsSection settings={settings} save={save} />}
          {section === 'manage' && <ManageSection base={nav} />}
        </div>
      </div>

      {audienceField && (
        <AudienceModal
          field={audienceField}
          current={settings.privacy[audienceField]}
          people={settings.people}
          onClose={() => setAudienceField(null)}
          onSave={(p) => save({ privacy: { [audienceField]: p } })}
        />
      )}
      {notice && <div className={`mc-toast${notice.err ? ' is-error' : ''}`} role={notice.err ? 'alert' : 'status'}>{notice.text}</div>}
    </div>
  );
}
