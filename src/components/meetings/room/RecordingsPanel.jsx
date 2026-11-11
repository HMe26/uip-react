import { useState } from 'react';
import Icon from '../../Icon';
import RecordingPlayerModal, { downloadRecording } from '../RecordingPlayerModal';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

const KIND_OPTIONS = [
  { value: 'video', labelKey: 'Video' },
  { value: 'audio', labelKey: 'Audio only' },
  { value: 'screen_share', labelKey: 'Screen Share' },
];

const STATUS_META = {
  recording: { cls: 'badge-danger', key: 'Recording…' },
  processing: { cls: 'badge-warning', key: 'Processing…' },
  completed: { cls: 'badge-success', key: 'Ready' },
  failed: { cls: 'badge-neutral', key: 'Failed' },
};

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Round 9 (Recording) — بند 18. Same "slide-in panel docked over the
 * stage" shape as FilesPanel/PollsPanel. Two audiences share this one
 * panel:
 *  - a manager who hasn't started a recording yet gets the kind picker +
 *    "Start Recording" button (`isManager` — re-checked server-side by
 *    MeetingRecordingService::requireManager() regardless of what's
 *    shown here);
 *  - the room already has one recording in progress: `activeRecording`
 *    is truthy for *everyone*, but only the browser that actually
 *    started it (`isRecordingLocally`, from useMeetingRoom's own capture
 *    state — see that hook's docblock for why the Blob only ever exists
 *    in that one browser) gets a "Stop Recording" button; any other
 *    manager just sees a plain "Recording in progress — started by X"
 *    status line, same as a non-manager would.
 *
 * The list below (everyone can see it, per MeetingsRecordingsApiController's
 * own docblock — "Do not expose recordings to unauthorized users" only
 * means *unauthorized*, not *non-manager*) shows a live status badge per
 * row (recording → processing → completed/failed, driven by the three
 * listeners in useMeetingRoom) and a Download link once `download_url`
 * is present; delete stays manager-only.
 */
export default function RecordingsPanel({
  recordings, isManager, isOpen, onClose,
  activeRecording, isRecordingLocally, recordingBusy, recordingError,
  onStart, onStopLocal, onDelete,
}) {
  const t = useTranslations(translations);
  const [kind, setKind] = useState('video');
  const [busyId, setBusyId] = useState(null);
  const [playing, setPlaying] = useState(null);

  if (!isOpen) return null;

  async function handleDelete(recordingId) {
    if (!window.confirm(t('Delete this recording for everyone?'))) return;
    setBusyId(recordingId);
    try {
      await onDelete(recordingId);
    } catch {
      // Same "leave the row in place, no per-row error surface" pattern as FilesPanel's own handleDelete.
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...recordings].sort((a, b) => (b.id || 0) - (a.id || 0));

  return (
    <>
    <div className="meeting-chat-panel">
      <div className="meeting-chat-panel__header">
        <strong>{t('Recordings')}</strong>
        <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{recordings.length}</span>
        <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: 'auto' }} onClick={onClose} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="meeting-chat-panel__list">
        {sorted.length === 0 && (
          <p className="text-caption" style={{ color: 'var(--mr-muted)', textAlign: 'center', marginTop: 'var(--space-4)' }}>
            {t('No recordings yet.')}
          </p>
        )}
        {sorted.map((r) => {
          const meta = STATUS_META[r.status] || STATUS_META.processing;
          return (
            <div key={r.id} className="meeting-files-panel__row">
              <Icon name={r.kind === 'audio' ? 'mic' : 'monitor'} size={18} style={{ flexShrink: 0, opacity: 0.7 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="meeting-files-panel__name" title={r.original_name || ''}>
                    {r.original_name || `${t(KIND_OPTIONS.find((k) => k.value === r.kind)?.labelKey || 'Video')} #${r.id}`}
                  </span>
                  <span className={`badge ${meta.cls}`} style={{ fontSize: 10 }}>{t(meta.key)}</span>
                </div>
                <div className="text-caption" style={{ color: 'var(--mr-muted)' }}>
                  {r.started_by_display_name}
                  {r.duration_seconds != null ? ` · ${formatDuration(r.duration_seconds)}` : ''}
                  {r.size_bytes != null ? ` · ${formatSize(r.size_bytes)}` : ''}
                </div>
                {r.status === 'failed' && r.failure_reason && (
                  <p className="text-caption" style={{ color: 'var(--mr-danger-text)', margin: '2px 0 0' }}>{r.failure_reason}</p>
                )}
              </div>
              {r.download_url && (
                <>
                  <button type="button" className="meeting-room__control-btn" style={{ width: 30, height: 30 }} onClick={() => setPlaying(r)} title={t('Preview')} aria-label={t('Preview')}>
                    <Icon name="play" size={14} />
                  </button>
                  <button type="button" className="meeting-room__control-btn" style={{ width: 30, height: 30 }} onClick={() => downloadRecording(r)} title={t('Download')} aria-label={t('Download')}>
                    <Icon name="download" size={14} />
                  </button>
                </>
              )}
              {isManager && (
                <button
                  type="button"
                  className="meeting-room__control-btn"
                  style={{ width: 30, height: 30, color: 'var(--mr-danger-text)' }}
                  disabled={busyId === r.id}
                  onClick={() => handleDelete(r.id)}
                  title={t('Remove')}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isManager && (
        <div className="meeting-chat-panel__compose" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {recordingError && <p className="form-error" style={{ margin: 0 }}>{recordingError}</p>}

          {!activeRecording && (
            <>
              <select className="form-select" value={kind} onChange={(e) => setKind(e.target.value)} disabled={recordingBusy}>
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={recordingBusy} onClick={() => onStart(kind)}>
                <Icon name="record-dot" size={14} /> {recordingBusy ? t('Starting…') : t('Start Recording')}
              </button>
            </>
          )}

          {activeRecording && isRecordingLocally && (
            <button type="button" className="btn btn-outline" style={{ width: '100%', borderColor: '#ef4444', color: 'var(--mr-danger-text)' }} disabled={recordingBusy} onClick={onStopLocal}>
              <Icon name="stop" size={14} /> {recordingBusy ? t('Stopping…') : t('Stop Recording')}
            </button>
          )}

          {activeRecording && !isRecordingLocally && (
            <p className="text-caption" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--mr-danger-text)' }}>
              <Icon name="record-dot" size={12} />
              {t('Recording in progress — started by')} {activeRecording.started_by_display_name}
            </p>
          )}
        </div>
      )}
    </div>
    {playing && <RecordingPlayerModal recording={playing} onClose={() => setPlaying(null)} container={document.querySelector('.meeting-room') || undefined} />}
    </>
  );
}
