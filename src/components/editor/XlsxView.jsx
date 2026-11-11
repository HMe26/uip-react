import SheetEditor, { SheetPreview } from '../sheet/SheetEditor';

/** Read-only viewer: every sheet with its formatting, formulas evaluated by the built-in engine. */
export function XlsxPreview(props) { return <SheetPreview {...props} />; }

/** Spreadsheet editor for .xlsx / .csv / .tsv opened from FileViewer. */
export default function XlsxView(props) { return <SheetEditor {...props} />; }
