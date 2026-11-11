import Icon from '../components/Icon';
import { CLOCK_STYLES } from './MobileClock';

/** Defaults of the phone look (stored inside the desktop prefs, so they follow the account to every device). */
export const MOBILE_DEFAULTS = { mHome: 'pages', mClock: 'ios', mIcon: 'm', mLabels: true, mIsland: true, mLibrary: true, mStorage: true, mDock: 'glass', mHaptics: true };

function Seg({ value, options, onChange, label }) {
  return (
    <div className="mps-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.icon && <Icon name={o.icon} size={16} />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
const Switch = ({ on, onChange, label, sub, icon }) => (
  <button type="button" className="mps-sw" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
    <span className="mps-sw__ic"><Icon name={icon} size={18} /></span>
    <span className="mps-sw__tx"><b>{label}</b>{sub && <small>{sub}</small>}</span>
    <i className={`mps-sw__k${on ? ' is-on' : ''}`} aria-hidden="true" />
  </button>
);
const Group = ({ title, children }) => <section className="mps-grp"><h4>{title}</h4>{children}</section>;

/** The phone's look & feel panel: home layout (pages you swipe / one scrolling list), clock style, icon size, Dynamic Island, Dock… */
export default function MobilePrefs({ prefs, setPrefs, tt, ar }) {
  const v = (k) => (prefs?.[k] === undefined ? MOBILE_DEFAULTS[k] : prefs[k]);
  const set = (k) => (x) => setPrefs({ [k]: x });
  return (
    <div className="mps">
      <Group title={tt('Home screen layout', 'شكل الشاشة الرئيسية')}>
        <Seg label={tt('Home screen layout', 'شكل الشاشة الرئيسية')} value={v('mHome')} onChange={set('mHome')} options={[
          { id: 'pages', icon: 'layers', label: tt('Swipe pages', 'صفحات بالسحب') },
          { id: 'list', icon: 'menu', label: tt('One list', 'قائمة واحدة') },
        ]} />
        <p className="mps-hint">{v('mHome') === 'pages'
          ? tt('Apps and files sit on pages you swipe sideways, like an iPhone, with page dots and an App Library at the end.', 'التطبيقات والملفات في صفحات بتسحبها يمين وشمال زي الآيفون، مع نقط الصفحات ومكتبة التطبيقات في الآخر.')
          : tt('Everything stacked in one vertical list you scroll.', 'كل حاجة تحت بعض في قائمة واحدة بتنزل فيها.')}</p>
        <Switch icon="grid" on={v('mLibrary')} onChange={set('mLibrary')} label={tt('App Library', 'مكتبة التطبيقات')} sub={tt('Last page, apps grouped automatically', 'آخر صفحة، التطبيقات متجمّعة تلقائيًا')} />
      </Group>

      <Group title={tt('Clock', 'الساعة')}>
        <div className="mps-clocks" role="radiogroup" aria-label={tt('Clock', 'الساعة')}>
          {CLOCK_STYLES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={v('mClock') === c.id} className={`mps-clk mps-clk--${c.id}${v('mClock') === c.id ? ' is-on' : ''}`} onClick={() => setPrefs({ mClock: c.id })}>
              <span className="mps-clk__pv" aria-hidden="true">{c.id === 'ios' ? <><u>الثلاثاء</u><b>1:49</b></> : c.id === 'digital' ? <b>1:49</b> : c.id === 'analog' ? <i /> : c.id === 'minimal' ? <em>1:49 · الثلاثاء</em> : <Icon name="x" size={16} />}</span>
              <span>{ar ? c.ar : c.en}</span>
            </button>
          ))}
        </div>
        <Switch icon="hard-drive" on={v('mStorage')} onChange={set('mStorage')} label={tt('Storage widget', 'ويدجت المساحة')} sub={tt('How much of your space is used', 'المساحة المستخدمة من ملفاتك')} />
      </Group>

      <Group title={tt('Icons', 'الأيقونات')}>
        <Seg label={tt('Icon size', 'حجم الأيقونات')} value={v('mIcon')} onChange={set('mIcon')} options={[
          { id: 's', label: tt('Small', 'صغيرة') }, { id: 'm', label: tt('Medium', 'متوسطة') }, { id: 'l', label: tt('Large', 'كبيرة') },
        ]} />
        <Switch icon="edit" on={v('mLabels')} onChange={set('mLabels')} label={tt('Show names', 'إظهار الأسماء')} sub={tt('Text under each icon', 'الاسم تحت كل أيقونة')} />
      </Group>

      <Group title={tt('Look & feel', 'المظهر والإحساس')}>
        <Switch icon="smartphone" on={v('mIsland')} onChange={set('mIsland')} label={tt('Dynamic Island', 'الجزيرة الديناميكية')} sub={tt('A pill at the top that expands for notifications', 'كبسولة فوق بتتوسّع مع الإشعارات')} />
        <Seg label={tt('Dock', 'الدوك')} value={v('mDock')} onChange={set('mDock')} options={[
          { id: 'glass', label: tt('Glass', 'زجاجي') }, { id: 'solid', label: tt('Solid', 'ثابت') },
        ]} />
        <Switch icon="star" on={v('mHaptics')} onChange={set('mHaptics')} label={tt('Haptics', 'الاهتزاز اللمسي')} sub={tt('A small tap when you swipe a page or long-press', 'اهتزاز خفيف مع السحب والضغط المطوّل')} />
      </Group>

      <button type="button" className="mps-reset" onClick={() => setPrefs({ ...MOBILE_DEFAULTS })}><Icon name="refresh" size={16} />{tt('Reset to default', 'الرجوع للوضع الافتراضي')}</button>
    </div>
  );
}
