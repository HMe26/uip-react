/**
 * "New file" factory — creates a brand-new file of (almost) any type from nothing, so the user never needs to own a file first.
 *   NEW_TYPES                      -> the catalogue shown by <NewFileDialog> (Word, Excel, PowerPoint, PDF, CSV, Markdown, image, code…)
 *   createFile({ type, template, name, locale }) -> Promise<File>   (the bytes + a clean file name with the right extension)
 *   withExt(name, ext)             -> "Report" -> "Report.docx"
 * Word / Excel / PowerPoint / PDF / PNG are real binary files built in the browser (libraries load on demand);
 * everything else is plain text. The result opens straight in the existing viewer / editors (FileViewer, code editor).
 */
import { buildPptx } from './newPptx';


const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', png: 'image/png', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', txt: 'text/plain',
  sb3: 'application/x.scratch.sb3', json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', xml: 'application/xml',
};

const L = (en, ar) => ({ en, ar });

/** Starter templates per type: `id` is passed to createFile; the first one is the blank file. */
export const NEW_TYPES = [
  { id: 'docx', ext: 'docx', group: 'office', color: '#2b6cdf', label: L('Word document', 'مستند Word'), hint: L('Letters, reports, CVs', 'خطابات، تقارير، سيرة ذاتية'),
    templates: [{ id: 'blank', label: L('Blank document', 'مستند فارغ') }, { id: 'report', label: L('Report', 'تقرير') }, { id: 'letter', label: L('Letter', 'خطاب رسمي') }, { id: 'minutes', label: L('Meeting minutes', 'محضر اجتماع') }] },
  { id: 'xlsx', ext: 'xlsx', group: 'office', color: '#16a34a', label: L('Excel workbook', 'جدول Excel'), hint: L('Tables, lists, grades', 'جداول، قوائم، درجات'),
    templates: [{ id: 'blank', label: L('Blank workbook', 'جدول فارغ') }, { id: 'tasks', label: L('Task tracker', 'متابعة مهام') }, { id: 'attendance', label: L('Attendance sheet', 'كشف حضور') }, { id: 'grades', label: L('Grades sheet', 'كشف درجات') }] },
  { id: 'pptx', ext: 'pptx', group: 'office', color: '#ea580c', label: L('PowerPoint presentation', 'عرض PowerPoint'), hint: L('Slides for a talk or a project', 'شرائح لعرض أو مشروع'),
    templates: [{ id: 'blank', label: L('Title slide only', 'شريحة عنوان فقط') }, { id: 'outline', label: L('Presentation outline (5 slides)', 'هيكل عرض (٥ شرائح)') }, { id: 'empty', label: L('Empty slide', 'شريحة فاضية') }] },
  { id: 'pdf', ext: 'pdf', group: 'office', color: '#e5484d', label: L('PDF document', 'ملف PDF'), hint: L('Blank pages you can annotate / fill', 'صفحات فاضية تكتب وترسم عليها'),
    templates: [{ id: 'blank', label: L('Blank A4 page', 'صفحة A4 فارغة') }, { id: 'landscape', label: L('Blank A4 landscape', 'صفحة A4 أفقية') }, { id: 'lined', label: L('Lined paper (A4)', 'ورقة مسطّرة (A4)') }, { id: 'grid', label: L('Grid paper (A4)', 'ورقة مربعات (A4)') }] },
  { id: 'csv', ext: 'csv', group: 'data', color: '#0d9488', label: L('CSV table', 'جدول CSV'), hint: L('Plain table for data tools', 'جدول بسيط لأدوات البيانات'), templates: [{ id: 'blank', label: L('Empty table', 'جدول فارغ') }] },
  { id: 'tsv', ext: 'tsv', group: 'data', color: '#0d9488', label: L('TSV table', 'جدول TSV'), hint: L('Tab-separated table', 'جدول مفصول بـ Tab'), templates: [{ id: 'blank', label: L('Empty table', 'جدول فارغ') }] },
  { id: 'json', ext: 'json', group: 'data', color: '#ca8a04', label: L('JSON data', 'بيانات JSON'), hint: L('Structured data', 'بيانات منظّمة'), templates: [{ id: 'blank', label: L('Empty object', 'كائن فارغ') }, { id: 'list', label: L('Empty list', 'قائمة فارغة') }] },
  { id: 'md', ext: 'md', group: 'text', color: '#64748b', label: L('Markdown note', 'ملاحظة Markdown'), hint: L('Notes, README, docs', 'ملاحظات، README، توثيق'), templates: [{ id: 'blank', label: L('Heading only', 'عنوان فقط') }, { id: 'readme', label: L('README', 'README') }] },
  { id: 'txt', ext: 'txt', group: 'text', color: '#64748b', label: L('Text file', 'ملف نصي'), hint: L('Plain text', 'نص عادي'), templates: [{ id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'png', ext: 'png', group: 'image', color: '#8b5cf6', label: L('Image (PNG)', 'صورة (PNG)'), hint: L('Blank canvas to draw on', 'لوحة فاضية ترسم عليها'),
    templates: [{ id: 'white', label: L('White canvas 1280×720', 'لوحة بيضاء ١٢٨٠×٧٢٠') }, { id: 'square', label: L('White square 1024×1024', 'مربع أبيض ١٠٢٤×١٠٢٤') }, { id: 'transparent', label: L('Transparent 1280×720', 'شفافة ١٢٨٠×٧٢٠') }, { id: 'dark', label: L('Dark canvas 1280×720', 'لوحة داكنة ١٢٨٠×٧٢٠') }] },
  { id: 'html', ext: 'html', group: 'code', color: '#e34c26', label: L('HTML page', 'صفحة HTML'), hint: L('A starter web page', 'صفحة ويب جاهزة للبدء'), templates: [{ id: 'blank', label: L('Starter page', 'صفحة بداية') }] },
  { id: 'css', ext: 'css', group: 'code', color: '#2563eb', label: L('CSS stylesheet', 'ملف CSS'), hint: L('Styles', 'تنسيقات'), templates: [{ id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'js', ext: 'js', group: 'code', color: '#eab308', label: L('JavaScript', 'JavaScript'), hint: L('Script', 'سكربت'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'py', ext: 'py', group: 'code', color: '#3b82f6', label: L('Python', 'Python'), hint: L('Script', 'سكربت'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'c', ext: 'c', group: 'code', color: '#5b9bd5', label: L('C', 'C'), hint: L('C program', 'C program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'cpp', ext: 'cpp', group: 'code', color: '#00599c', label: L('C++', 'C++'), hint: L('C++ program', 'C++ program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'java', ext: 'java', group: 'code', color: '#e76f00', label: L('Java', 'Java'), hint: L('Java program', 'Java program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'cs', ext: 'cs', group: 'code', color: '#8e44ad', label: L('C#', 'C#'), hint: L('C# program', 'C# program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'go', ext: 'go', group: 'code', color: '#00add8', label: L('Go', 'Go'), hint: L('Go program', 'Go program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'rs', ext: 'rs', group: 'code', color: '#dea584', label: L('Rust', 'Rust'), hint: L('Rust program', 'Rust program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'php', ext: 'php', group: 'code', color: '#8892bf', label: L('PHP', 'PHP'), hint: L('PHP script', 'PHP script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'rb', ext: 'rb', group: 'code', color: '#cc342d', label: L('Ruby', 'Ruby'), hint: L('Ruby script', 'Ruby script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'ts', ext: 'ts', group: 'code', color: '#3b82f6', label: L('TypeScript', 'TypeScript'), hint: L('TypeScript script', 'TypeScript script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'kt', ext: 'kt', group: 'code', color: '#a97bff', label: L('Kotlin', 'Kotlin'), hint: L('Kotlin program', 'Kotlin program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'dart', ext: 'dart', group: 'code', color: '#00b4ab', label: L('Dart', 'Dart'), hint: L('Dart program', 'Dart program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'lua', ext: 'lua', group: 'code', color: '#000080', label: L('Lua', 'Lua'), hint: L('Lua script', 'Lua script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'pl', ext: 'pl', group: 'code', color: '#39457e', label: L('Perl', 'Perl'), hint: L('Perl script', 'Perl script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'r', ext: 'r', group: 'code', color: '#276dc3', label: L('R', 'R'), hint: L('R script', 'R script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'jl', ext: 'jl', group: 'code', color: '#9558b2', label: L('Julia', 'Julia'), hint: L('Julia script', 'Julia script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'sh', ext: 'sh', group: 'code', color: '#4eaa25', label: L('Bash', 'Bash'), hint: L('Shell script', 'Shell script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'sql', ext: 'sql', group: 'code', color: '#e38c00', label: L('SQL', 'SQL'), hint: L('SQL (SQLite)', 'SQL (SQLite)'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'hs', ext: 'hs', group: 'code', color: '#5e5086', label: L('Haskell', 'Haskell'), hint: L('Haskell program', 'Haskell program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'f90', ext: 'f90', group: 'code', color: '#734f96', label: L('Fortran', 'Fortran'), hint: L('Fortran program', 'Fortran program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'pas', ext: 'pas', group: 'code', color: '#e3a51f', label: L('Pascal', 'Pascal'), hint: L('Pascal program', 'Pascal program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'swift', ext: 'swift', group: 'code', color: '#f05138', label: L('Swift', 'Swift'), hint: L('Swift program', 'Swift program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'matlab', ext: 'm', group: 'code', color: '#e16737', label: L('MATLAB', 'MATLAB'), hint: L('MATLAB / Octave script', 'MATLAB / Octave script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'vb', ext: 'vb', group: 'code', color: '#945db7', label: L('Visual Basic .NET', 'Visual Basic .NET'), hint: L('VB.NET program', 'VB.NET program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'objc', ext: 'm', group: 'code', color: '#438eff', label: L('Objective-C', 'Objective-C'), hint: L('Objective-C program', 'Objective-C program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'scala', ext: 'scala', group: 'code', color: '#dc322f', label: L('Scala', 'Scala'), hint: L('Scala program', 'Scala program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'ex', ext: 'ex', group: 'code', color: '#6e4a7e', label: L('Elixir', 'Elixir'), hint: L('Elixir script', 'Elixir script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'erl', ext: 'erl', group: 'code', color: '#b83998', label: L('Erlang', 'Erlang'), hint: L('Erlang escript', 'Erlang escript'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'fs', ext: 'fs', group: 'code', color: '#378bba', label: L('F#', 'F#'), hint: L('F# script', 'F# script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'ml', ext: 'ml', group: 'code', color: '#ef7a08', label: L('OCaml', 'OCaml'), hint: L('OCaml program', 'OCaml program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'clj', ext: 'clj', group: 'code', color: '#5881d8', label: L('Clojure', 'Clojure'), hint: L('Clojure script', 'Clojure script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'lisp', ext: 'lisp', group: 'code', color: '#3fb68b', label: L('Lisp', 'Lisp'), hint: L('Common Lisp script', 'Common Lisp script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'cob', ext: 'cob', group: 'code', color: '#005ca5', label: L('COBOL', 'COBOL'), hint: L('COBOL program', 'COBOL program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'asm', ext: 'asm', group: 'code', color: '#6e4c13', label: L('Assembly', 'Assembly'), hint: L('Assembly (NASM x86-64)', 'Assembly (NASM x86-64)'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'dpr', ext: 'dpr', group: 'code', color: '#b22222', label: L('Delphi (Object Pascal)', 'Delphi (Object Pascal)'), hint: L('Delphi console program', 'Delphi console program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'scratch', ext: 'sb3', group: 'code', color: '#ffab19', label: L('Scratch', 'Scratch'), hint: L('Scratch 3 project', 'Scratch 3 project'), templates: [{ id: 'hello', label: L('Starter project', 'مشروع جاهز') }, { id: 'blank', label: L('Empty project', 'مشروع فارغ') }] },
  { id: 'bas', ext: 'bas', group: 'code', color: '#7a5195', label: L('Visual Basic 6', 'Visual Basic 6'), hint: L('VB6 module', 'VB6 module'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'ps1', ext: 'ps1', group: 'code', color: '#2b5797', label: L('PowerShell', 'PowerShell'), hint: L('PowerShell script', 'PowerShell script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'sol', ext: 'sol', group: 'code', color: '#6c7a89', label: L('Solidity', 'Solidity'), hint: L('Smart contract', 'Smart contract'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'cls', ext: 'cls', group: 'code', color: '#1798c1', label: L('Apex', 'Apex'), hint: L('Salesforce Apex class', 'Salesforce Apex class'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'abap', ext: 'abap', group: 'code', color: '#e8274b', label: L('ABAP', 'ABAP'), hint: L('SAP ABAP report', 'SAP ABAP report'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'sas', ext: 'sas', group: 'code', color: '#0e6cb6', label: L('SAS', 'SAS'), hint: L('SAS program', 'SAS program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'plsql', ext: 'plsql', group: 'code', color: '#f80000', label: L('PL/SQL', 'PL/SQL'), hint: L('Oracle PL/SQL block', 'Oracle PL/SQL block'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'tsql', ext: 'tsql', group: 'code', color: '#cc2927', label: L('T-SQL', 'T-SQL'), hint: L('SQL Server T-SQL', 'SQL Server T-SQL'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'pro', ext: 'pro', group: 'code', color: '#74283c', label: L('Prolog', 'Prolog'), hint: L('Prolog program', 'Prolog program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'adb', ext: 'adb', group: 'code', color: '#02a88c', label: L('Ada', 'Ada'), hint: L('Ada program', 'Ada program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'v', ext: 'v', group: 'code', color: '#5d87bf', label: L('V (Vlang)', 'V (Vlang)'), hint: L('V program', 'V program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'zig', ext: 'zig', group: 'code', color: '#f7a41d', label: L('Zig', 'Zig'), hint: L('Zig program', 'Zig program'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
  { id: 'groovy', ext: 'groovy', group: 'code', color: '#4298b8', label: L('Groovy', 'Groovy'), hint: L('Groovy script', 'Groovy script'), templates: [{ id: 'hello', label: L('Starter program', 'برنامج جاهز') }, { id: 'blank', label: L('Empty', 'فارغ') }] },
];
export const NEW_GROUPS = [
  { id: 'office', label: L('Office & PDF', 'مستندات و PDF') }, { id: 'data', label: L('Data', 'بيانات') }, { id: 'text', label: L('Text', 'نصوص') },
  { id: 'image', label: L('Image', 'صور') }, { id: 'code', label: L('Code', 'أكواد') },
];

export const typeById = (id) => NEW_TYPES.find((t) => t.id === id);
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const bad = /[\\/:*?"<>|]+/g;
export const cleanName = (n) => String(n || '').replace(bad, ' ').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
/** "Report" + docx -> "Report.docx"; an already-correct extension is kept. */
export function withExt(name, ext) {
  const base = cleanName(name) || 'Untitled';
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base.replace(/\.[a-z0-9]{1,5}$/i, (m) => (NEW_TYPES.some((t) => t.ext === m.slice(1).toLowerCase()) ? '' : m))}.${ext}`;
}
export const defaultName = (type, locale) => {
  const t = typeById(type); const ar = locale === 'ar';
  const base = { docx: ['Document', 'مستند'], xlsx: ['Workbook', 'جدول'], pptx: ['Presentation', 'عرض تقديمي'], pdf: ['Document', 'ملف'], png: ['Image', 'صورة'], csv: ['Table', 'جدول'], tsv: ['Table', 'جدول'], md: ['Note', 'ملاحظة'], txt: ['Untitled', 'بدون عنوان'], json: ['data', 'data'], html: ['index', 'index'], css: ['style', 'style'], js: ['script', 'script'], py: ['main', 'main'], java: ['Main', 'Main'], scratch: ['project', 'project'] }[type] || (t?.group === 'code' ? ['main', 'main'] : ['Untitled', 'بدون عنوان']);
  return `${base[ar ? 1 : 0]}.${t?.ext || type}`;
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = (locale) => new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

/* ------------------------------------------------------------------ Word */
function docxHtml(template, title, ar) {
  const t = esc(title);
  if (template === 'report') {
    return ar
      ? `<h1 style="text-align:center">${t}</h1><p style="text-align:center">${today('ar')}</p><h2>الملخص</h2><p><br></p><h2>المقدمة</h2><p><br></p><h2>المحتوى</h2><p><br></p><h2>الخلاصة</h2><p><br></p>`
      : `<h1 style="text-align:center">${t}</h1><p style="text-align:center">${today('en')}</p><h2>Summary</h2><p><br></p><h2>Introduction</h2><p><br></p><h2>Body</h2><p><br></p><h2>Conclusion</h2><p><br></p>`;
  }
  if (template === 'letter') {
    return ar
      ? `<p>${today('ar')}</p><p><br></p><p>السيد / السيدة ..................</p><p>تحية طيبة وبعد،</p><p><br></p><p>أكتب إليكم بخصوص ..................</p><p><br></p><p>وتفضلوا بقبول فائق الاحترام والتقدير،</p><p><br></p><p>الاسم: ..................</p>`
      : `<p>${today('en')}</p><p><br></p><p>Dear ..................,</p><p><br></p><p>I am writing to you regarding ..................</p><p><br></p><p>Kind regards,</p><p><br></p><p>..................</p>`;
  }
  if (template === 'minutes') {
    const th = (x) => `<th style="background-color:#E8ECFF">${x}</th>`;
    const row = (n) => `<tr>${Array.from({ length: n }, () => '<td><br></td>').join('')}</tr>`;
    return ar
      ? `<h1>${t}</h1><p>التاريخ: ${today('ar')}</p><p>الحضور: ..................</p><h2>جدول الأعمال</h2><ol><li><br></li></ol><h2>القرارات والمهام</h2><table><tbody><tr>${th('القرار / المهمة')}${th('المسؤول')}${th('الموعد')}</tr>${row(3)}${row(3)}${row(3)}</tbody></table><p><br></p>`
      : `<h1>${t}</h1><p>Date: ${today('en')}</p><p>Attendees: ..................</p><h2>Agenda</h2><ol><li><br></li></ol><h2>Decisions &amp; actions</h2><table><tbody><tr>${th('Decision / action')}${th('Owner')}${th('Due')}</tr>${row(3)}${row(3)}${row(3)}</tbody></table><p><br></p>`;
  }
  return '<p><br></p>';
}
async function makeDocx(template, title, locale) {
  const { htmlToDocx, sanitizeHtml } = await import('./docx');
  const ar = locale === 'ar';
  const root = document.createElement('div');
  root.innerHTML = sanitizeHtml(docxHtml(template, title.replace(/\.docx$/i, ''), ar));
  if (ar) root.setAttribute('dir', 'rtl');
  return htmlToDocx(root, { defaults: { rtl: ar, font: ar ? 'Arial' : 'Calibri' } });
}

/* ----------------------------------------------------------------- Excel */
function sheetRows(template, ar) {
  if (template === 'tasks') return ar ? [['المهمة', 'المسؤول', 'الأولوية', 'الحالة', 'الموعد'], ['', '', '', '', ''], ['', '', '', '', '']] : [['Task', 'Owner', 'Priority', 'Status', 'Due date'], ['', '', '', '', ''], ['', '', '', '', '']];
  if (template === 'attendance') return ar ? [['الاسم', 'رقم الطالب', 'المحاضرة ١', 'المحاضرة ٢', 'المحاضرة ٣', 'المحاضرة ٤', 'ملاحظات']] : [['Name', 'Student ID', 'Lecture 1', 'Lecture 2', 'Lecture 3', 'Lecture 4', 'Notes']];
  if (template === 'grades') return ar ? [['الاسم', 'رقم الطالب', 'أعمال السنة', 'الميد', 'النهائي', 'المجموع']] : [['Name', 'Student ID', 'Coursework', 'Midterm', 'Final', 'Total']];
  return [['']];
}
async function makeXlsx(template, title, locale) {
  const { buildSheets } = await import('./xlsx');
  const ar = locale === 'ar';
  return buildSheets([{ name: ar ? 'ورقة1' : 'Sheet1', cells: sheetRows(template, ar) }], 'xlsx', { rtl: ar });
}

/* ------------------------------------------------------------ PowerPoint */
function makePptx(template, title, locale) {
  const ar = locale === 'ar'; const name = title.replace(/\.pptx$/i, '');
  if (template === 'empty') return buildPptx({ slides: [{ layout: 'blank' }], rtl: ar, title: name });
  if (template === 'outline') {
    return buildPptx({
      rtl: ar, title: name,
      slides: ar
        ? [{ layout: 'title', title: name, body: [today('ar')] }, { layout: 'content', title: 'المحتوى', body: ['النقطة الأولى', 'النقطة الثانية', 'النقطة الثالثة'] }, { layout: 'content', title: 'المشكلة والحل', body: ['المشكلة', 'الحل المقترح'] }, { layout: 'content', title: 'النتائج', body: ['النتيجة الأولى', 'النتيجة الثانية'] }, { layout: 'title', title: 'شكرًا لكم', body: ['أسئلة؟'] }]
        : [{ layout: 'title', title: name, body: [today('en')] }, { layout: 'content', title: 'Agenda', body: ['First point', 'Second point', 'Third point'] }, { layout: 'content', title: 'Problem & solution', body: ['The problem', 'The proposed solution'] }, { layout: 'content', title: 'Results', body: ['First result', 'Second result'] }, { layout: 'title', title: 'Thank you', body: ['Questions?'] }],
    });
  }
  return buildPptx({ slides: [{ layout: 'title', title: name, body: [''] }], rtl: ar, title: name });
}

/* ------------------------------------------------------------------- PDF */
async function makePdf(template) {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setCreator('UIPE'); doc.setProducer('UIPE');
  const [w, h] = template === 'landscape' ? [841.89, 595.28] : [595.28, 841.89];
  const page = doc.addPage([w, h]);
  if (template === 'lined') for (let y = h - 90; y > 50; y -= 26) page.drawLine({ start: { x: 50, y }, end: { x: w - 50, y }, thickness: 0.6, color: rgb(0.72, 0.76, 0.85) });
  if (template === 'grid') {
    for (let x = 40; x <= w - 40; x += 20) page.drawLine({ start: { x, y: 40 }, end: { x, y: h - 40 }, thickness: 0.4, color: rgb(0.8, 0.83, 0.9) });
    for (let y = 40; y <= h - 40; y += 20) page.drawLine({ start: { x: 40, y }, end: { x: w - 40, y }, thickness: 0.4, color: rgb(0.8, 0.83, 0.9) });
  }
  return new Blob([await doc.save()], { type: MIME.pdf });
}

/* ----------------------------------------------------------------- image */
function makePng(template) {
  const [w, h] = template === 'square' ? [1024, 1024] : [1280, 720];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (template !== 'transparent') { ctx.fillStyle = template === 'dark' ? '#111827' : '#ffffff'; ctx.fillRect(0, 0, w, h); }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image.'))), 'image/png'));
}


/* --------------------------------------------------------------- Scratch */
/** A real Scratch 3 project (.sb3 = a zip with project.json + the costume SVGs) that opens in scratch.mit.edu / the Scratch desktop app. */
async function makeScratch(template) {
  const { zipSync, strToU8 } = await import('fflate');
  const SVG0 = "<svg version=\"1.1\" width=\"2\" height=\"2\" viewBox=\"-1 -1 2 2\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"></svg>";
  const SVG1 = "<svg version=\"1.1\" width=\"100\" height=\"100\" viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"50\" cy=\"50\" r=\"46\" fill=\"#4c97ff\" stroke=\"#3373cc\" stroke-width=\"4\"/></svg>";
  const blocks = template === 'hello'
    ? {
        a: { opcode: 'event_whenflagclicked', next: 'b', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 48, y: 48 },
        b: { opcode: 'looks_say', next: null, parent: 'a', inputs: { MESSAGE: [1, [10, 'Welcome In UIPE NUB']] }, fields: {}, shadow: false, topLevel: false },
      }
    : {};
  const common = { variables: {}, lists: {}, broadcasts: {}, comments: {}, sounds: [], volume: 100 };
  const project = {
    targets: [
      { ...common, isStage: true, name: 'Stage', blocks: {}, currentCostume: 0, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null,
        costumes: [{ assetId: 'fcb8546c50e11d422b78fd55e34d7e7e', name: 'backdrop1', md5ext: 'fcb8546c50e11d422b78fd55e34d7e7e.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0 }] },
      { ...common, isStage: false, name: 'Sprite1', blocks, currentCostume: 0, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around',
        costumes: [{ assetId: '44d981f19616cce1b5dce34be7d95ac2', name: 'costume1', md5ext: '44d981f19616cce1b5dce34be7d95ac2.svg', dataFormat: 'svg', rotationCenterX: 50, rotationCenterY: 50 }] },
    ],
    monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '0.2.0', agent: 'UIPE' },
  };
  const zip = zipSync({ 'project.json': strToU8(JSON.stringify(project)), 'fcb8546c50e11d422b78fd55e34d7e7e.svg': strToU8(SVG0), '44d981f19616cce1b5dce34be7d95ac2.svg': strToU8(SVG1) }, { level: 6 });
  return new Blob([zip], { type: MIME.sb3 });
}

/* ------------------------------------------------------------------ text */
function makeText(type, template, title) {
  const base = title.replace(/\.[a-z0-9]+$/i, '');
  if (type === 'md') return template === 'readme' ? `# ${base}\n\n## About\n\n## Getting started\n\n## Usage\n\n## License\n` : `# ${base}\n\n`;
  if (type === 'json') return template === 'list' ? '[]\n' : '{}\n';
  if (type === 'html') return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${esc(base)}</title>\n</head>\n<body>\n  <h1>${esc(base)}</h1>\n</body>\n</html>\n`;
  if (template === 'hello' && HELLO[type]) return HELLO[type];
  return '';
}

const HELLO = {
  js: "console.log(\"Welcome In UIPE NUB\");\n",
  py: "print(\"Welcome In UIPE NUB\")\n",
  c: "#include <stdio.h>\n\nint main(void) {\n    printf(\"Welcome In UIPE NUB\\n\");\n    return 0;\n}\n",
  cpp: "#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n\n    cout << \"Welcome In UIPE NUB\" << endl;\n\n    return 0;\n}\n",
  java: "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Welcome In UIPE NUB\");\n    }\n}\n",
  cs: "using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine(\"Welcome In UIPE NUB\");\n    }\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"Welcome In UIPE NUB\")\n}\n",
  rs: "fn main() {\n    println!(\"Welcome In UIPE NUB\");\n}\n",
  php: "<?php\necho \"Welcome In UIPE NUB\\n\";\n",
  rb: "puts \"Welcome In UIPE NUB\"\n",
  ts: "const message: string = \"Welcome In UIPE NUB\";\nconsole.log(message);\n",
  kt: "fun main() {\n    println(\"Welcome In UIPE NUB\")\n}\n",
  dart: "void main() {\n  print('Welcome In UIPE NUB');\n}\n",
  lua: "print(\"Welcome In UIPE NUB\")\n",
  pl: "use strict;\nuse warnings;\n\nprint \"Welcome In UIPE NUB\\n\";\n",
  r: "cat(\"Welcome In UIPE NUB\\n\")\n",
  jl: "println(\"Welcome In UIPE NUB\")\n",
  sh: "#!/bin/bash\necho \"Welcome In UIPE NUB\"\n",
  sql: "-- SQLite\nCREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO students (name) VALUES ('Sara'), ('Omar');\nSELECT * FROM students;\n",
  hs: "main :: IO ()\nmain = putStrLn \"Welcome In UIPE NUB\"\n",
  f90: "program hello\n  print *, \"Welcome In UIPE NUB\"\nend program hello\n",
  pas: "program Hello;\nbegin\n  writeln('Welcome In UIPE NUB');\nend.\n",
  swift: "print(\"Welcome In UIPE NUB\")\n",
  matlab: "disp('Welcome In UIPE NUB')\n",
  vb: "Module Program\n    Sub Main()\n        Console.WriteLine(\"Welcome In UIPE NUB\")\n    End Sub\nEnd Module\n",
  objc: "#import <Foundation/Foundation.h>\n\nint main(void) {\n    @autoreleasepool {\n        NSLog(@\"Welcome In UIPE NUB\");\n    }\n    return 0;\n}\n",
  scala: "object Main {\n  def main(args: Array[String]): Unit = {\n    println(\"Welcome In UIPE NUB\")\n  }\n}\n",
  ex: "IO.puts(\"Welcome In UIPE NUB\")\n",
  erl: "#!/usr/bin/env escript\n\nmain(_) ->\n    io:format(\"Welcome In UIPE NUB~n\").\n",
  fs: "printfn \"Welcome In UIPE NUB\"\n",
  ml: "let () = print_endline \"Welcome In UIPE NUB\"\n",
  clj: "(println \"Welcome In UIPE NUB\")\n",
  lisp: "(format t \"Welcome In UIPE NUB~%\")\n",
  cob: "IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\n    DISPLAY \"Welcome In UIPE NUB\".\n    STOP RUN.\n",
  asm: "; NASM, x86-64 Linux\nsection .data\n    msg db \"Welcome In UIPE NUB\", 10\n    len equ $ - msg\n\nsection .text\n    global _start\n\n_start:\n    mov rax, 1\n    mov rdi, 1\n    mov rsi, msg\n    mov rdx, len\n    syscall\n\n    mov rax, 60\n    xor rdi, rdi\n    syscall\n",
  dpr: "program Hello;\n\n{$APPTYPE CONSOLE}\n\nbegin\n  Writeln('Welcome In UIPE NUB');\nend.\n",
  bas: "Attribute VB_Name = \"Module1\"\nOption Explicit\n\nSub Main()\n    MsgBox \"Welcome In UIPE NUB\"\nEnd Sub\n",
  ps1: "Write-Host \"Welcome In UIPE NUB\"\n",
  sol: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\ncontract Hello {\n    string public message = \"Welcome In UIPE NUB\";\n\n    function greet() public view returns (string memory) {\n        return message;\n    }\n}\n",
  cls: "public class Hello {\n    public static void run() {\n        System.debug('Welcome In UIPE NUB');\n    }\n}\n",
  abap: "REPORT zhello.\n\nWRITE / 'Welcome In UIPE NUB'.\n",
  sas: "data _null_;\n    put \"Welcome In UIPE NUB\";\nrun;\n",
  plsql: "SET SERVEROUTPUT ON;\n\nBEGIN\n    DBMS_OUTPUT.PUT_LINE('Welcome In UIPE NUB');\nEND;\n/\n",
  tsql: "-- SQL Server (T-SQL)\nPRINT 'Welcome In UIPE NUB';\n",
  pro: ":- initialization(main).\n\nmain :-\n    write('Welcome In UIPE NUB'), nl,\n    halt.\n",
  adb: "with Ada.Text_IO;\n\nprocedure Main is\nbegin\n    Ada.Text_IO.Put_Line (\"Welcome In UIPE NUB\");\nend Main;\n",
  v: "fn main() {\n\tprintln('Welcome In UIPE NUB')\n}\n",
  zig: "const std = @import(\"std\");\n\npub fn main() void {\n    std.debug.print(\"Welcome In UIPE NUB\\n\", .{});\n}\n",
  groovy: "println \"Welcome In UIPE NUB\"\n",
};

/** @returns {Promise<File>} */
export async function createFile({ type, template, name, locale = 'en' }) {
  const t = typeById(type);
  if (!t) throw new Error('Unknown file type.');
  const tpl = template || t.templates[0].id;
  const fileName = withExt(name || defaultName(type, locale).replace(/\.[^.]+$/, ''), t.ext);
  let body;
  if (type === 'docx') body = await makeDocx(tpl, fileName, locale);
  else if (type === 'xlsx') body = await makeXlsx(tpl, fileName, locale);
  else if (type === 'pptx') body = makePptx(tpl, fileName, locale);
  else if (type === 'pdf') body = await makePdf(tpl);
  else if (type === 'png') body = await makePng(tpl);
  else if (type === 'scratch') body = await makeScratch(tpl);
  else body = new Blob([type === 'csv' || type === 'tsv' ? '' : makeText(type, tpl, fileName)], { type: `${MIME[type] || 'text/plain'};charset=utf-8` });
  return new File([body], fileName, { type: MIME[type] || body.type || 'application/octet-stream' });
}
export const isRtlText = (s) => RTL_RE.test(String(s || ''));
