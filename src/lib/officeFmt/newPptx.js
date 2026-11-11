/**
 * Builds a brand-new, valid PowerPoint package (.pptx) from scratch — no template file needed.
 *   buildPptx({ slides: [{ layout: 'title' | 'content' | 'blank', title, body: string[] }], rtl, ratio })
 *     -> Blob (opens in PowerPoint / LibreOffice / Google Slides and in the UIPE slide editor)
 * The package has a theme, a master and three layouts (Title Slide, Title and Content, Blank) so the editor's
 * "New slide" menu (pptxEdit.addSlide) works on the result like on any other deck.
 */
import { strToU8, zipSync } from 'fflate';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

const SIZES = { '16:9': [12192000, 6858000], '4:3': [9144000, 6858000] };

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`;

/** placeholder shape used inside the master / layouts (carries geometry; text is the prompt shown in the layout) */
function phShape(id, name, ph, rect, { prompt = '', anchor, lst = '' } = {}) {
  const geom = rect ? `<p:spPr>${xfrm(...rect)}</p:spPr>` : '<p:spPr/>';
  const bp = anchor ? `<a:bodyPr anchor="${anchor}"><a:normAutofit/></a:bodyPr>` : '<a:bodyPr><a:normAutofit/></a:bodyPr>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr>${geom}<p:txBody>${bp}<a:lstStyle>${lst}</a:lstStyle><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(prompt)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

const theme = () => `${DECL}<a:theme xmlns:a="${A}" name="UIPE"><a:themeElements>
<a:clrScheme name="UIPE"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1B2559"/></a:dk2><a:lt2><a:srgbClr val="EEF1FF"/></a:lt2><a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="0EA5E9"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="E11D48"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
<a:fontScheme name="UIPE"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="UIPE"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

function master(cx, cy, rtl) {
  const m = Math.round(cx * 0.055); const algn = rtl ? ' algn="r" rtl="1"' : '';
  const lvl = (n, mar, sz, bullet) => `<a:lvl${n}pPr marL="${mar}" indent="${bullet ? -285750 : 0}"${algn} defTabSz="914400"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="800"/></a:spcBef>${bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : '<a:buNone/>'}<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;
  const body = [1, 2, 3, 4, 5].map((n) => lvl(n, 285750 + (n - 1) * 457200, [2800, 2400, 2000, 1800, 1800][n - 1], true)).join('');
  const other = [1, 2, 3].map((n) => lvl(n, (n - 1) * 457200, 1800, false)).join('');
  return `${DECL}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}${
    phShape(2, 'Title Placeholder 1', 'type="title"', [m, cy * 0.05, cx - 2 * m, cy * 0.18], { prompt: 'Click to edit Master title style', anchor: 'ctr' })
  }${phShape(3, 'Text Placeholder 2', 'type="body" idx="1"', [m, cy * 0.27, cx - 2 * m, cy * 0.62], { prompt: 'Click to edit Master text styles' })
  }</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/><p:sldLayoutId id="2147483651" r:id="rId3"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr${algn} defTabSz="914400"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" b="1" kern="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${body}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${other}</p:otherStyle></p:txStyles></p:sldMaster>`;
}

function layout(name, type, shapes) {
  return `${DECL}<p:sldLayout ${NS} type="${type}" preserve="1"><p:cSld name="${esc(name)}"><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

/* ---- slides */
function textShape(id, name, ph, paragraphs, rtl) {
  const algn = rtl ? ' algn="r" rtl="1"' : '';
  const ps = (paragraphs.length ? paragraphs : ['']).map((t) => (t
    ? `<a:p><a:pPr${algn}/><a:r><a:rPr lang="${rtl ? 'ar-SA' : 'en-US'}" dirty="0"/><a:t>${esc(t)}</a:t></a:r></a:p>`
    : `<a:p><a:pPr${algn}/><a:endParaRPr lang="en-US" dirty="0"/></a:p>`)).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${ps}</p:txBody></p:sp>`;
}
function slide(s, rtl) {
  let shapes = '';
  if (s.layout === 'title') shapes = textShape(2, 'Title 1', 'type="ctrTitle"', [s.title || ''], rtl) + textShape(3, 'Subtitle 2', 'type="subTitle" idx="1"', [].concat(s.body || ''), rtl);
  else if (s.layout === 'content') shapes = textShape(2, 'Title 1', 'type="title"', [s.title || ''], rtl) + textShape(3, 'Content Placeholder 2', 'idx="1"', [].concat(s.body || []), rtl);
  return `${DECL}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export function buildPptx({ slides, rtl = false, ratio = '16:9', title = 'Presentation' } = {}) {
  const [cx, cy] = SIZES[ratio] || SIZES['16:9'];
  const list = (slides && slides.length ? slides : [{ layout: 'title', title: '', body: [] }]).map((s) => ({ ...s, rtl: rtl || RTL_RE.test(`${s.title || ''}${[].concat(s.body || []).join('')}`) }));
  const m = Math.round(cx * 0.055);
  const LAYOUT_FILE = { title: 1, content: 2, blank: 3 };
  const f = {};
  const add = (path, xml) => { f[path] = strToU8(xml); };
  const rel = (items) => `${DECL}<Relationships xmlns="${REL}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`;

  add('[Content_Types].xml', `${DECL}<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>${[1, 2, 3].map((n) => `<Override PartName="/ppt/slideLayouts/slideLayout${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`).join('')}${list.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  add('_rels/.rels', `${DECL}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  add('docProps/core.xml', `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>UIPE</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  add('docProps/app.xml', `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>UIPE</Application><Slides>${list.length}</Slides></Properties>`);
  add('ppt/presentation.xml', `${DECL}<p:presentation ${NS} saveSubsetFonts="1"${rtl ? ' rtl="1"' : ''}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 5}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  add('ppt/_rels/presentation.xml.rels', rel([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'presProps', 'presProps.xml'], ['rId3', 'viewProps', 'viewProps.xml'], ['rId4', 'theme', 'theme/theme1.xml'], ['rId99', 'tableStyles', 'tableStyles.xml'], ...list.map((_, i) => [`rId${i + 5}`, 'slide', `slides/slide${i + 1}.xml`])]));
  add('ppt/presProps.xml', `${DECL}<p:presentationPr ${NS}/>`);
  add('ppt/viewProps.xml', `${DECL}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  add('ppt/tableStyles.xml', `${DECL}<a:tblStyleLst xmlns:a="${A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  add('ppt/theme/theme1.xml', theme());
  add('ppt/slideMasters/slideMaster1.xml', master(cx, cy, rtl));
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'slideLayout', '../slideLayouts/slideLayout2.xml'], ['rId3', 'slideLayout', '../slideLayouts/slideLayout3.xml'], ['rId4', 'theme', '../theme/theme1.xml']]));

  const algn = rtl ? ' algn="r" rtl="1"' : ' algn="ctr"';
  const sub = rtl ? ' algn="r" rtl="1"' : ' algn="ctr"';
  add('ppt/slideLayouts/slideLayout1.xml', layout('Title Slide', 'title',
    phShape(2, 'Title 1', 'type="ctrTitle"', [m, cy * 0.30, cx - 2 * m, cy * 0.20], { prompt: 'Click to edit Master title style', anchor: 'b', lst: `<a:lvl1pPr${algn}><a:defRPr sz="5400"/></a:lvl1pPr>` })
    + phShape(3, 'Subtitle 2', 'type="subTitle" idx="1"', [m * 2, cy * 0.53, cx - 4 * m, cy * 0.18], { prompt: 'Click to edit Master subtitle style', lst: `<a:lvl1pPr marL="0" indent="0"${sub}><a:buNone/><a:defRPr sz="2800"/></a:lvl1pPr>` })));
  add('ppt/slideLayouts/slideLayout2.xml', layout('Title and Content', 'obj',
    phShape(2, 'Title 1', 'type="title"', null, { prompt: 'Click to edit Master title style' })
    + phShape(3, 'Content Placeholder 2', 'idx="1"', null, { prompt: 'Click to edit Master text styles' })));
  add('ppt/slideLayouts/slideLayout3.xml', layout('Blank', 'blank', ''));
  [1, 2, 3].forEach((n) => add(`ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`, rel([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])));

  list.forEach((s, i) => {
    add(`ppt/slides/slide${i + 1}.xml`, slide(s, s.rtl));
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rel([['rId1', 'slideLayout', `../slideLayouts/slideLayout${LAYOUT_FILE[s.layout] || 3}.xml`]]));
  });
  // [Content_Types].xml first, as Office writes it
  const ordered = {}; ['[Content_Types].xml', ...Object.keys(f).filter((k) => k !== '[Content_Types].xml')].forEach((k) => { ordered[k] = f[k]; });
  return new Blob([zipSync(ordered, { level: 6 })], { type: PPTX_MIME });
}
