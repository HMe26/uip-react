import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { desktopApi, lockError } from './desktopApi';
import { wipeLocalData } from '../lib/wipeLocalData';
import { leftText } from './apps';

/**
 * After "Reset this PC" the files wait 24 h in the Recycle Bin. This pill reminds the student (on every device) and offers Undo.
 * Hidden for the rest of the tab session with ✕ (it comes back on the next visit while the window is still open).
 */
const HIDE = 'uip_reset_bar_hidden';
const hidden = () => { try { return sessionStorage.getItem(HIDE) === '1'; } catch { return false; } };

export default function ResetUndoBar({ tt, uid }) {
  const [st, setSt] = useState(null);
  const [off, setOff] = useState(hidden);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    desktopApi.resetStatus().then((r) => { if (!dead) setSt(r); }).catch(() => {});
    return () => { dead = true; };
  }, [uid]);
  if (!st?.pending || off) return null;
  const undo = async () => {
    setBusy(true); setErr('');
    try { await desktopApi.resetUndo(); await wipeLocalData({ keepSession: true }); window.location.reload(); } catch (x) { setErr(lockError(x)); setBusy(false); }
  };
  const hide = () => { try { sessionStorage.setItem(HIDE, '1'); } catch { /* ignore */ } setOff(true); };
  return (
    <div className="os-undobar" role="status">
      <Icon name="clock" size={16} />
      <span dir="auto">{err || tt(`PC was reset. Your files are deleted for good in ${leftText(st.seconds_left, tt)}.`, `الجهاز اتعمله إعادة تهيئة. ملفاتك هتتمسح نهائيًا بعد ${leftText(st.seconds_left, tt)}.`)}</span>
      <button type="button" onClick={undo} disabled={busy}>{busy ? '…' : tt('Undo', 'تراجع')}</button>
      <button type="button" className="os-undobar__x" onClick={hide} aria-label={tt('Hide', 'إخفاء')}>✕</button>
    </div>
  );
}
