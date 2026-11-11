import { useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { fmtBytes, BASE, useBanner, useL } from './shared';
import { useNavigate } from 'react-router-dom';

/** Scans (in batches) for files recorded in the database but missing from the storage disk. */
export default function HealthTab() {
  const { L } = useL();
  const navigate = useNavigate();
  const { banner, setError, clear } = useBanner();
  const [running, setRunning] = useState(false);
  const [checked, setChecked] = useState(0);
  const [missing, setMissing] = useState([]);
  const [done, setDone] = useState(false);

  async function scan() {
    setRunning(true); setDone(false); setChecked(0); setMissing([]); clear();
    let after = 0; let guard = 0;
    try {
      while (guard++ < 2000) {
        const j = await api.get(`${BASE}/maintenance/missing-files`, { after_id: after, limit: 300 });
        setChecked((c) => c + j.data.checked);
        setMissing((m) => [...m, ...j.data.missing]);
        if (!j.data.next_after_id) break;
        after = j.data.next_after_id;
      }
      setDone(true);
    } catch (e) { setError(errorMessage(e)); }
    setRunning(false);
  }

  return (
    <div className="mtc-stack">
      {banner}
      <section className="sa-card mtc-card">
        <h2 className="mtc-card__title"><Icon name="wrench" size={16} /> {L('Storage health check', 'فحص سلامة التخزين')}</h2>
        <p className="mtc-muted">{L('Finds files that exist in the database but are missing from the storage disk (deleted by hand, failed upload, wrong disk).', 'بيدوّر على ملفات موجودة في قاعدة البيانات ومش موجودة على قرص التخزين (اتمسحت يدويًا، رفع فشل، قرص غلط).')}</p>
        <div className="mtc-actions"><button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={scan}><Icon name="refresh" size={14} /> {running ? L('Scanning…', 'جارٍ الفحص…') : L('Start scan', 'ابدأ الفحص')}</button>
          {(running || done) && <span className="mtc-muted">{L(`${checked.toLocaleString()} checked · ${missing.length} missing`, `تم فحص ${checked.toLocaleString()} · مفقود ${missing.length}`)}</span>}</div>
      </section>
      {done && missing.length === 0 && <div className="st-alert mtc-banner"><Icon name="check-circle" size={16} /><span>{L('All files exist on the storage disk.', 'كل الملفات موجودة على قرص التخزين.')}</span></div>}
      {missing.length > 0 && (
        <div className="adm-table-wrap"><table className="adm-table">
          <thead><tr><th>{L('File', 'الملف')}</th><th>{L('Owner', 'المالك')}</th><th>{L('Size', 'الحجم')}</th><th /></tr></thead>
          <tbody>{missing.map((f) => (
            <tr key={f.id}><td data-label={L('File', 'الملف')} dir="auto">{f.name}</td><td>#{f.owner_id}</td><td>{fmtBytes(f.size_bytes)}</td>
              <td className="mtc-row-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/admin/drive-control/users/${f.owner_id}?parent=${f.parent_id ?? ''}`)}>{L('Open owner', 'فتح المالك')}</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
