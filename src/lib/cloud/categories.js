/**
 * Where a file goes inside the cloud backup folder ("UIP-NUB"): one sub-folder per KIND of file, not a copy of the My PC tree.
 *   UIP-NUB / Code / main.py   ·   UIP-NUB / Documents / report.docx   ·   UIP-NUB / Images / photo.png …
 */
export const BACKUP_ROOT = 'UIP-NUB';
/** Bump when the folder layout changes: the saved ids / signatures are dropped once so every file is copied into the new layout. */
export const BACKUP_LAYOUT = 2;

const ext = (name) => { const m = /\.([^.\\/]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
const set = (s) => new Set(s.split(/\s+/).filter(Boolean));

const KINDS = [
  ['Documents', set('doc docx dot dotx odt rtf txt md markdown tex pages')],
  ['PDF', set('pdf')],
  ['Spreadsheets', set('xls xlsx xlsm xlsb ods csv tsv')],
  ['Presentations', set('ppt pptx pps ppsx odp key sb3')],
  ['Images', set('png jpg jpeg gif webp bmp svg ico tif tiff heic heif avif psd ai')],
  ['Videos', set('mp4 mov avi mkv webm m4v wmv flv ogv 3gp')],
  ['Audio', set('mp3 wav ogg m4a aac flac wma opus')],
  ['Archives', set('zip rar 7z tar gz tgz bz2 xz jar war')],
  ['Data', set('json jsonl ndjson xml yml yaml toml ini env sql db sqlite log geojson ipynb')],
  ['Code', set('js jsx mjs cjs ts tsx vue py java c h cpp hpp cc cs php rb go rs kt swift dart lua pl r jl hs f90 pas m mm vb scala ex exs erl fs fsx ml clj lisp lsp cob cbl asm nasm dpr bas cls frm ps1 sol abap sas plsql pls tsql pro adb ads v zig groovy sh bash bat cmd html htm css scss less')],
];
const BY_EXT = new Map();
KINDS.forEach(([label, exts]) => exts.forEach((e) => { if (!BY_EXT.has(e)) BY_EXT.set(e, label); }));

/** Folder name (also its stable key) for a file name. */
export const categoryOf = (name) => BY_EXT.get(ext(name)) || 'Other';
