import { createContext, useContext } from 'react';

/** Split from CallContext.jsx so CallUI (rendered by the provider) can read it without a circular import. */
export const CallCtx = createContext(null);

export const IDLE = {
  phase: 'idle', call: null, peer: null, muted: false, peerMuted: false, quality: 'good', reconnecting: false,
  accepting: false, startedAt: 0, notice: null, minimized: false, available: false, videoEnabled: false,
  callType: 'audio', camOn: false, peerCam: false, sharing: false, peerSharing: false, facing: 'user', canSwitchCam: false, filter: 'none',
  noiseOn: true, localVideo: null, remoteVideo: null, audioBlocked: false, groupRing: [],
};
const NOOP = {
  ...IDLE, startCall: async () => false, accept() {}, decline() {}, hangup() {}, toggleMute() {}, setMinimized() {}, dismissNotice() {},
  toggleCamera() {}, switchCamera() {}, toggleScreenShare() {}, setFilter() {}, setNoise() {}, resumeAudio() {}, getDiagnostics: async () => null,
  startGroupCall: async () => false, joinGroupCall: async () => false, dismissGroupRing() {},
};

/** Call state + actions. Safe outside the provider (inert object), so chat components never crash in isolation. */
export function useCall() {
  return useContext(CallCtx) || NOOP;
}
