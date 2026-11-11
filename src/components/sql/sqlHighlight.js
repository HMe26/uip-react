/**
 * Tiny SQL tokenizer used by the Query Builder editor and the generated-SQL
 * preview. Output token types map to .qb-tok-* classes (VS Code Dark+ palette):
 *   kw  keyword · fn function · str string · num number · com comment
 *   tbl known (allow-listed) table · id identifier · ws whitespace · op other
 */

export const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'BY', 'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'AS', 'ON', 'USING',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'NATURAL', 'UNION', 'ALL', 'DISTINCT', 'HAVING',
  'ASC', 'DESC', 'LIKE', 'IN', 'IS', 'NULL', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
  'TRUE', 'FALSE', 'INTERVAL', 'OVER', 'PARTITION',
]);

export const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROUND', 'COALESCE', 'IFNULL', 'NULLIF', 'LOWER', 'UPPER', 'LENGTH', 'TRIM',
  'SUBSTRING', 'CONCAT', 'CAST', 'DATE', 'YEAR', 'MONTH', 'DAY', 'NOW', 'ABS', 'FLOOR', 'CEIL', 'CEILING', 'IF',
  'DATEDIFF', 'DATE_FORMAT', 'STRFTIME', 'GROUP_CONCAT', 'STDDEV', 'VARIANCE',
]);

const RE = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^'\n]|'')*(?:'|$))|(`[^`\n]*`?)|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([\s\S])/g;

export function tokenizeSql(sql, tables) {
  const tokens = [];
  if (!sql) return tokens;
  const tableSet = tables instanceof Set ? tables : new Set();
  let m;
  RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = RE.exec(sql)) !== null) {
    const v = m[0];
    if (m[1]) tokens.push({ t: 'com', v });
    else if (m[2]) tokens.push({ t: 'str', v });
    else if (m[3]) tokens.push({ t: tableSet.has(v.replace(/`/g, '').toLowerCase()) ? 'tbl' : 'id', v });
    else if (m[4]) tokens.push({ t: 'num', v });
    else if (m[5]) tokens.push({ t: 'word', v });
    else if (m[6]) tokens.push({ t: 'ws', v });
    else tokens.push({ t: 'op', v });
  }

  // second pass: classify words using their neighbours
  const sig = (from, step) => {
    for (let i = from; i >= 0 && i < tokens.length; i += step) {
      if (tokens[i].t !== 'ws') return tokens[i];
    }
    return null;
  };
  tokens.forEach((tk, i) => {
    if (tk.t !== 'word') return;
    const up = tk.v.toUpperCase();
    const prev = sig(i - 1, -1);
    const next = sig(i + 1, 1);
    if (prev && prev.v === '.') tk.t = 'id';
    else if (next && next.v === '.') tk.t = tableSet.has(tk.v.toLowerCase()) ? 'tbl' : 'id';
    else if (FUNCTIONS.has(up) && next && next.v === '(') tk.t = 'fn';
    else if (KEYWORDS.has(up)) tk.t = 'kw';
    else if (next && next.v === '(' && !(prev && prev.v.toUpperCase() === 'AS')) tk.t = 'fn';
    else if (tableSet.has(tk.v.toLowerCase())) tk.t = 'tbl';
    else tk.t = 'id';
  });
  return tokens;
}

/** Splits a token stream into per-line token arrays (tokens never straddle lines). */
export function splitLines(tokens) {
  const lines = [[]];
  tokens.forEach((tk) => {
    if (!tk.v.includes('\n')) { lines[lines.length - 1].push(tk); return; }
    tk.v.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: tk.t, v: part });
    });
  });
  return lines;
}
