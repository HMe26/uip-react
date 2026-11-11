// -----------------------------------------------------------------------
// Shared smart parsing — the instructor pastes or types a question in
// whatever shape they already have it in (their own notes, a Word doc,
// ChatGPT output, ...) and this fills in type/prompt/options/correct-
// answer automatically. It only ever *pre-fills* the real form fields —
// nothing is locked, everything stays fully editable, and if nothing is
// recognized it just falls back to a plain prompt.
//
// Recognized option markers: "A)", "A.", "A-", "1)", "1.", "-", "*", or
// the Arabic ordinals "أ) ب) ج) د) ه)". A correct option can be marked
// inline with a trailing "*", "✓"/"✔", "(correct)" or "(صح)"/"(صحيح)", or
// via a separate line "Answer: B" / "الإجابة: ب" / "الإجابة: 2" after the
// options (by letter, number, or matching the option's own text). If
// exactly two options are found and they read as True/False (or
// صح/خطأ), the question is treated as true_false instead of mcq. If no
// option block is found at all, short prompts become short_answer and
// longer ones become essay — with any trailing "Answer:" line pulled out
// as the short-answer's correct answer.
//
// Used by both AcademicStaffQuestionBankDetail.jsx (Add Questions to a
// bank) and AcademicStaffExamBuilder.jsx (Add New Question directly to
// an exam) so the parsing behaves identically in both places.
// -----------------------------------------------------------------------
const OPTION_LINE_RE = /^(?:[-•*]|\(?[A-Za-z1-9أبجدهوز]\)?[.)\-:])\s+(.+)$/;
const CORRECT_MARK_RE = /\s*(?:\*+|✓|✔|\(\s*(?:correct|صح|صحيح|الإجابة الصحيحة)\s*\))\s*$/i;
const ANSWER_LINE_RE = /^(?:answer|ans|correct answer|الإجابة|الاجابة|الجواب)\s*[:\-]\s*(.+)$/i;
const ARABIC_LETTER_INDEX = { 'أ': 0, 'ا': 0, 'ب': 1, 'ج': 2, 'د': 3, 'ه': 4 };
const LATIN_LETTER_INDEX = { a: 0, b: 1, c: 2, d: 3, e: 4 };

export function emptyOption() {
  return { option_text: '', is_correct: false };
}

function stripCorrectMark(text) {
  const isCorrect = CORRECT_MARK_RE.test(text);
  return { text: text.replace(CORRECT_MARK_RE, '').trim(), isCorrect };
}

function normalizeBoolText(s) {
  const v = (s || '').trim().toLowerCase();
  if (['true', 't', 'yes', 'صح', 'صحيح', 'نعم'].includes(v)) return 'true';
  if (['false', 'f', 'no', 'خطأ', 'خطا', 'لا'].includes(v)) return 'false';
  return null;
}

function resolveAnswerRef(ref, options) {
  const clean = (ref || '').replace(/[.)]/g, '').trim();
  if (LATIN_LETTER_INDEX[clean.toLowerCase()] !== undefined) return LATIN_LETTER_INDEX[clean.toLowerCase()];
  if (ARABIC_LETTER_INDEX[clean] !== undefined) return ARABIC_LETTER_INDEX[clean];
  if (/^\d+$/.test(clean)) return parseInt(clean, 10) - 1;
  const lower = clean.toLowerCase();
  const idx = options.findIndex((o) => o.option_text.toLowerCase().trim() === lower);
  if (idx >= 0) return idx;
  return options.findIndex((o) => o.option_text.toLowerCase().includes(lower) && lower.length > 1);
}

/** @returns {{type: 'mcq'|'true_false'|'short_answer'|'essay'|null, prompt: string, options: {option_text:string,is_correct:boolean}[], correctAnswer: string|null}} */
export function parseQuestionText(raw) {
  const lines = String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { type: null, prompt: '', options: [], correctAnswer: null };

  let optionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (OPTION_LINE_RE.test(lines[i]) && lines.slice(i + 1).some((l) => OPTION_LINE_RE.test(l))) {
      optionStart = i;
      break;
    }
  }

  let promptLines = [];
  let optionLines = [];
  let answerLineText = null;

  if (optionStart >= 0) {
    promptLines = lines.slice(0, optionStart);
    for (const line of lines.slice(optionStart)) {
      if (OPTION_LINE_RE.test(line)) { optionLines.push(line); continue; }
      const m = line.match(ANSWER_LINE_RE);
      if (m) answerLineText = m[1].trim();
    }
  } else {
    for (const line of lines) {
      const m = line.match(ANSWER_LINE_RE);
      if (m) { answerLineText = m[1].trim(); continue; }
      promptLines.push(line);
    }
  }

  const prompt = promptLines.join('\n').trim();

  if (optionLines.length >= 2) {
    const options = optionLines.map((line) => {
      const m = line.match(OPTION_LINE_RE);
      const { text, isCorrect } = stripCorrectMark(m ? m[1] : line);
      return { option_text: text, is_correct: isCorrect };
    });
    if (!options.some((o) => o.is_correct) && answerLineText) {
      const idx = resolveAnswerRef(answerLineText, options);
      if (idx >= 0 && idx < options.length) options[idx].is_correct = true;
    }

    if (options.length === 2) {
      const norms = options.map((o) => normalizeBoolText(o.option_text));
      if (norms[0] && norms[1] && norms[0] !== norms[1]) {
        const correctOpt = options.find((o) => o.is_correct);
        return { type: 'true_false', prompt, options: [], correctAnswer: (correctOpt && normalizeBoolText(correctOpt.option_text)) || null };
      }
    }
    return { type: 'mcq', prompt, options, correctAnswer: null };
  }

  if (!prompt) return { type: null, prompt: '', options: [], correctAnswer: null };
  const type = prompt.length <= 180 && !prompt.includes('\n') ? 'short_answer' : 'essay';
  return { type, prompt, options: [], correctAnswer: answerLineText };
}
