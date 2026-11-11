/**
 * Phones + tablets: wide tables turn into stacks of cards instead of a clipped / sideways-scrolling table
 * (iOS hides the scrollbar, so the hidden columns were simply invisible). To keep every table untouched, the
 * column header text is copied into a `data-label` on each cell and the table is flagged with `data-rt`
 * (styles/css/responsive-tables.css and admin-pages.css read these). Re-runs whenever rows re-render.
 *
 * A table is flagged when it has 4+ columns and a plain one-row header. Matrix / heat-map / pivot tables
 * (class adm-matrix, or inside .table-responsive) keep scrolling sideways because rows AND columns carry
 * meaning there. Add data-no-cards to any <table> to opt out.
 */
const TABLE_SELECTOR = 'table.adm-table, table.data-table, table.sec-table, table.st-table, table.ex-table, table.qb-table, table.sa-table, table.pol-table';

function labelTable(table) {
  const headRows = table.querySelectorAll('thead tr');
  const headCells = Array.from(table.querySelectorAll('thead th'));
  const heads = headCells.map((th) => th.textContent.trim());
  table.querySelectorAll('tbody tr').forEach((tr) => {
    Array.from(tr.children).forEach((td, i) => {
      if (td.colSpan > 1) { td.classList.add('ap-span'); return; }
      if (heads[i]) td.setAttribute('data-label', heads[i]); else td.classList.add('ap-nolabel');
    });
    // Icon-only action buttons become square; buttons with a label (icon + text) keep their natural width.
    // (CSS alone can't tell: :has(> svg:only-child) ignores text nodes, so "icon + label" buttons matched too.)
    tr.querySelectorAll('.adm-actions .btn, .col-actions .btn').forEach((b) => {
      b.classList.toggle('btn--icon', !b.textContent.trim() && !!b.querySelector('svg'));
    });
  });

  const simpleHead = headRows.length === 1 && headCells.every((th) => th.colSpan <= 1 && th.rowSpan <= 1);
  const optedOut = table.hasAttribute('data-no-cards') || table.classList.contains('adm-matrix')
    || (table.parentElement && table.parentElement.classList.contains('table-responsive') && !table.classList.contains('data-table--cards'));
  const wide = headCells.length >= 4;
  const on = simpleHead && wide && !optedOut;
  if (on) {
    if (!table.hasAttribute('data-rt')) table.setAttribute('data-rt', '');
    const wrap = table.parentElement;
    if (wrap && wrap.children.length === 1 && !wrap.classList.contains('app-shell__main')) wrap.classList.add('rt-wrap');
    fitTable(table);
  } else if (table.hasAttribute('data-cards')) {
    setCards(table, false);
  }
}

const PHONE_MAX = 900;   // <= this viewport width: always cards (same as before)
const HYSTERESIS = 24;   // px of extra room needed before going back to a table (avoids flip-flopping at the edge)

function setCards(table, on) {
  if (on) table.setAttribute('data-cards', ''); else table.removeAttribute('data-cards');
  const wrap = table.parentElement;
  if (wrap && wrap.classList.contains('rt-wrap')) wrap.classList.toggle('rt-cards', on);
}

/** Cards when the table's narrowest possible layout is wider than the box it lives in (or on phones/small tablets). */
function fitTable(table) {
  const wasCards = table.hasAttribute('data-cards');
  if (window.innerWidth <= PHONE_MAX) { if (!wasCards) setCards(table, true); return; }
  // Measure in table mode, synchronously (no paint in between): the table's min-content width vs the room it has.
  if (wasCards) setCards(table, false);
  const wrap = table.parentElement;
  const room = wrap ? wrap.clientWidth : table.clientWidth;
  // (some table styles set min-width:100%, which would hide the real minimum — clear it for the measurement)
  const prevW = table.style.width;
  const prevMin = table.style.minWidth;
  table.style.width = 'min-content';
  table.style.minWidth = '0';
  const need = table.offsetWidth;
  table.style.width = prevW;
  table.style.minWidth = prevMin;
  const fits = wasCards ? room >= need + HYSTERESIS : room >= need;
  if (!fits) setCards(table, true);
}

export function labelTables(root) {
  root.querySelectorAll(TABLE_SELECTOR).forEach(labelTable);
}

/** Label now and keep labelling; returns a cleanup function. Also re-fits tables when the box is resized. */
export function observeTables(root) {
  labelTables(root);
  let raf = 0;
  let timer = 0;
  const run = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => labelTables(root));
  };
  // DOM changes (not resizes) are debounced, and ignored on the chat pages, which have no data tables but mutate the DOM
  // all the time (upload rings, video controls, 4 s polling): re-scanning the whole page on each of those made the app crawl.
  const later = () => {
    if (document.body.classList.contains('msg-page-active')) return;
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  };
  const mo = new MutationObserver(later);
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  // Width changes (window resize, sidebar opening/collapsing) don't touch the DOM, so watch the box itself.
  let lastW = root.clientWidth;
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { const w = root.clientWidth; if (w !== lastW) { lastW = w; run(); } })
    : null;
  if (ro) ro.observe(root);
  window.addEventListener('resize', run);
  return () => { mo.disconnect(); if (ro) ro.disconnect(); window.removeEventListener('resize', run); cancelAnimationFrame(raf); clearTimeout(timer); };
}
