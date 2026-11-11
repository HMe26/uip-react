/**
 * Exam single-session helpers.
 *
 * - Device id: stable per browser (localStorage), sent as X-Device-Id on every exam-system call.
 *   It is NOT proof of a physical device — it lets the server tell "same browser reloading"
 *   apart from "a different device opening the same attempt".
 * - Session token: issued by POST my-exams/{id}/attempts, kept per TAB (sessionStorage) and sent as
 *   X-Exam-Session on every call under /exam-system/attempts/{id}. client.js attaches both automatically.
 */
const DEVICE_KEY = 'uip_exam_device_id';
const tokenKey = (attemptId) => `uip_exam_session_${attemptId}`;

let memoryDeviceId = null;

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId() {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (!v) {
      v = randomId();
      localStorage.setItem(DEVICE_KEY, v);
    }
    return v;
  } catch {
    if (!memoryDeviceId) memoryDeviceId = randomId();
    return memoryDeviceId;
  }
}

export function setExamSession(attemptId, token, examId) {
  try {
    if (token) sessionStorage.setItem(tokenKey(attemptId), JSON.stringify({ token, examId: examId ?? null }));
  } catch { /* ignore */ }
}

export function getExamSession(attemptId) {
  try {
    const raw = sessionStorage.getItem(tokenKey(attemptId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearExamSession(attemptId) {
  try { sessionStorage.removeItem(tokenKey(attemptId)); } catch { /* ignore */ }
}

/** Headers to attach for a given API path (empty for anything outside the exam system). */
export function examSessionHeaders(path) {
  if (typeof path !== 'string' || !path.includes('/api/v1/exam-system/')) return {};
  const headers = { 'X-Device-Id': getDeviceId() };
  const m = path.match(/\/exam-system\/attempts\/(\d+)/);
  if (m) {
    const s = getExamSession(m[1]);
    if (s?.token) headers['X-Exam-Session'] = s.token;
  }
  return headers;
}

/** API error code carried by a 409/422 exam response (session_conflict, session_replaced, start_photo_required…). */
export function examErrorCode(err) {
  return err?.payload?.data?.code || null;
}
