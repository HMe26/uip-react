import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import Icon from '../components/Icon';
import { useSandbox } from '../components/zipbench/runner/useSandbox';
import { drive, fetchFolderZip } from '../lib/driveApi';
import { errorMessage } from '../api/client';
import { VSCODE_TEMPLATES, VSCODE_ENVS } from './vscodeTemplates';
import './webApps.css';

/** VS Code (code-server) running in the student's own container on the uip-sandbox gateway, shown in an iframe on the preview domain.
 *  Open a My PC folder or start from a template. Changes are saved back to My PC (autosave + a button + a final save on close). */
const TOKEN_PATH = '/api/v1/drive/vscode-token';
const TARGET_KEY = 'uip.vscode.target';
// same list as HEAVY_DIRS in uip-RUN/src/config.js and SYNC_PRESERVE in Full-API: re-created by the package manager, never sent back
const PRESERVE = ['node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'target', '.gradle', '.next', '.nuxt', '.cache', 'obj'];
const AUTOSAVE_MS = 15000;

const readTarget = () => { try { return JSON.parse(localStorage.getItem(TARGET_KEY) || 'null'); } catch { return null; } };
const writeTarget = (t) => { try { if (t) localStorage.setItem(TARGET_KEY, JSON.stringify(t)); else localStorage.removeItem(TARGET_KEY); } catch { /* private mode */ } };
const idOf = (r) => r?.data?.id ?? r?.id;
const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const STATE = {
  idle: ['Ready', 'جاهز'], connecting: ['Connecting…', 'جاري الاتصال…'], starting: ['Starting VS Code…', 'جاري تشغيل VS Code…'], running: ['Connected', 'متصل'],
  exited: ['Ended', 'انتهت'], error: ['Failed', 'فشل'], closed: ['Closed', 'اتقفل'], disconnected: ['Reconnecting…', 'جاري إعادة الاتصال…'],
};

export default function VsCodeApp({ tt, ar, req, registerGuard }) {
  const sbx = useSandbox('vscode', TOKEN_PATH);
  const { phase, busy, statusText, previewUrl, ports, error } = sbx;
  const [stage, setStage] = useState('pick');     // pick = launcher · run = VS Code
  const [target, setTargetState] = useState(null); // { id, name } of the My PC folder this session saves into (null = a template not saved yet)
  const [name, setName] = useState('');
  const [tree, setTree] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [auto, setAuto] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [portsOpen, setPortsOpen] = useState(false);
  const targetRef = useRef(null); const lastHash = useRef(''); const savingRef = useRef(null); const sbxRef = useRef(sbx);
  sbxRef.current = sbx;
  const setTarget = useCallback((t) => { targetRef.current = t; setTargetState(t); writeTarget(t); }, []);
  const live = phase === 'running' || phase === 'starting' || phase === 'connecting' || phase === 'disconnected';

  // folders for the launcher
  useEffect(() => { let dead = false; drive.tree().then((r) => { if (!dead) setTree(r?.data || []); }).catch(() => { if (!dead) setTree([]); }); return () => { dead = true; }; }, []);

  /** push the session's files to My PC. Returns false when there was nothing to do / no destination yet. */
  const save = useCallback(async ({ force = false } = {}) => {
    if (savingRef.current) return savingRef.current;
    const run = (async () => {
      setSaving(true); setMsg('');
      try {
        const h = await sbxRef.current.treeHash();
        if (!force && h && h === lastHash.current) { setDirty(false); return true; }
        const bytes = await sbxRef.current.pull();
        const blob = new Blob([bytes], { type: 'application/zip' });
        let t = targetRef.current;
        if (!t) { // a template: its first save creates the folder
          const base = (name || 'VS Code project').trim() || 'VS Code project';
          let r = null;
          for (const n of [base, `${base} ${clock(new Date()).replace(':', '-')}`]) { try { r = await drive.createFolder(null, n); t = { id: idOf(r), name: n }; if (t.id) break; } catch { /* name taken: try the next one */ } }
          if (!t?.id) throw new Error(tt('Could not create a folder in My PC.', 'معرفتش أعمل مجلد في جهازي.'));
          setTarget(t);
        }
        await drive.sync(t.id, blob, { preserve: PRESERVE });
        lastHash.current = h || lastHash.current;
        setDirty(false); setSavedAt(new Date());
        window.dispatchEvent(new Event('uip-drive-changed'));
        return true;
      } catch (e) { setMsg(errorMessage(e) || tt('Could not save to My PC.', 'معرفتش أحفظ في جهازي.')); return false; } finally { setSaving(false); savingRef.current = null; }
    })();
    savingRef.current = run;
    return run;
  }, [name, tt, setTarget]);

  // change detection (cheap) + autosave
  useEffect(() => {
    if (stage !== 'run' || phase !== 'running') return undefined;
    let dead = false;
    const tick = async () => {
      const h = await sbxRef.current.treeHash();
      if (dead || !h) return;
      if (!lastHash.current) { lastHash.current = h; return; } // first look = what was just opened
      const changed = h !== lastHash.current;
      setDirty(changed);
      if (changed && auto && targetRef.current && !savingRef.current) save();
    };
    const t = setInterval(tick, AUTOSAVE_MS); tick();
    return () => { dead = true; clearInterval(t); };
  }, [stage, phase, auto, save]);

  // closing the window: save first (the desktop waits for this answer)
  useEffect(() => {
    registerGuard?.(() => {
      if (stage !== 'run' || phase !== 'running') return true;
      return (async () => {
        const h = await sbxRef.current.treeHash();
        const changed = h && h !== lastHash.current;
        if (!changed && targetRef.current) return true;
        if (!changed && !targetRef.current && !window.confirm(tt('This project is not saved in My PC. Close and lose it?', 'المشروع ده مش محفوظ في جهازي. أقفل وأخسره؟'))) return false;
        if (!targetRef.current && changed) {
          if (window.confirm(tt('Save this project to My PC before closing?', 'تحفظ المشروع في جهازي قبل ما تقفل؟'))) return (await save({ force: true })) || window.confirm(tt('Saving failed. Close anyway?', 'الحفظ فشل. أقفل برضه؟'));
          return true;
        }
        return (await save()) || window.confirm(tt('Saving failed. Close anyway?', 'الحفظ فشل. أقفل برضه؟'));
      })();
    });
    return () => registerGuard?.(null);
  }, [registerGuard, stage, phase, save, tt]);

  const begin = useCallback(async ({ folder, template }) => {
    setMsg('');
    try {
      let zip; let t = null; let nm;
      if (folder) {
        setStage('run'); sbxRef.current.reset?.();
        const blob = await fetchFolderZip(folder.id);
        zip = new Uint8Array(await blob.arrayBuffer()); t = { id: folder.id, name: folder.name }; nm = folder.name;
      } else {
        const files = {}; Object.entries(template.files).forEach(([p, c]) => { files[p] = strToU8(c); });
        zip = zipSync(files); nm = ar ? template.ar : template.en;
        setStage('run'); sbxRef.current.reset?.();
      }
      lastHash.current = ''; setDirty(false); setSavedAt(null); setName(nm); setTarget(t);
      sbxRef.current.start({ kind: 'vscode', entry: '', zip, cols: 100, rows: 28 });
    } catch (e) { setStage('pick'); setMsg(errorMessage(e) || tt('Could not open it.', 'معرفتش أفتحه.')); }
  }, [ar, setTarget, tt]);

  // "Open with VS Code" from the explorer: a request carrying a folder (and a nonce, so the same folder can be asked for again)
  const handled = useRef(null);
  useEffect(() => {
    if (!req?.folder || handled.current === req.nonce) return;
    handled.current = req.nonce;
    (async () => { if (stage === 'run' && phase === 'running') { const ok = await save(); if (!ok && !window.confirm(tt('Saving failed. Switch anyway?', 'الحفظ فشل. أبدّل برضه؟'))) return; } begin({ folder: req.folder }); })();
  }, [req, stage, phase, save, begin, tt]);

  // refresh within a few minutes: the gateway still holds the session — attach to it
  useEffect(() => {
    if (handled.current || !sbxRef.current.resumable()) return;
    const t = readTarget(); targetRef.current = t; setTargetState(t); setName(t?.name || ''); setStage('run');
    sbxRef.current.resumeSaved();
  }, []);

  const stop = () => { sbx.reset(); setStage('pick'); setPortsOpen(false); };
  const folders = useMemo(() => (tree || []).filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60), [tree, q]);
  const label = STATE[phase] || STATE.idle;
  const dot = phase === 'running' ? '#3fb950' : busy || phase === 'disconnected' ? '#d29922' : '#ff7b72';

  if (stage === 'pick') {
    return (
      <div className="os-wa os-wa--vs">
        <div className="os-wa__hero"><span className="os-wa__logo os-wa__logo--vs"><Icon name="terminal" size={26} /></span>
          <div><h2>{tt('VS Code', 'VS Code')}</h2><p>{tt('The real VS Code in your browser — with every environment on the server: extensions, terminal, debugging.', 'VS Code الحقيقي في المتصفح — ومعاه كل بيئات السيرفر: إضافات وترمينال و debugging.')}</p></div></div>
        {msg && <div className="os-wa__err" role="alert">{msg}</div>}
        <div className="os-wa__cols">
          <section className="os-wa__card">
            <h3><Icon name="folder" size={15} />{tt('Open a folder from This PC', 'افتح مجلد من جهازي')}</h3>
            <input className="os-wa__in" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search folders…', 'دوّر على مجلد…')} />
            <div className="os-wa__list" role="list">
              {tree === null && <div className="os-wa__hint"><span className="mp-spin" /></div>}
              {tree && !folders.length && <div className="os-wa__hint">{tt('No folders yet. Start from a template →', 'مفيش مجلدات لسه. ابدأ من قالب ←')}</div>}
              {folders.map((f) => (
                <button type="button" role="listitem" key={f.id} className="os-wa__row" onClick={() => begin({ folder: f })}><Icon name="folder" size={16} /><span dir="auto">{f.name}</span><Icon name="arrow-right" size={14} /></button>
              ))}
            </div>
          </section>
          <section className="os-wa__card">
            <h3><Icon name="file-plus" size={15} />{tt('Start a new project', 'ابدأ مشروع جديد')}</h3>
            <div className="os-wa__tpls">
              {VSCODE_TEMPLATES.map((t) => (
                <button type="button" key={t.id} className="os-wa__tpl" onClick={() => begin({ template: t })} title={t.scaffold ? tt('Creates the project with one terminal command', 'بتعمل المشروع بأمر واحد في الترمينال') : ''}>
                  <b style={{ background: t.color }}>{t.tag}</b><span>{ar ? t.ar : t.en}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <p className="os-wa__foot" dir="ltr">{VSCODE_ENVS}</p>
        <p className="os-wa__foot">{tt('Files are saved back to This PC automatically (node_modules / vendor are not copied). The session lasts up to 4 hours.', 'الملفات بتتحفظ في جهازي أوتوماتيك (node_modules و vendor مش بتتنسخ). الجلسة بتفضل لحد 4 ساعات.')}</p>
      </div>
    );
  }

  return (
    <div className="os-wa os-wa--run">
      <div className="os-wa__bar">
        <span className="os-wa__brand"><Icon name="terminal" size={14} /><span dir="auto">{name || 'VS Code'}</span></span>
        <span className="os-wa__st"><i style={{ background: dot }} />{tt(label[0], label[1])}{statusText ? ` — ${statusText}` : ''}</span>
        <span className="os-wa__sp" />
        {savedAt && !dirty && <span className="os-wa__saved"><Icon name="check" size={12} />{tt('Saved', 'اتحفظ')} {clock(savedAt)}</span>}
        {dirty && <span className="os-wa__dirty">{tt('Unsaved changes', 'تعديلات مش محفوظة')}</span>}
        {phase === 'running' && (
          <>
            {target && <label className="os-wa__chk" title={tt('Save changes to This PC every few seconds', 'احفظ التعديلات في جهازي كل شوية')}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />{tt('Autosave', 'حفظ تلقائي')}</label>}
            <button type="button" onClick={() => save({ force: !target })} disabled={saving}><Icon name="save" size={14} />{saving ? '…' : target ? tt('Save to My PC', 'حفظ في جهازي') : tt('Save as a folder in My PC', 'احفظ كمجلد في جهازي')}</button>
            {ports.length > 0 && (
              <span className="os-wa__menu">
                <button type="button" onClick={() => setPortsOpen((o) => !o)}><Icon name="globe" size={14} />{tt('Ports', 'البورتات')} <b>{ports.length}</b></button>
                {portsOpen && <div className="os-wa__pop" onMouseLeave={() => setPortsOpen(false)}>{ports.map((p) => <a key={p.port} href={p.url} target="_blank" rel="noopener noreferrer"><Icon name="external-link" size={13} />localhost:{p.port}</a>)}</div>}
              </span>
            )}
            <button type="button" onClick={() => setFrameKey((k) => k + 1)} title={tt('Reload', 'إعادة تحميل')}><Icon name="refresh" size={14} /></button>
            {previewUrl && <a className="os-wa__btn" href={previewUrl} target="_blank" rel="noopener noreferrer" title={tt('Open in a new tab', 'فتح في تبويب جديد')}><Icon name="external-link" size={14} /></a>}
          </>
        )}
        {phase === 'disconnected' && <button type="button" onClick={() => sbx.reconnect(100, 28)}><Icon name="refresh" size={14} />{tt('Reconnect', 'إعادة الاتصال')}</button>}
        <button type="button" onClick={async () => { if (phase === 'running' && (dirty || !target)) { const ok = await save(); if (!ok && !window.confirm(tt('Saving failed. Close VS Code anyway?', 'الحفظ فشل. أقفل VS Code برضه؟'))) return; } stop(); }}><Icon name="stop" size={14} />{tt('Close VS Code', 'إغلاق VS Code')}</button>
      </div>
      {msg && <div className="os-wa__err" role="alert">{msg}</div>}
      {phase === 'error' && <div className="os-wa__err" role="alert">{error || tt('Could not start VS Code.', 'معرفتش أشغّل VS Code.')}</div>}
      {phase === 'closed' && <div className="os-wa__err" role="status">{statusText ? `${tt('The session ended', 'الجلسة انتهت')}: ${statusText}` : tt('The session ended.', 'الجلسة انتهت.')} <button type="button" className="os-wa__lnk" onClick={stop}>{tt('Back', 'رجوع')}</button></div>}
      <div className="os-wa__stage">
        {previewUrl && live ? (
          <iframe key={`${frameKey}:${previewUrl}`} src={previewUrl} title="VS Code" className="os-wa__frame" referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" />
        ) : (
          <div className="os-wa__wait"><span className="mp-spin" /><p>{phase === 'error' || phase === 'closed' ? '' : tt('Preparing your environment… the first start takes a few seconds.', 'بجهّز البيئة بتاعتك… أول تشغيل بياخد كام ثانية.')}</p></div>
        )}
      </div>
    </div>
  );
}
