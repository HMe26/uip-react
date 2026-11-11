import Icon from '../components/Icon';
import { useLanguage } from '../context/LanguageContext';
import { useVirtualMode } from './virtualMode';
import './virtual.css';

/** Little illustration of the desktop: three windows, a Dock. Pure CSS (see virtual.css). */
export function ModeArt() {
  return (
    <div className="vm-art" aria-hidden="true">
      <div className="vm-art__bar"><i /><i /><i /></div>
      <div className="vm-art__win vm-art__win--a"><b /><u /><u /><u /></div>
      <div className="vm-art__win vm-art__win--b"><b /><span /><span /></div>
      <div className="vm-art__win vm-art__win--c"><b /><u /><u /></div>
      <div className="vm-art__dock"><i style={{ background: '#38bdf8' }} /><i style={{ background: '#a78bfa' }} /><i style={{ background: '#f87171' }} /><i style={{ background: '#4ade80' }} /><i style={{ background: '#fbbf24' }} /></div>
    </div>
  );
}

/** About UIPE OS (Settings ▸ UIPE OS). The mode is pinned: there is no switch, only a description. */
export default function ModeCard() {
  const { locale } = useLanguage();
  const tt = (en, a) => (locale === 'ar' ? a : en);
  const vm = useVirtualMode();
  if (!vm.supported) return null;
  return (
    <div className="vm-card is-on">
      <ModeArt />
      <div className="vm-card__body">
        <h3>{tt('UIPE OS', 'UIPE OS')}</h3>
        <p>{tt(
          'The whole platform runs inside your own computer: courses, exams, grades, messages and projects open as windows next to your files, with a Dock, a Start menu and your wallpaper.',
          'المنصة كلها شغّالة من جوّه جهازك الخاص: المواد والامتحانات والدرجات والرسائل والمشاريع بتفتح كنوافذ جنب ملفاتك، مع Dock وقائمة Start وخلفيتك.',
        )}</p>
        <ul className="vm-card__pts">
          <li><Icon name="check-circle" size={14} /> {tt('Everything in the portal, as apps', 'كل اللي في المنصة كتطبيقات')}</li>
          <li><Icon name="check-circle" size={14} /> {tt('Several pages side by side, snap & virtual desktops', 'أكتر من صفحة جنب بعض، وSnap وأسطح مكتب متعددة')}</li>
          <li><Icon name="check-circle" size={14} /> {tt('Follows you to every device', 'بتتابعك على أي جهاز')}</li>
        </ul>
        {!vm.available && <p className="vm-card__note vm-card__note--warn">{tt('UIPE OS is not available for your account right now, so the normal portal is shown.', 'UIPE OS مش متاح لحسابك حاليًا، فبتتعرض المنصة العادية.')}</p>}
      </div>
    </div>
  );
}

/** The top-bar launcher is gone: UIPE OS is pinned, so there is nothing to open. Kept as a no-op so Topbar needs no change. */
export function VirtualLauncher() {
  return null;
}
