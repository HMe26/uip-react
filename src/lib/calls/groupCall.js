import { portalPrefix } from '../../config/navConfig';

/**
 * Group calls (voice / video inside group chats) are instant meetings attached to the chat (backend GroupCallService).
 * Entering one = the normal meeting join (so the host/mesh/SFU logic of the meeting room applies unchanged):
 *   POST /meetings/join/{token}/request  →  meeting room.
 * Only members of the chat are admitted by the server; everybody else gets a clear error.
 */

/** Admit me into the live group call and open its room. Throws the API error (message is user-readable). */
export async function joinGroupCall(api, navigate, role, call) {
  if (!call || !call.join_token || !call.meeting_uuid) throw new Error('This call is no longer available.');
  await api.post(`/api/v1/meetings/join/${call.join_token}/request`, {
    device_preferences: { mic_enabled: true, camera_enabled: call.type === 'video' },
  });
  navigate(`/${portalPrefix(role)}/meetings/${call.meeting_uuid}/room`);
}

/** Start the group's call (or get the live one) and return it. */
export async function startGroupCallRequest(api, base, conversationId, type) {
  const res = await api.post(`${base}/group`, { conversation_id: conversationId, type: type === 'video' ? 'video' : 'audio' });
  const data = (res && res.data) || {};
  if (!data.call) throw new Error('Could not start the group call.');
  return data.call;
}
