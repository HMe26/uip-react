import { useCallback, useEffect, useState } from 'react';
import { BackLink } from '../../lib/backStack';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useLanguage } from '../../context/LanguageContext';
import { ConfirmModal } from '../../components/admin/adminUi';
import { Skeleton } from '../../components/admin/AdminPage';

/**
 * Admin → Chat Media. Full control of GIFs and stickers in messaging:
 * Giphy key, who may send / create, content rating, size limits, blocked words…
 * Talks to AdminChatMediaApiController (GET/PUT/DELETE /api/v1/admin/chat-media, POST …/test-giphy).
 */
const BASE = '/api/v1/admin/chat-media';

const ROLE_LABELS = {
  student: ['Students', 'الطلاب'],
  university: ['Universities', 'الجامعات'],
  faculty: ['Faculties', 'الكليات'],
  supervisor: ['Supervisors', 'المشرفون'],
  security: ['Security staff', 'فريق الأمان'],
  data_analyst: ['Data analysts', 'محللو البيانات'],
};
const RATING_LABELS = {
  g: ['G – everyone', 'G – للجميع'],
  pg: ['PG – parental guidance', 'PG – بإشراف'],
  'pg-13': ['PG-13 – teens and up (default)', 'PG-13 – للمراهقين فما فوق (الافتراضي)'],
  r: ['R – mature', 'R – للبالغين'],
};

function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
    </label>
  );
}

function Row({ title, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--st-radius-sm)', background: 'var(--bg-muted)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div className="text-small" style={{ fontWeight: 600 }}>{title}</div>
        {hint && <div className="text-caption" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>{children}</div>
    </div>
  );
}

function Panel({ icon, title, hint, children }) {
  return (
    <div className="adm-panel" style={{ marginBottom: 16 }}>
      <h2 className="text-h3" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <Icon name={icon} size={18} /> {title}
      </h2>
      {hint && <p className="text-caption" style={{ marginBottom: 'var(--space-4)' }}>{hint}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>{children}</div>
    </div>
  );
}

function RoleChips({ value, roles, onChange, t, labels }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {roles.map((r) => {
        const on = value?.[r] !== false;
        return (
          <button key={r} type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`} aria-pressed={on} onClick={() => onChange({ ...value, [r]: !on })}>
            {on ? '✓ ' : ''}{t(...(labels[r] || [r, r]))}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminChatMedia() {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const t = (en, arText) => (ar ? arText : en);
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [giphyKey, setGiphyKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [confirm, setConfirm] = useState(null); // 'reset' | 'key'

  const apply = (d) => { setData(d); setForm(d.policy); setGiphyKey(''); };
  const load = useCallback(() => {
    setLoading(true);
    api.get(BASE)
      .then((r) => apply(r.data))
      .catch((e) => setMsg({ ok: false, text: errorMessage(e) }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await api.put(BASE, { ...form, giphy_api_key: giphyKey.trim() });
      apply(r.data);
      setMsg({ ok: true, text: t('Saved. It applies to everyone immediately.', 'تم الحفظ. بيتطبق على الجميع فورًا.') });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setSaving(false); }
  };
  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      await api.post(BASE + '/test-giphy', { giphy_api_key: giphyKey.trim() });
      setMsg({ ok: true, text: t('Giphy accepted the key.', 'Giphy قبل المفتاح.') });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setTesting(false); }
  };
  const doReset = async () => {
    try { const r = await api.del(BASE); apply(r.data); setMsg({ ok: true, text: t('Back to the default settings.', 'رجعنا للإعدادات الافتراضية.') }); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
    setConfirm(null);
  };
  const doRemoveKey = async () => {
    try { const r = await api.del(BASE + '/giphy-key'); apply({ ...r.data, policy: form }); setForm(form); setMsg({ ok: true, text: t('Giphy key removed.', 'تم حذف مفتاح Giphy.') }); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
    setConfirm(null);
  };

  if (loading || !form) {
    return (<><div className="page-header"><div className="page-header__title"><h1 className="text-h1">{t('Chat Media', 'وسائط الشات')}</h1></div></div>{loading ? <Skeleton /> : <p className="form-error">{msg?.text}</p>}</>);
  }
  const roles = data.roles;
  const giphy = data.giphy;
  const num = (k, min, max) => (
    <input type="number" className="form-input" style={{ width: 120 }} min={min} max={max} value={form[k]} onChange={(e) => set(k, e.target.value)} />
  );

  return (
    <>
      <BackLink to="/admin/messaging/settings" className="adm-link-back"><Icon name="chevron-left" size={14} /> {t('Messaging Settings', 'إعدادات الرسائل')}</BackLink>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('Chat Media (GIFs & Stickers)', 'وسائط الشات (GIF والستيكرز)')}</h1>
          <p className="text-small">{t('Control who can use GIFs and stickers, what shows up, and the Giphy connection — no redeploy needed.', 'تحكم في مين يستخدم الـ GIF والستيكرز وإيه اللي يظهر، وربط Giphy — من غير ما تعمل deploy.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-outline" onClick={() => setConfirm('reset')}>{t('Reset to defaults', 'استرجاع الافتراضي')}</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}><Icon name="check" size={16} /> {saving ? t('Saving…', 'جارٍ الحفظ…') : t('Save changes', 'حفظ التغييرات')}</button>
        </div>
      </div>
      {msg && <p className={msg.ok ? 'adm-note' : 'form-error'} role="status">{msg.text}</p>}

      <Panel icon="key" title={t('Giphy connection', 'ربط Giphy')} hint={t('GIF search and trending come from Giphy. Paste your API key here — it is stored encrypted and never shown in full again.', 'بحث الـ GIF والأكثر رواجًا بييجي من Giphy. حط الـ API key هنا — بيتخزن مشفّر وبعد الحفظ مش بيظهر كامل تاني.')}>
        <Row
          title={giphy.configured ? t('A key is set', 'المفتاح متسجّل') : t('No key yet — the GIF tab shows “not set up”', 'مفيش مفتاح — تبويب الـ GIF بيقول “غير مفعّل”')}
          hint={giphy.configured ? `${giphy.masked} · ${giphy.source === 'dashboard' ? t('saved from this page', 'محفوظ من هذه الصفحة') : t('from the server .env', 'من ملف .env في السيرفر')}` : undefined}
        >
          <span className={`badge ${giphy.configured ? 'badge-success' : 'badge-danger'}`}>{giphy.configured ? t('Connected', 'متصل') : t('Not set', 'غير مضبوط')}</span>
          {giphy.source === 'dashboard' && <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirm('key')}>{t('Remove', 'حذف')}</button>}
        </Row>
        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{giphy.configured ? t('Replace the key', 'استبدال المفتاح') : t('Giphy API key', 'مفتاح Giphy (API key)')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="password" autoComplete="off" data-allow-clipboard className="form-input" style={{ flex: '1 1 260px' }} dir="ltr" value={giphyKey} onChange={(e) => setGiphyKey(e.target.value)} placeholder={giphy.configured ? '••••••••••••' : 'paste the key here'} />
            <button type="button" className="btn btn-outline" onClick={test} disabled={testing || (!giphyKey.trim() && !giphy.configured)}>{testing ? t('Testing…', 'جارٍ الاختبار…') : t('Test key', 'اختبار المفتاح')}</button>
          </div>
          <span className="text-caption">{t('Leave empty to keep the current key. Press “Save changes” to store a new one.', 'سيبه فاضي لو عايز تحتفظ بالمفتاح الحالي. دوس “حفظ التغييرات” لتخزين مفتاح جديد.')}</span>
        </div>
      </Panel>

      <Panel icon="image" title={t('GIFs', 'الـ GIF')}>
        <Row title={t('GIFs enabled', 'تفعيل الـ GIF')} hint={t('Master switch. Off hides the GIF tab for everyone and blocks sending.', 'المفتاح الرئيسي. لو اتقفل بيختفي تبويب الـ GIF عند الكل ويتمنع الإرسال.')}>
          <Switch checked={form.gifs_enabled} onChange={(v) => set('gifs_enabled', v)} label="GIFs" />
        </Row>
        <Row title={t('Search', 'البحث')} hint={t('Let people search Giphy by keyword.', 'السماح بالبحث في Giphy بالكلمات.')}>
          <Switch checked={form.gif_search_enabled} onChange={(v) => set('gif_search_enabled', v)} label="Search" />
        </Row>
        <Row title={t('Trending', 'الأكثر رواجًا')} hint={t('Show Giphy’s trending GIFs.', 'عرض الـ GIF الرائجة من Giphy.')}>
          <Switch checked={form.gif_trending_enabled} onChange={(v) => set('gif_trending_enabled', v)} label="Trending" />
        </Row>
        <Row title={t('Content rating', 'تصنيف المحتوى')} hint={t('The most mature rating that can appear.', 'أعلى تصنيف مسموح بظهوره.')}>
          <select className="form-input" value={form.gif_rating} onChange={(e) => set('gif_rating', e.target.value)}>
            {data.ratings.map((r) => <option key={r} value={r}>{t(...RATING_LABELS[r])}</option>)}
          </select>
        </Row>
        <Row title={t('Results per page', 'عدد النتائج في الصفحة')} hint="6 – 50">{num('gif_per_page', 6, 50)}</Row>
        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Blocked words', 'كلمات محظورة')}</label>
          <textarea className="form-input" rows={3} dir="auto" value={form.gif_blocked_words} onChange={(e) => set('gif_blocked_words', e.target.value)} placeholder={t('word1, word2, word3', 'كلمة١، كلمة٢، كلمة٣')} />
          <span className="text-caption">{t('Searches containing these words return nothing, and GIFs whose title contains them are hidden. Separate with commas or new lines.', 'أي بحث فيه الكلمات دي مش بيرجّع نتائج، وأي GIF عنوانه فيه واحدة منها بتتخفي. افصل بفاصلة أو سطر جديد.')}</span>
        </div>
        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Who can send GIFs', 'مين يقدر يبعت GIF')}</label>
          <RoleChips value={form.gif_send_roles} roles={roles} labels={ROLE_LABELS} t={t} onChange={(v) => set('gif_send_roles', v)} />
          <span className="text-caption">{t('Admins are never blocked.', 'الأدمن عمره ما بيتمنع.')}</span>
        </div>
      </Panel>

      <Panel icon="smile" title={t('Stickers', 'الستيكرز')}>
        <Row title={t('Stickers enabled', 'تفعيل الستيكرز')} hint={t('Master switch. Off hides the stickers tab and blocks sending and creating.', 'المفتاح الرئيسي. لو اتقفل بيختفي تبويب الستيكرز ويتمنع الإرسال والإنشاء.')}>
          <Switch checked={form.stickers_enabled} onChange={(v) => set('stickers_enabled', v)} label="Stickers" />
        </Row>
        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Who can send stickers', 'مين يقدر يبعت ستيكرز')}</label>
          <RoleChips value={form.sticker_send_roles} roles={roles} labels={ROLE_LABELS} t={t} onChange={(v) => set('sticker_send_roles', v)} />
        </div>
        <Row title={t('People can create their own stickers', 'السماح بإنشاء ستيكرات شخصية')} hint={t('Off: only stickers that already exist can be used.', 'لو اتقفل: بيتستخدم الموجود بس ومفيش إنشاء جديد.')}>
          <Switch checked={form.sticker_create_enabled} onChange={(v) => set('sticker_create_enabled', v)} label="Create" />
        </Row>
        <div className="form-group">
          <label className="text-small" style={{ fontWeight: 600 }}>{t('Who can create stickers', 'مين يقدر ينشئ ستيكرز')}</label>
          <RoleChips value={form.sticker_create_roles} roles={roles} labels={ROLE_LABELS} t={t} onChange={(v) => set('sticker_create_roles', v)} />
        </div>
        <Row title={t('Video stickers (webm / mp4)', 'ستيكرز فيديو (webm / mp4)')} hint={t('Off: images only.', 'لو اتقفل: صور بس.')}>
          <Switch checked={form.sticker_allow_video} onChange={(v) => set('sticker_allow_video', v)} label="Video" />
        </Row>
        <Row title={t('Sticker packs', 'باكات الستيكرز')} hint={t('Let people group their stickers into named packs.', 'السماح بتجميع الستيكرز في باكات بأسماء.')}>
          <Switch checked={form.sticker_packs_enabled} onChange={(v) => set('sticker_packs_enabled', v)} label="Packs" />
        </Row>
        <Row title={t('Max sticker size (KB)', 'أقصى حجم للستيكر (KB)')} hint="64 – 10240">{num('sticker_max_kb', 64, 10240)}</Row>
        <Row title={t('Max stickers per person', 'أقصى عدد ستيكرز للشخص')} hint="0 – 1000">{num('sticker_max_per_user', 0, 1000)}</Row>
      </Panel>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}><Icon name="check" size={16} /> {saving ? t('Saving…', 'جارٍ الحفظ…') : t('Save changes', 'حفظ التغييرات')}</button>
      </div>

      {confirm === 'reset' && <ConfirmModal title={t('Reset to defaults?', 'استرجاع الافتراضي؟')} message={t('All GIF and sticker settings go back to their defaults. The Giphy key is kept.', 'كل إعدادات الـ GIF والستيكرز هترجع للافتراضي. مفتاح Giphy بيفضل زي ما هو.')} confirmLabel={t('Reset', 'استرجاع')} danger onConfirm={doReset} onClose={() => setConfirm(null)} />}
      {confirm === 'key' && <ConfirmModal title={t('Remove the Giphy key?', 'حذف مفتاح Giphy؟')} message={t('GIF search stops working until a new key is added (unless the server .env has one).', 'بحث الـ GIF هيقف لحد ما تضيف مفتاح جديد (إلا لو في .env على السيرفر مفتاح).')} confirmLabel={t('Remove', 'حذف')} danger onConfirm={doRemoveKey} onClose={() => setConfirm(null)} />}
    </>
  );
}
