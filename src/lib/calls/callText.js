/**
 * Call wording shared by the chat log bubble, the inbox preview and the end-of-call toast.
 * `meta` is the `metadata` of a message_type='call' message (backend CallService::logMessage):
 *   { call_id, call_type: 'audio'|'video', outcome: completed|missed|cancelled|declined|busy|failed, duration, caller_id, callee_id }
 */

export function fmtCallDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** @returns {{text:string, tone:'ok'|'missed'|'info', video:boolean, incoming:boolean}} from MY point of view. */
export function callLine(meta, myUserId, ar) {
  const m = meta || {};
  const video = m.call_type === 'video';
  const mine = String(m.caller_id) === String(myUserId); // I started this call
  const kind = video ? (ar ? 'مكالمة فيديو' : 'Video call') : (ar ? 'مكالمة صوتية' : 'Voice call');
  const base = { video, incoming: !mine };
  if (m.group) {
    // group call card: one line for everybody (nobody "declines" or "misses" a group call)
    const gkind = video ? (ar ? 'مكالمة فيديو جماعية' : 'Group video call') : (ar ? 'مكالمة صوتية جماعية' : 'Group voice call');
    if (m.outcome === 'live') return { ...base, group: true, live: true, tone: 'ok', text: `${gkind} · ${ar ? 'جارية الآن' : 'in progress'}` };
    return { ...base, group: true, live: false, tone: 'info', text: `${gkind} · ${fmtCallDuration(m.duration)}` };
  }
  switch (m.outcome) {
    case 'completed':
      return { ...base, text: `${kind} · ${fmtCallDuration(m.duration)}`, tone: 'ok' };
    case 'declined':
      return { ...base, tone: 'info', text: mine ? (ar ? 'تم رفض المكالمة' : 'Call declined') : (ar ? 'رفضت المكالمة' : 'You declined the call') };
    case 'cancelled':
      return mine
        ? { ...base, tone: 'info', text: ar ? 'مكالمة ملغاة' : 'Cancelled call' }
        : { ...base, tone: 'missed', text: video ? (ar ? 'مكالمة فيديو فائتة' : 'Missed video call') : (ar ? 'مكالمة صوتية فائتة' : 'Missed voice call') };
    case 'busy':
      return mine
        ? { ...base, tone: 'info', text: ar ? 'الطرف الآخر مشغول' : 'Line busy' }
        : { ...base, tone: 'missed', text: video ? (ar ? 'مكالمة فيديو فائتة' : 'Missed video call') : (ar ? 'مكالمة صوتية فائتة' : 'Missed voice call') };
    case 'failed':
      return { ...base, tone: 'info', text: ar ? 'تعذّرت المكالمة' : 'Call failed' };
    case 'missed':
    default:
      return mine
        ? { ...base, tone: 'info', text: ar ? 'لم يتم الرد' : 'No answer' }
        : { ...base, tone: 'missed', text: video ? (ar ? 'مكالمة فيديو فائتة' : 'Missed video call') : (ar ? 'مكالمة صوتية فائتة' : 'Missed voice call') };
  }
}
