/**
 * "Ask about this part": the student selects text inside one of UIPE AI's answers and asks about just that part.
 * The quote travels INSIDE the question's text (so it is saved with the conversation without any server change):
 *
 *   <question>
 *
 *   > first quoted line
 *   > second quoted line
 *
 * The panel shows it as a quote card above the question; the model gets it spelled out (see wireText).
 */
export const MAX_QUOTE = 1200;

export function joinQuote(question, quote) {
  const q = String(quote || '').replace(/\r/g, '').trim().slice(0, MAX_QUOTE);
  if (!q) return String(question || '');
  return `${String(question || '').trim()}\n\n${q.split('\n').map((l) => `> ${l}`).join('\n')}`;
}

/** { text, quote } — quote is '' when the message has none. */
export function splitQuote(content) {
  const s = String(content || '');
  const m = /^([\s\S]*?)\n\n((?:> ?[^\n]*(?:\n|$))+)$/.exec(s);
  if (!m) return { text: s, quote: '' };
  return { text: m[1], quote: m[2].replace(/\n$/, '').split('\n').map((l) => l.replace(/^> ?/, '')).join('\n') };
}

/** What the model reads for a question that carries a quote. */
export function wireText(content) {
  const { text, quote } = splitQuote(content);
  if (!quote) return String(content || '');
  return `[The student is asking about this specific part of your earlier answer:\n"""\n${quote}\n"""]\n\n${text}`;
}
