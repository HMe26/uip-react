import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import ExportMenu from '../../components/ExportMenu';
import { exportFromCsvBlob, saveBlob } from '../../lib/exporter';
import SqlEditor, { EmptyEditor, QueryTabs } from '../../components/sql/SqlEditor';
import { tokenizeSql } from '../../components/sql/sqlHighlight';
import { useTranslations } from '../../context/LanguageContext';
import { useLanguage } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/data-analysis/query-builder/index';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * SQL Query Builder — talks to the real JSON API
 * (/api/v1/data-analysis/queries/*, DataAnalysisQueriesApiController).
 * Table/column allow-lists, operators and the 500-row cap all come from the
 * backend contract; nothing here widens what the API accepts.
 * Read-only: SELECT only.
 *
 * UI notes: styles live in styles/css/data-analysis-queries.css (`qb-*`).
 * The visual builder shows a live, client-side SQL preview — it is only a
 * preview; the server builds and validates the real statement on run
 * (the executed SQL is shown under the results).
 */

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'LIKE %..%' },
  { value: 'starts', label: 'LIKE ..%' },
  { value: 'null', label: 'IS NULL' },
  { value: 'not_null', label: 'IS NOT NULL' },
];
const NO_VALUE_OPS = ['null', 'not_null'];
const LIMIT_PRESETS = [50, 100, 250, 500];
const COLUMN_FILTER_THRESHOLD = 12;

const downloadBlob = saveBlob;

function sqlValue(v) {
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
}

/** Client-side preview only — the server builds the statement it actually runs. */
function buildPreviewSql({ table, columns, where, groupBy, orderBy, limit }) {
  if (!table) return '';
  const lines = [`SELECT ${columns.length ? columns.join(', ') : '*'}`, `FROM ${table}`];
  const conds = where
    .filter((w) => w.column && (NO_VALUE_OPS.includes(w.op) || w.value !== ''))
    .map((w) => {
      switch (w.op) {
        case 'contains': return `${w.column} LIKE ${sqlValue(`%${w.value}%`)}`;
        case 'starts': return `${w.column} LIKE ${sqlValue(`${w.value}%`)}`;
        case 'null': return `${w.column} IS NULL`;
        case 'not_null': return `${w.column} IS NOT NULL`;
        default: return `${w.column} ${OPERATORS.find((o) => o.value === w.op)?.label || '='} ${sqlValue(w.value)}`;
      }
    });
  if (conds.length) lines.push(`WHERE ${conds.join('\n  AND ')}`);
  if (groupBy.length) lines.push(`GROUP BY ${groupBy.join(', ')}`);
  const order = orderBy.filter((o) => o.column).map((o) => `${o.column} ${o.dir.toUpperCase()}`);
  if (order.length) lines.push(`ORDER BY ${order.join(', ')}`);
  lines.push(`LIMIT ${Number(limit) || 100};`);
  return lines.join('\n');
}

function SqlCode({ sql, tables }) {
  return tokenizeSql(sql, tables).map((tk, i) => (
    tk.t === 'ws' || tk.t === 'op' ? tk.v : <span key={i} className={`qb-tok-${tk.t}`}>{tk.v}</span>
  ));
}

const TABS_KEY = 'uip.da.queries.tabs.v1';
let tabSeq = 0; // highest query-N number ever handed out
let idSeq = 0;
let freedNums = []; // numbers of closed tabs: the next new tab reuses the smallest one

const autoNum = (name) => { const m = /^query-(\d+)\.sql$/.exec(String(name || '')); return m ? Number(m[1]) : null; };

function nextName() {
  if (freedNums.length) {
    freedNums.sort((a, b) => a - b);
    return `query-${freedNums.shift()}.sql`;
  }
  tabSeq += 1;
  return `query-${tabSeq}.sql`;
}

const BLANK = { mode: 'raw', sql: '', table: '', columns: [], where: [], groupBy: [], orderBy: [], limit: 100, result: null, savedQueryId: null };

function makeTab(name) {
  idSeq += 1;
  const n = autoNum(name);
  if (n) tabSeq = Math.max(tabSeq, n);
  return {
    id: `q${Date.now().toString(36)}${idSeq}`, name: name || nextName(),
    mode: 'raw', sql: '', table: '', columns: [], where: [], groupBy: [], orderBy: [], limit: 100,
    result: null, savedQueryId: null,
  };
}

/** Open tabs survive a reload (code only — results are re-run on demand). */
function loadTabs() {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
    if (raw && Array.isArray(raw.tabs)) {
      tabSeq = Math.max(tabSeq, Number(raw.seq) || 0);
      freedNums = Array.isArray(raw.freed) ? raw.freed.filter((n) => Number.isInteger(n) && n > 0) : [];
      const tabs = raw.tabs.map((x) => ({ ...makeTab(x.name), ...x, result: null }));
      if (!tabs.length) { tabSeq = 0; freedNums = []; return { tabs, activeId: null }; } // every tab was closed: empty screen, numbering restarts
      return { tabs, activeId: tabs.some((x) => x.id === raw.activeId) ? raw.activeId : tabs[0].id };
    }
  } catch { /* storage unavailable or corrupt — start fresh */ }
  const first = makeTab('query-1.sql');
  return { tabs: [first], activeId: first.id };
}

function isNarrow() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches;
}

function Select({ value, onChange, className = '', children, ...rest }) {
  return (
    <span className={`qb-select ${className}`}>
      <select value={value} onChange={onChange} {...rest}>{children}</select>
      <Icon name="chevron-down" size={16} className="qb-select__icon" />
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="qb-field">
      <div className="qb-field__head">
        <span className="qb-field__label">{label}</span>
        {hint && <span className="qb-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ResultCell({ value, t }) {
  if (value === null || value === undefined) return <span className="qb-null">NULL</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataAnalysisQueryBuilder() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const label = (obj) => obj?.[locale] || obj?.en || '';

  const [catalog, setCatalog] = useState({});
  const [templates, setTemplates] = useState([]);
  const [saved, setSaved] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Query "files" (tabs). The useState values below always hold the ACTIVE tab; the
  // other tabs are kept as snapshots in `tabs` and swapped in/out on switch.
  const initial = useRef(null);
  if (!initial.current) {
    const l = loadTabs();
    initial.current = { ...l, active: l.tabs.find((x) => x.id === l.activeId) || BLANK };
  }
  const [tabs, setTabs] = useState(initial.current.tabs);
  const [activeId, setActiveId] = useState(initial.current.activeId);
  const [runningIds, setRunningIds] = useState([]);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const seed = initial.current.active;

  const [mode, setMode] = useState(seed.mode); // 'raw' | 'builder'
  const [sql, setSql] = useState(seed.sql);
  const [table, setTable] = useState(seed.table);
  const [columns, setColumns] = useState(seed.columns);
  const [where, setWhere] = useState(seed.where); // [{column, op, value}]
  const [groupBy, setGroupBy] = useState(seed.groupBy);
  const [orderBy, setOrderBy] = useState(seed.orderBy); // [{column, dir}]
  const [limit, setLimit] = useState(seed.limit);

  const running = runningIds.includes(activeId);
  const [result, setResult] = useState(null); // {ok, sql, rows, columns, row_count, execution_time_ms, error}
  const [savedQueryId, setSavedQueryId] = useState(seed.savedQueryId);
  const [saveOpen, setSaveOpen] = useState(false);

  // UI-only state
  const [colQuery, setColQuery] = useState('');
  const [schemaTable, setSchemaTable] = useState('');
  const [libTab, setLibTab] = useState('templates');
  const [copied, setCopied] = useState(false);

  const workRef = useRef(null);
  const resultsRef = useRef(null);
  const taRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/data-analysis/queries')
      .then((json) => {
        setCatalog(json.data?.catalog || {});
        setTemplates(json.data?.templates || []);
        setSaved(json.data?.saved || []);
        setHistory(json.data?.history || []);
        const firstTable = Object.values(json.data?.catalog || {})[0];
        if (firstTable) {
          setTable((prev) => prev || firstTable.table);
          setSchemaTable((prev) => prev || firstTable.table);
        }
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const tables = Object.values(catalog);
  const defaultTable = tables[0]?.table || '';
  const hasTabs = tabs.length > 0;
  const completions = useMemo(() => ({
    tables: Object.values(catalog).map((c) => c.table),
    columns: Object.fromEntries(Object.values(catalog).map((c) => [c.table, c.columns || []])),
  }), [catalog]);

  const snapshot = () => ({ mode, sql, table, columns, where, groupBy, orderBy, limit, result, savedQueryId });
  const applyTab = (tb) => {
    setMode(tb.mode); setSql(tb.sql); setTable(tb.table || defaultTable); setColumns(tb.columns);
    setWhere(tb.where); setGroupBy(tb.groupBy); setOrderBy(tb.orderBy); setLimit(tb.limit);
    setResult(tb.result); setSavedQueryId(tb.savedQueryId); setColQuery('');
  };
  const focusEditor = () => requestAnimationFrame(() => taRef.current?.focus());

  function switchTab(id) {
    if (id === activeId) return;
    const target = tabs.find((x) => x.id === id);
    if (!target) return;
    setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, ...snapshot() } : x)));
    applyTab(target);
    setActiveId(id);
    setActionError(null);
    focusEditor();
  }

  function addTab(name) {
    const fresh = { ...makeTab(name), table: defaultTable };
    setTabs((prev) => [...prev.map((x) => (x.id === activeId ? { ...x, ...snapshot() } : x)), fresh]);
    applyTab(fresh);
    setActiveId(fresh.id);
    setActionError(null);
    focusEditor();
    return fresh.id;
  }

  function closeTab(id) {
    const closing = tabs.find((x) => x.id === id);
    const num = autoNum(closing?.name);
    if (num && !freedNums.includes(num)) freedNums.push(num);
    if (tabs.length === 1) { // last one closed: show the empty screen
      tabSeq = 0; freedNums = []; // nothing left open: the next new query is query-1 again
      setTabs([]); setActiveId(null); applyTab(BLANK);
      return;
    }
    const idx = tabs.findIndex((x) => x.id === id);
    const rest = tabs.filter((x) => x.id !== id);
    setTabs(rest);
    if (id === activeId) {
      const next = rest[Math.min(idx, rest.length - 1)];
      applyTab(next); setActiveId(next.id); focusEditor();
    }
  }

  function renameTab(id) {
    const cur = tabs.find((x) => x.id === id);
    const next = window.prompt(t('Rename query'), cur?.name || '');
    if (next && next.trim()) setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, name: next.trim().slice(0, 40) } : x)));
  }

  // A library item (template / saved / history) opens in a NEW tab when the current
  // one already has work in it, so loading never overwrites a query you still need.
  const isBlank = !sql.trim() && !result && columns.length === 0 && where.length === 0 && groupBy.length === 0;
  const openTargetTab = (name) => { if (!hasTabs || !isBlank) addTab(name); };

  // keep tabs across reloads (code only)
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const live = tabs.map((x) => (x.id === activeId ? { ...x, ...snapshot() } : x)).map((x) => ({ ...x, result: null }));
        localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: live, activeId, seq: tabSeq, freed: freedNums }));
      } catch { /* storage unavailable */ }
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId, mode, sql, table, columns, where, groupBy, orderBy, limit, savedQueryId]);

  const tabsProps = {
    tabs: tabs.map((x) => ({ id: x.id, name: x.name, running: runningIds.includes(x.id) })),
    activeId,
    onSelect: switchTab,
    onClose: closeTab,
    onNew: () => addTab(),
    onRename: renameTab,
    newLabel: t('New query'),
    closeLabel: t('Close'),
  };
  const tableSet = useMemo(() => new Set(Object.values(catalog).map((c) => String(c.table).toLowerCase())), [catalog]);
  const tableCols = tables.find((c) => c.table === table)?.columns || [];
  const schemaCols = tables.find((c) => c.table === schemaTable)?.columns || [];
  const visibleCols = colQuery.trim()
    ? tableCols.filter((c) => c.toLowerCase().includes(colQuery.trim().toLowerCase()))
    : tableCols;

  const previewSql = useMemo(
    () => buildPreviewSql({ table, columns, where, groupBy, orderBy, limit }),
    [table, columns, where, groupBy, orderBy, limit],
  );
  const canRun = hasTabs && (mode === 'builder' ? !!table : sql.trim() !== '');

  function toggleColumn(c) {
    setColumns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }
  function selectAllVisible() { setColumns((prev) => [...new Set([...prev, ...visibleCols])]); }

  function addWhere() { setWhere((prev) => [...prev, { column: tableCols[0] || '', op: 'eq', value: '' }]); }
  function updateWhere(i, patch) { setWhere((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w))); }
  function removeWhere(i) { setWhere((prev) => prev.filter((_, idx) => idx !== i)); }

  function addOrderBy() { setOrderBy((prev) => [...prev, { column: tableCols[0] || '', dir: 'asc' }]); }
  function updateOrderBy(i, patch) { setOrderBy((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o))); }
  function removeOrderBy(i) { setOrderBy((prev) => prev.filter((_, idx) => idx !== i)); }

  function changeTable(next) {
    setTable(next);
    setColumns([]);
    setWhere([]);
    setGroupBy([]);
    setOrderBy([]);
    setColQuery('');
  }

  function buildSpec() {
    return {
      table,
      columns,
      where: where.filter((w) => w.column && (NO_VALUE_OPS.includes(w.op) || w.value !== '')),
      group_by: groupBy,
      order_by: orderBy.filter((o) => o.column),
      limit: Number(limit) || 100,
    };
  }

  function showWorkspace() {
    if (isNarrow()) workRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleRun() {
    const runId = activeId; // the user may switch tabs while this runs
    setRunningIds((p) => [...p, runId]);
    setActionError(null);
    setResult(null);
    try {
      const payload = mode === 'builder'
        ? { mode: 'builder', spec: buildSpec(), saved_query_id: savedQueryId }
        : { mode: 'raw', sql, saved_query_id: savedQueryId };
      const json = await api.post('/api/v1/data-analysis/queries/run', payload);
      if (activeIdRef.current === runId) {
        setResult(json.data);
        if (json.data?.sql) setSql(json.data.sql);
        if (isNarrow()) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      } else {
        setTabs((prev) => prev.map((x) => (x.id === runId ? { ...x, result: json.data, sql: json.data?.sql || x.sql } : x)));
      }
      load();
    } catch (err) {
      if (activeIdRef.current === runId) setActionError(errorMessage(err));
      else setTabs((prev) => prev.map((x) => (x.id === runId ? { ...x, result: { ok: false, error: errorMessage(err) } } : x)));
    } finally {
      setRunningIds((p) => p.filter((x) => x !== runId));
    }
  }

  async function handleExport(format) {
    setActionError(null);
    try {
      // The API serves csv / json natively; Excel and PDF are built from its CSV.
      const wire = format === 'json' ? 'json' : 'csv';
      const payload = mode === 'builder'
        ? { format: wire, mode: 'builder', spec: buildSpec() }
        : { format: wire, mode: 'raw', sql };
      const res = await api.post('/api/v1/data-analysis/queries/export', payload);
      if (wire === 'json') {
        const blob = res instanceof Response ? await res.blob() : new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'query_result.json');
      } else if (res instanceof Response) {
        await exportFromCsvBlob(await res.blob(), { format, filename: 'query_result', title: t('Query result'), rtl: locale === 'ar' });
      } else {
        throw new Error('The server did not return a file.');
      }
    } catch (err) {
      setActionError(t(errorMessage(err)));
    }
  }

  function loadSaved(q) {
    setActionError(null);
    api.get(`/api/v1/data-analysis/queries/saved/${q.id}`)
      .then((json) => {
        const data = json.data;
        openTargetTab(`${String(q.name || 'query').slice(0, 30)}.sql`);
        if (hasTabs && isBlank) setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, name: `${String(q.name || 'query').slice(0, 30)}.sql` } : x)));
        setSavedQueryId(data.id);
        setSql(data.sql_text || '');
        if (data.builder_state && data.builder_state.table) {
          setMode('builder');
          const spec = data.builder_state;
          setTable(spec.table || '');
          setColumns(spec.columns || []);
          setWhere(spec.where || []);
          setGroupBy(spec.group_by || []);
          setOrderBy(spec.order_by || []);
          setLimit(spec.limit || 100);
        } else {
          setMode('raw');
        }
        setResult(null);
        showWorkspace();
      })
      .catch((err) => setActionError(errorMessage(err)));
  }

  function loadSql(text) {
    openTargetTab();
    setMode('raw');
    setSql(text || '');
    setSavedQueryId(null);
    showWorkspace();
  }

  function deleteSaved(id) {
    if (!confirm(t('Delete'))) return;
    api.del(`/api/v1/data-analysis/queries/saved/${id}`)
      .then(() => load())
      .catch((err) => setActionError(errorMessage(err)));
  }

  function insertAtCursor(text) {
    const el = taRef.current;
    if (!el) { setSql((p) => `${p}${text}`); return; }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? start;
    const before = sql.slice(0, start);
    const lead = before && !/[\s(,]$/.test(before) ? ' ' : '';
    const insert = `${lead}${text}`;
    setSql(`${before}${insert}${sql.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(previewSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — ignore */ }
  }

  const actions = () => (
    <>
      <button type="button" className="btn btn-outline" disabled={!canRun} aria-label={t('Save Query')} onClick={() => setSaveOpen(true)}>
        <Icon name="bookmark" size={16} />
        <span className="qb-btn-label">{t('Save Query')}</span>
      </button>
      <ExportMenu onExport={handleExport} disabled={!canRun} />
      <button type="button" className={`btn btn-primary qb-run${running ? ' is-loading' : ''}`} disabled={running || !canRun} onClick={handleRun}>
        <Icon name="play" size={16} />
        <span className="qb-btn-label">{t('Run')}</span>
      </button>
    </>
  );

  const resultColumns = result?.columns?.length ? result.columns : Object.keys(result?.rows?.[0] || {});

  return (
    <>
      <header className="page-header animate-rise-in">
        <div className="page-header__title">
          <h1 className="text-h1">{t('SQL Query Builder')}</h1>
          <p className="text-small">{t("Build SELECT queries visually or write raw SQL, restricted to the platform's allow-listed core datasets.")}</p>
        </div>
        <ul className="qb-guard" aria-label={t('Read-only')}>
          <li><Icon name="lock" size={14} /> {t('Read-only')}</li>
          <li><Icon name="shield" size={14} /> {t('SELECT only')}</li>
          <li><Icon name="layers" size={14} /> {t('Max 500 rows per run')}</li>
        </ul>
      </header>

      {actionError && (
        <div className="qb-alert" role="alert">
          <Icon name="alert-triangle" size={18} />
          <span>{actionError}</span>
          <button type="button" className="qb-icon-btn" style={{ width: 28, height: 28 }} aria-label={t('Dismiss')} onClick={() => setActionError(null)}><Icon name="x" size={14} /></button>
        </div>
      )}

      {loading && (
        <div className="qb" aria-busy="true" aria-label={t('Loading query builder')}>
          <div className="qb__main">
            <div className="qb-panel glass-panel" style={{ padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}>
              <span className="qb-skel" style={{ height: 40, width: '45%' }} />
              <span className="qb-skel" style={{ height: 160 }} />
              <span className="qb-skel" style={{ height: 44, width: '100%' }} />
            </div>
          </div>
          <div className="qb__aside"><div className="qb-panel glass-panel" style={{ padding: 'var(--space-5)' }}><span className="qb-skel" style={{ height: 220 }} /></div></div>
        </div>
      )}

      {error && (
        <div className="qb-panel glass-panel qb-state qb-state--error" role="alert">
          <span className="qb-state__icon"><Icon name="alert-triangle" size={24} /></span>
          <h3>{t('Query failed')}</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={load}><Icon name="refresh" size={14} /> {t('Try again')}</button>
        </div>
      )}

      {!loading && !error && (
        <div className="qb">
          <div className="qb__main">
            {/* ---------------- Workspace ---------------- */}
            <section className="qb-panel glass-panel" ref={workRef}>
              <div className="qb-bar">
                <div className="qb-seg" role="tablist" aria-label={t('Compose')}>
                  <button type="button" role="tab" aria-selected={mode === 'raw'} onClick={() => setMode('raw')}><Icon name="terminal" size={15} /> {t('SQL Editor')}</button>
                  <button type="button" role="tab" aria-selected={mode === 'builder'} onClick={() => setMode('builder')}><Icon name="grid" size={15} /> {t('Visual Builder')}</button>
                </div>
                <div className="qb-actions qb-actions--top">{actions(false)}</div>
              </div>

              <div className="qb-body">
                {!hasTabs && (
                  <EmptyEditor
                    tabsProps={tabsProps}
                    title={t('No open queries')}
                    hint={t('Click + or the button below to start a new query.')}
                    buttonLabel={t('New query')}
                    extra={t('You can also open a template, a saved query or a previous run from the library.')}
                  />
                )}

                {hasTabs && mode === 'raw' && (
                  <>
                    <SqlEditor
                      key={activeId}
                      ref={taRef}
                      value={sql}
                      onChange={setSql}
                      onRun={() => { if (canRun && !running) handleRun(); }}
                      tables={tableSet}
                      ariaLabel={t('SQL Editor')}
                      linesLabel={t('lines')}
                      runLabel={t('to run')}
                      placeholder={`SELECT * FROM ${schemaTable || 'projects'} LIMIT 50;`}
                      tabsProps={tabsProps}
                      completions={completions}
                      completeLabel={t('to complete')}
                    />

                    {tables.length > 0 && (
                      <details className="qb-schema">
                        <summary>
                          <Icon name="layers" size={16} /> {t('Tables & Columns')}
                          <Icon name="chevron-down" size={16} className="qb-schema__caret" />
                        </summary>
                        <div className="qb-schema__body">
                          <div className="qb-chips" role="group" aria-label={t('Table')}>
                            {tables.map((c) => (
                              <button key={c.key} type="button" className={`qb-chip${schemaTable === c.table ? ' is-on' : ''}`} aria-pressed={schemaTable === c.table} onClick={() => setSchemaTable(c.table)}>
                                {c.table}
                              </button>
                            ))}
                          </div>
                          <span className="qb-field__hint">{t('Click to insert at the cursor')}</span>
                          <div className="qb-chips">
                            <button type="button" className="qb-chip is-on" onClick={() => insertAtCursor(schemaTable)}>{schemaTable}</button>
                            {schemaCols.map((c) => (
                              <button key={c} type="button" className="qb-chip" onClick={() => insertAtCursor(c)}>{c}</button>
                            ))}
                          </div>
                        </div>
                      </details>
                    )}
                  </>
                )}

                {hasTabs && mode === 'builder' && (
                  <div className="qb-stack">
                    <div className="qb-vsc qb-vsc--tabsonly" dir="ltr">
                      <div className="qb-vsc__tabs"><QueryTabs {...tabsProps} /></div>
                    </div>
                    <Field label={t('Base table')} hint={tableCols.length ? `${tableCols.length} ${t('columns')}` : null}>
                      <Select value={table} onChange={(e) => changeTable(e.target.value)} aria-label={t('Base table')}>
                        {tables.map((c) => <option key={c.key} value={c.table}>{label(c.label)}</option>)}
                      </Select>
                    </Field>

                    <Field label={t('Columns')} hint={columns.length ? `${columns.length} ${t('selected')}` : t('Leave empty to select all')}>
                      {(tableCols.length > COLUMN_FILTER_THRESHOLD || columns.length > 0) && (
                        <div className="qb-tools">
                          {tableCols.length > COLUMN_FILTER_THRESHOLD && (
                            <div className="qb-search">
                              <Icon name="search" size={16} />
                              <input className="qb-input" type="search" value={colQuery} onChange={(e) => setColQuery(e.target.value)} placeholder={t('Filter columns')} aria-label={t('Filter columns')} />
                            </div>
                          )}
                          <button type="button" className="qb-link" onClick={selectAllVisible}>{t('Select all')}</button>
                          {columns.length > 0 && <button type="button" className="qb-link" onClick={() => setColumns([])}>{t('Clear')}</button>}
                        </div>
                      )}
                      <div className="qb-chips" role="group" aria-label={t('Columns')}>
                        {visibleCols.map((c) => (
                          <label key={c} className="qb-chip">
                            <input type="checkbox" checked={columns.includes(c)} onChange={() => toggleColumn(c)} />
                            <span>{columns.includes(c) && <Icon name="check" size={12} />}{c}</span>
                          </label>
                        ))}
                        {visibleCols.length === 0 && <p className="qb-empty-note">{t('No columns match.')}</p>}
                      </div>
                    </Field>

                    <Field label={t('Filter rows')} hint={where.length > 1 ? t('Rows must match every condition') : null}>
                      {where.length > 0 && (
                        <div className="qb-rows">
                          {where.map((w, i) => {
                            const noVal = NO_VALUE_OPS.includes(w.op);
                            return (
                              <div key={i} className={`qb-row qb-row--where${noVal ? ' is-noval' : ''}`}>
                                <Select value={w.column} onChange={(e) => updateWhere(i, { column: e.target.value })} aria-label={t('Columns')}>
                                  {tableCols.map((c) => <option key={c} value={c}>{c}</option>)}
                                </Select>
                                <Select value={w.op} onChange={(e) => updateWhere(i, { op: e.target.value })} aria-label={t('Where')}>
                                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </Select>
                                {!noVal && <input className="qb-input" value={w.value} onChange={(e) => updateWhere(i, { value: e.target.value })} placeholder={t('Value')} aria-label={t('Value')} />}
                                <button type="button" className="qb-icon-btn qb-icon-btn--danger" aria-label={t('Delete')} onClick={() => removeWhere(i)}><Icon name="trash" size={16} /></button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <button type="button" className="qb-add" onClick={addWhere}><Icon name="plus" size={16} /> {t('Add filter')}</button>
                    </Field>

                    <Field label={t('Group results by')}>
                      {groupBy.length > 0 && (
                        <div className="qb-chips">
                          {groupBy.map((c) => (
                            <button key={c} type="button" className="qb-chip qb-chip--removable is-on" aria-label={`${t('Delete')} ${c}`} onClick={() => setGroupBy((p) => p.filter((x) => x !== c))}>
                              {c} <Icon name="x" size={12} />
                            </button>
                          ))}
                        </div>
                      )}
                      <Select value="" onChange={(e) => { const v = e.target.value; if (v) setGroupBy((p) => [...p, v]); }} aria-label={t('Add column')}>
                        <option value="">{t('Add column')}…</option>
                        {tableCols.filter((c) => !groupBy.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </Field>

                    <Field label={t('Sort by')}>
                      {orderBy.length > 0 && (
                        <div className="qb-rows">
                          {orderBy.map((o, i) => (
                            <div key={i} className="qb-row qb-row--sort">
                              <Select value={o.column} onChange={(e) => updateOrderBy(i, { column: e.target.value })} aria-label={t('Sort by')}>
                                {tableCols.map((c) => <option key={c} value={c}>{c}</option>)}
                              </Select>
                              <div className="qb-seg qb-seg--sm" role="group" aria-label={t('Sort by')}>
                                <button type="button" aria-pressed={o.dir === 'asc'} onClick={() => updateOrderBy(i, { dir: 'asc' })} title={t('Ascending')}>ASC</button>
                                <button type="button" aria-pressed={o.dir === 'desc'} onClick={() => updateOrderBy(i, { dir: 'desc' })} title={t('Descending')}>DESC</button>
                              </div>
                              <button type="button" className="qb-icon-btn qb-icon-btn--danger" aria-label={t('Delete')} onClick={() => removeOrderBy(i)}><Icon name="trash" size={16} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button type="button" className="qb-add" onClick={addOrderBy}><Icon name="plus" size={16} /> {t('Add sort')}</button>
                    </Field>

                    <Field label={t('Rows to return')} hint={t('Max 500 rows per run')}>
                      <div className="qb-limit">
                        <input className="qb-input" type="number" inputMode="numeric" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label={t('Row limit')} />
                        <div className="qb-chips">
                          {LIMIT_PRESETS.map((n) => (
                            <button key={n} type="button" className={`qb-chip${Number(limit) === n ? ' is-on' : ''}`} aria-pressed={Number(limit) === n} onClick={() => setLimit(n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                    </Field>

                    <div>
                      <div className="qb-code">
                        <div className="qb-code__head">
                          <span>{t('Generated SQL')}</span>
                          <div>
                            <button type="button" className="qb-code__btn" onClick={copyPreview} disabled={!previewSql}>
                              <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? t('Copied') : t('Copy')}
                            </button>
                            <button type="button" className="qb-code__btn" disabled={!previewSql} onClick={() => loadSql(previewSql)}>
                              <Icon name="edit" size={14} /> {t('Edit as SQL')}
                            </button>
                          </div>
                        </div>
                        <pre dir="ltr"><code><SqlCode sql={previewSql || '-- '} /></code></pre>
                      </div>
                      <p className="qb-field__hint" style={{ marginTop: 'var(--space-2)' }}>{t('Updates as you build. The server validates it on run.')}</p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="qb-dock">{actions(true)}</div>

            {/* ---------------- Results ---------------- */}
            <section className="qb-panel glass-panel qb-results" ref={resultsRef} aria-live="polite">
              <div className="qb-results__head">
                <h2 className="text-h3">{t('Results')}</h2>
                {result?.ok && (
                  <div className="qb-stats">
                    <span className="qb-stat"><Icon name="layers" size={13} /> {result.row_count} {t('rows')}</span>
                    <span className="qb-stat"><Icon name="grid" size={13} /> {resultColumns.length} {t('columns')}</span>
                    <span className="qb-stat"><Icon name="clock" size={13} /> {result.execution_time_ms} ms</span>
                  </div>
                )}
              </div>

              {running && (
                <div className="qb-results__body" aria-busy="true">
                  <span className="qb-skel" style={{ height: 38 }} />
                  {[0, 1, 2, 3, 4].map((i) => <span key={i} className="qb-skel" style={{ height: 30, opacity: 1 - i * 0.15 }} />)}
                </div>
              )}

              {!running && !result && (
                <div className="qb-state">
                  <span className="qb-state__icon"><Icon name="bar-chart" size={24} /></span>
                  <h3>{t('Run a query to see results here.')}</h3>
                  <p>{t('Results will appear here with row count and run time.')}</p>
                </div>
              )}

              {!running && result && !result.ok && (
                <div className="qb-state qb-state--error" role="alert">
                  <span className="qb-state__icon"><Icon name="alert-triangle" size={24} /></span>
                  <h3>{t('Query failed')}</h3>
                  <pre dir="ltr">{result.error}</pre>
                </div>
              )}

              {!running && result?.ok && (
                <div className="qb-results__body">
                  {result.sql && (
                    <details className="qb-sqlpeek">
                      <summary>{t('Preview generated SQL')}</summary>
                      <div className="qb-code" style={{ marginTop: 'var(--space-2)' }}>
                        <pre dir="ltr"><code><SqlCode sql={result.sql} tables={tableSet} /></code></pre>
                      </div>
                    </details>
                  )}
                  {(result.rows || []).length === 0 ? (
                    <div className="qb-state" style={{ padding: 'var(--space-6) var(--space-4)' }}>
                      <span className="qb-state__icon"><Icon name="inbox" size={24} /></span>
                      <h3>0 {t('rows')}</h3>
                    </div>
                  ) : (
                    <div className="qb-table-wrap" tabIndex={0} role="region" aria-label={t('Results')}>
                      <table className="qb-table">
                        <thead>
                          <tr>
                            <th className="qb-idx">#</th>
                            {resultColumns.map((c) => <th key={c}>{c}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>
                              <td className="qb-idx">{i + 1}</td>
                              {resultColumns.map((c) => {
                                const v = row[c];
                                const text = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                                return (
                                  <td key={c} className={typeof v === 'number' ? 'is-num' : undefined} title={text || undefined}>
                                    <ResultCell value={v} t={t} />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ---------------- Library rail ---------------- */}
          <aside className="qb__aside">
            <section className="qb-panel glass-panel">
              <div className="qb-lib__head">
                <h2 className="text-h3">{t('Library')}</h2>
                <div className="qb-seg" role="tablist" aria-label={t('Library')}>
                  <button type="button" role="tab" aria-selected={libTab === 'templates'} onClick={() => setLibTab('templates')}>{t('Templates')} <span className="qb-count">{templates.length}</span></button>
                  <button type="button" role="tab" aria-selected={libTab === 'saved'} onClick={() => setLibTab('saved')}>{t('Saved')} <span className="qb-count">{saved.length}</span></button>
                  <button type="button" role="tab" aria-selected={libTab === 'history'} onClick={() => setLibTab('history')}>{t('History')} <span className="qb-count">{history.length}</span></button>
                </div>
              </div>

              <div className="qb-lib__list" role="tabpanel">
                {libTab === 'templates' && (
                  templates.length === 0
                    ? <p className="qb-lib__empty">{t('No templates yet.')}</p>
                    : templates.map((tpl, i) => (
                      <button key={i} type="button" className="qb-item" onClick={() => loadSql(tpl.sql_text)} aria-label={`${t('Load into editor')}: ${(locale === 'ar' && tpl.name_ar) || tpl.name}`}>
                        <span className="qb-item__title">
                          <span>{(locale === 'ar' && tpl.name_ar) || tpl.name}</span>
                          {tpl.category ? <span className="badge badge-neutral">{tpl.category}</span> : null}
                          <Icon name="arrow-right" size={15} className="icon-flip" />
                        </span>
                        {(tpl.description || tpl.description_ar) && <span className="qb-item__desc">{(locale === 'ar' && tpl.description_ar) || tpl.description}</span>}
                      </button>
                    ))
                )}

                {libTab === 'saved' && (
                  saved.length === 0
                    ? <p className="qb-lib__empty">{t('No saved queries yet.')}<br />{t('Save a query to reuse it later.')}</p>
                    : saved.map((q) => (
                      <div key={q.id} className="qb-item">
                        <span className="qb-item__title">
                          <span>{q.name}</span>
                          {Number(q.is_shared) ? <span className="badge badge-neutral">{t('shared')}</span> : null}
                        </span>
                        {q.description && <span className="qb-item__desc">{q.description}</span>}
                        <span className="qb-item__actions">
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => loadSaved(q)}>{t('Load into editor')}</button>
                          <button type="button" className="qb-icon-btn qb-icon-btn--danger" style={{ width: 34, height: 34 }} aria-label={`${t('Delete')} ${q.name}`} onClick={() => deleteSaved(q.id)}><Icon name="trash" size={15} /></button>
                        </span>
                      </div>
                    ))
                )}

                {libTab === 'history' && (
                  history.length === 0
                    ? <p className="qb-lib__empty">{t('No runs yet.')}<br />{t('Runs appear here after you execute a query.')}</p>
                    : history.map((h, i) => (
                      <button key={i} type="button" className="qb-item" onClick={() => loadSql(h.sql_text)} aria-label={t('Load into editor')}>
                        <span className="qb-item__title">
                          <span className={`qb-status${h.status === 'success' ? '' : ' is-error'}`}>{h.status === 'success' ? t('success') : t('error')}</span>
                          <span className="qb-item__meta" style={{ flex: 1 }}>
                            {[h.row_count != null ? `${h.row_count} ${t('rows')}` : null, h.execution_time_ms != null ? `${h.execution_time_ms} ms` : null, (h.executed_at || h.created_at) ? String(h.executed_at || h.created_at).slice(0, 16).replace('T', ' ') : null].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="qb-item__sql" dir="ltr">{h.sql_text}</span>
                        {h.error_message && <span className="qb-item__error" dir="ltr">{String(h.error_message).replace(/\s*\(Conn.*$/s, '')}</span>}
                      </button>
                    ))
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {saveOpen && (
        <SaveQueryModal
          sql={mode === 'builder' ? (result?.sql || previewSql) : sql}
          builderState={mode === 'builder' ? buildSpec() : null}
          datasetKey={tables.find((c) => c.table === table)?.key || null}
          onClose={() => setSaveOpen(false)}
          onDone={(err) => { setSaveOpen(false); if (err) setActionError(err); else load(); }}
        />
      )}
    </>
  );
}

function SaveQueryModal({ sql, builderState, datasetKey, onClose, onDone }) {
  const t = useTranslations(translations);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/v1/data-analysis/queries/save', {
        name,
        sql,
        description: description || null,
        builder_state: builderState,
        dataset_key: datasetKey,
        is_shared: isShared,
      });
      onDone(null);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box qb-modal-box card glass-panel qb-modal" role="dialog" aria-modal="true" aria-labelledby="qb-save-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-box__title text-h3" id="qb-save-title">{t('Save Query')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="qb-field">
            <label className="qb-field__label" htmlFor="qb_name">{t('Name')}</label>
            <input id="qb_name" ref={nameRef} className="qb-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="qb-field">
            <label className="qb-field__label" htmlFor="qb_desc">{t('Description (optional)')}</label>
            <textarea id="qb_desc" className="qb-input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="qb-check" htmlFor="q_shared">
            <input type="checkbox" id="q_shared" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
            {t('Share with other data analysts')}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal-box__actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className={`btn btn-primary${saving ? ' is-loading' : ''}`} disabled={saving}>{t('Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
