import Icon from '../components/Icon';
import { cloud, useCloud } from '../lib/cloud/engine';
import { useSaveCenter } from '../lib/saveCenter';
import { cloudSummary } from './CloudSettings';

/** System-tray status: cloud backup state + a badge while some document has unsaved changes. Click = Settings ▸ Storage & backup. */
export default function CloudTray({ tt, onOpen }) {
  const cl = useCloud();
  const sc = useSaveCenter();
  const any = cl.provider || cloud.available('google') || cloud.available('microsoft');
  if (!any && !sc.dirtyCount) return null;
  const sum = cloudSummary(cl, tt);
  const icon = !cl.provider ? 'cloud-off' : cl.status === 'running' ? 'cloud-up' : sum.tone === 'ok' ? 'cloud-check' : sum.tone === 'warn' || sum.tone === 'bad' ? 'alert-triangle' : 'cloud';
  const unsaved = sc.dirtyCount > 0 ? tt(` · ${sc.dirtyCount} unsaved`, ` · ${sc.dirtyCount} غير محفوظ`) : '';
  return (
    <button type="button" className={`os-tray__cloud os-tray__cloud--${sum.tone}`} title={`${sum.text}${unsaved}`} aria-label={`${sum.text}${unsaved}`} onClick={onOpen}>
      <Icon name={icon} size={15} />
      {sc.dirtyCount > 0 && <b className="os-tray__badge">{sc.dirtyCount}</b>}
    </button>
  );
}
