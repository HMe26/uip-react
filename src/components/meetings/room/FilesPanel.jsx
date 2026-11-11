import { useRef, useState } from 'react';
import Icon from '../../Icon';
import { useTranslations } from '../../../context/LanguageContext';
import i18nCommon from '../../../i18n/common';
import i18nMeetings from '../../../i18n/shared/meetings';
import MeetingFilePreview, { fileIcon, sameOriginUrl } from './MeetingFilePreview';

const translations = { ...i18nCommon, ...i18nMeetings };

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Round 7 (Collaboration Extras) — بند 19 (File Sharing). Same "slide-in
 * panel docked over the stage" approach as ChatPanel/ParticipantsPanel.
 *
 * Anyone present can upload (`filesApi.store` is open to any resolved
 * actor server-side, see MeetingsFilesApiController's own docblock) —
 * the delete button is only shown for the uploader's own row or, for a
 * manager, any row (MeetingFileService::delete()'s own rule, re-checked
 * server-side regardless of what's shown here).
 */
export default function FilesPanel({ files, myKey, isManager, isOpen, onClose, onUpload, onDelete }) {
  const t = useTranslations(translations);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const inputRef = useRef(null);

  if (!isOpen) return null;

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setUploadError(err?.message || t('This file could not be shared.'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId) {
    if (!window.confirm(t('Remove this file for everyone?'))) return;
    setBusyId(fileId);
    try {
      await onDelete(fileId);
    } catch {
      // MeetingRoomShell's own error surface isn't wired per-file here —
      // a failed delete just leaves the row in place, same "try again"
      // affordance as any other transient action failure in this app.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="meeting-chat-panel">
      <div className="meeting-chat-panel__header">
        <strong>{t('Files')}</strong>
        <span className="badge badge-neutral" style={{ marginInlineStart: 6 }}>{files.length}</span>
        <button type="button" className="meeting-room__control-btn" style={{ width: 32, height: 32, marginInlineStart: 'auto' }} onClick={onClose} title={t('Close')}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="meeting-chat-panel__list">
        {files.length === 0 && (
          <p className="text-caption" style={{ color: 'var(--mr-muted)', textAlign: 'center', marginTop: 'var(--space-4)' }}>
            {t('No files shared yet.')}
          </p>
        )}
        {files.map((f) => {
          const canDelete = isManager || f.uploader_key === myKey;
          return (
            <div key={f.id} className="meeting-files-panel__row">
              <Icon name={fileIcon(f)} size={18} style={{ flexShrink: 0, opacity: 0.7 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                {f.download_url ? (
                  <button type="button" className="meeting-files-panel__name" style={{ background: 'none', border: 0, padding: 0, textAlign: 'start', cursor: 'pointer' }} onClick={() => setPreviewFile(f)} title={t('Preview')}>
                    {f.original_name}
                  </button>
                ) : (
                  <span className="meeting-files-panel__name" title={f.original_name}>{f.original_name}</span>
                )}
                <div className="text-caption" style={{ color: 'var(--mr-muted)' }}>
                  {f.uploader_display_name}{f.size_bytes != null ? ` · ${formatSize(f.size_bytes)}` : ''}
                </div>
              </div>
              {f.download_url && (
                <a href={sameOriginUrl(f.download_url)} download={f.original_name} className="meeting-room__control-btn" style={{ width: 30, height: 30 }} title={t('Download')}>
                  <Icon name="download" size={14} />
                </a>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="meeting-room__control-btn"
                  style={{ width: 30, height: 30, color: '#f87171' }}
                  disabled={busyId === f.id}
                  onClick={() => handleDelete(f.id)}
                  title={t('Remove')}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {previewFile && <MeetingFilePreview file={previewFile} files={files} onClose={() => setPreviewFile(null)} />}

      <div className="meeting-chat-panel__compose">
        {uploadError && <p className="form-error" style={{ margin: '0 0 6px' }}>{uploadError}</p>}
        <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleFileChosen} />
        <button type="button" className="btn btn-outline" style={{ width: '100%' }} disabled={uploading} onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={16} /> {uploading ? `${t('Sharing…')}` : t('Share a file')}
        </button>
      </div>
    </div>
  );
}
