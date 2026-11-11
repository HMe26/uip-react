import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { ExKpi } from '../../components/exam/examUi';
import { Avatar, DeleteModal, SgSkeleton, fmtBytes, relTime } from '../../components/student/groupUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/group-hub';
import { parseServerDate } from '../../utils/serverDate';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Group hub: GET/POST/PATCH/DELETE /api/v1/group-hub/* (GroupHubApiController,
 * GroupCollaborationService). Tabs: Timeline · Announcements · Files · Tasks
 * (kanban). Deletes go through a modal that collects the optional reason.
 */
const STATUSES = [
  { key: 'todo', en: 'To Do', ar: 'قيد الانتظار' },
  { key: 'in_progress', en: 'In Progress', ar: 'جاري التنفيذ' },
  { key: 'done', en: 'Done', ar: 'مكتملة' },
];
const TIMELINE_ICON = { announcement: 'bell', file: 'file', task: 'plus', task_done: 'check' };
const TABS = [
  { key: 'timeline', icon: 'clock', en: 'Timeline', ar: 'النشاط' },
  { key: 'announcements', icon: 'bell', en: 'Announcements', ar: 'الإعلانات' },
  { key: 'files', icon: 'file', en: 'Files', ar: 'الملفات' },
  { key: 'tasks', icon: 'check-circle', en: 'Tasks', ar: 'المهام' },
];

const isLate = (task) => {
  if (!task.due_date || task.status === 'done') return false;
  const d = parseServerDate(`${task.due_date}`.slice(0, 10));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
};

export default function StudentGroupHub() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [tab, setTab] = useState('timeline');
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [del, setDel] = useState(null); // { kind: 'announcements'|'files'|'tasks', id }

  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [fileDesc, setFileDesc] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('0');
  const [taskDue, setTaskDue] = useState('');

  usePageMeta(hub?.group_name || (ar ? 'مركز المجموعة' : 'Group Hub'), ar ? 'إعلانات، ملفات، ومهام مجموعتك في مكان واحد.' : "Your group's announcements, files, and tasks in one place.");

  const load = useCallback((silent) => {
    if (!silent) setLoading(true);
    return api.get('/api/v1/group-hub')
      .then((json) => setHub(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => { if (!silent) setLoading(false); });
  }, []);
  useEffect(() => { load(false); }, [load]);

  const run = async (fn) => {
    setActionError(null);
    try { await fn(); await load(true); } catch (err) { setActionError(errorMessage(err)); }
  };

  const postAnnouncement = (e) => {
    e.preventDefault();
    if (!annTitle.trim()) return;
    run(async () => {
      await api.post('/api/v1/group-hub/announcements', { title: annTitle, body: annBody });
      setAnnTitle(''); setAnnBody('');
    });
  };
  const uploadFile = (e) => {
    e.preventDefault();
    if (!file) return;
    run(async () => {
      const fd = new FormData();
      fd.append('file', file);
      if (fileDesc) fd.append('description', fileDesc);
      await api.postForm('/api/v1/group-hub/files', fd);
      setFile(null); setFileDesc(''); setFileKey((k) => k + 1);
    });
  };
  const createTask = (e) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    run(async () => {
      await api.post('/api/v1/group-hub/tasks', { title: taskTitle, assignee_user_id: taskAssignee, due_date: taskDue || undefined });
      setTaskTitle(''); setTaskAssignee('0'); setTaskDue('');
    });
  };
  const setStatus = (task, status) => run(() => api.patch(`/api/v1/group-hub/tasks/${task.id}/status`, { status }));
  const confirmDelete = async (reason) => {
    const { kind, id } = del;
    setActionError(null);
    try {
      await api.del(`/api/v1/group-hub/${kind}/${id}`, { reason });
      setDel(null);
      await load(true);
    } catch (err) {
      setDel(null);
      setActionError(errorMessage(err));
    }
  };

  const members = hub?.members || [];
  const announcements = hub?.announcements || [];
  const files = hub?.files || [];
  const tasks = hub?.tasks || [];
  const timeline = hub?.timeline || [];
  const byStatus = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s.key, tasks.filter((x) => x.status === s.key)])), [tasks]);
  const label = (s) => (ar ? s.ar : s.en);

  if (loading) return <SgSkeleton rows={3} h={120} />;
  if (error) return <div className="ex-page"><div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div></div>;
  if (!hub) return null;

  const openTasks = tasks.length - byStatus.done.length;
  const delTitle = del?.kind === 'announcements' ? (ar ? 'حذف الإعلان' : 'Delete announcement')
    : del?.kind === 'files' ? (ar ? 'حذف الملف' : 'Delete file') : (ar ? 'حذف المهمة' : 'Delete task');
  const timelineText = (type) => (type === 'announcement' ? t('posted an announcement:') : type === 'file' ? t('uploaded a file:') : type === 'task_done' ? t('completed a task:') : t('created a task:'));

  const empty = (icon, text) => (<div className="sg-empty-inline"><Icon name={icon} size={30} /><span>{text}</span></div>);

  return (
    <div className="ex-page">
      <div className="ex-kpis">
        <ExKpi label={ar ? 'الأعضاء' : 'Members'} value={members.length} sub={hub.group_name} icon="users" />
        <ExKpi label={ar ? 'مهام مفتوحة' : 'Open tasks'} value={openTasks} sub={ar ? `${byStatus.done.length} مكتملة` : `${byStatus.done.length} done`} icon="check-circle" tone={openTasks ? 'warn' : 'good'} />
        <ExKpi label={ar ? 'الملفات' : 'Files'} value={files.length} sub={ar ? 'مشاركة في المجموعة' : 'Shared with the group'} icon="file" />
        <ExKpi label={ar ? 'الإعلانات' : 'Announcements'} value={announcements.length} sub={ar ? 'منشورة للمجموعة' : 'Posted to the group'} icon="bell" />
      </div>

      {actionError && <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{actionError}</span></div>}

      <div className="sg-hub">
        <div className="ex-card">
          <div className="ex-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={`ex-tab${tab === x.key ? ' is-active' : ''}`} onClick={() => setTab(x.key)}>
                {ar ? x.ar : x.en}
              </button>
            ))}
          </div>

          <div className="sg-hub__body">
            {tab === 'timeline' && (timeline.length === 0 ? empty('clock', t('No activity yet.')) : (
              <ul className="sg-timeline">
                {timeline.map((tl, i) => (
                  <li key={`${tl.type}-${tl.at}-${i}`}>
                    <span className={`sg-tl__dot${tl.type === 'task_done' ? ' sg-tl__dot--good' : ''}`}><Icon name={TIMELINE_ICON[tl.type] || 'clock'} size={15} /></span>
                    <div className="sg-tl__text">
                      <strong>{tl.actor_name}</strong> <span>{timelineText(tl.type)}</span> <em>{tl.title}</em>
                      <span className="sg-tl__time">{relTime(tl.at, locale)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ))}

            {tab === 'announcements' && (
              <>
                <form className="sg-form sg-form--stack" onSubmit={postAnnouncement}>
                  <input className="ex-input" type="text" required maxLength={200} placeholder={t('Title')} value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} />
                  <textarea className="ex-textarea" rows={3} placeholder={t('Details (optional)')} value={annBody} onChange={(e) => setAnnBody(e.target.value)} />
                  <div><button type="submit" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> {t('Post')}</button></div>
                </form>
                {announcements.length === 0 ? empty('bell', t('No group announcements yet.')) : (
                  <div className="sg-feed">
                    {announcements.map((a) => (
                      <article key={a.id} className="sg-post">
                        <Avatar name={a.author_name} />
                        <div className="sg-post__main">
                          <div className="sg-post__head">
                            <div>
                              <h3 className="sg-post__title">{a.title}</h3>
                              <span className="sg-post__meta">{a.author_name} · {relTime(a.created_at, locale)}</span>
                            </div>
                            <button type="button" className="sg-icon-btn sg-icon-btn--danger" aria-label={ar ? 'حذف' : 'Delete'} onClick={() => setDel({ kind: 'announcements', id: a.id })}><Icon name="trash" size={15} /></button>
                          </div>
                          {a.body && <p className="sg-post__body">{a.body}</p>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'files' && (
              <>
                <form className="sg-form" onSubmit={uploadFile}>
                  <div className="sg-form__grow"><input key={fileKey} className="ex-input" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
                  <div className="sg-form__grow"><input className="ex-input" type="text" placeholder={t('Description (optional)')} value={fileDesc} onChange={(e) => setFileDesc(e.target.value)} /></div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!file}><Icon name="upload" size={14} /> {t('Upload')}</button>
                </form>
                {files.length === 0 ? empty('file', t('No shared files yet.')) : (
                  <div className="sg-files">
                    {files.map((f) => (
                      <div key={f.id} className="sg-file">
                        <span className="sg-file__icon"><Icon name="file" size={18} /></span>
                        <div className="sg-file__text">
                          <a className="sg-file__name" href={f.url || `/${f.file_path}`} target="_blank" rel="noopener noreferrer">{f.original_name}</a>
                          <span className="sg-file__meta">{[f.size_bytes ? fmtBytes(f.size_bytes) : null, f.uploader_name, relTime(f.created_at, locale)].filter(Boolean).join(' · ')}</span>
                          {f.description && <span className="sg-file__meta">{f.description}</span>}
                        </div>
                        <a className="sg-icon-btn" href={f.url || `/${f.file_path}`} target="_blank" rel="noopener noreferrer" aria-label={ar ? 'تنزيل' : 'Download'}><Icon name="download" size={16} /></a>
                        <button type="button" className="sg-icon-btn sg-icon-btn--danger" aria-label={ar ? 'حذف' : 'Delete'} onClick={() => setDel({ kind: 'files', id: f.id })}><Icon name="trash" size={15} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'tasks' && (
              <>
                <form className="sg-form" onSubmit={createTask}>
                  <div className="sg-form__grow"><input className="ex-input" type="text" required maxLength={200} placeholder={t('Task title')} value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} /></div>
                  <div className="sg-form__sm">
                    <select className="ex-select" style={{ width: '100%' }} value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)} aria-label={ar ? 'المكلّف' : 'Assignee'}>
                      <option value="0">{t('Unassigned')}</option>
                      {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                    </select>
                  </div>
                  <div className="sg-form__sm"><input className="ex-input" type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} aria-label={t('Due')} /></div>
                  <button type="submit" className="btn btn-primary btn-sm"><Icon name="plus" size={14} /> {t('Add')}</button>
                </form>
                {tasks.length === 0 ? empty('check-circle', t('No tasks yet.')) : (
                  <div className="sg-board">
                    {STATUSES.map((s) => (
                      <section key={s.key} className={`sg-col sg-col--${s.key}`}>
                        <div className="sg-col__head"><span>{label(s)}</span><b>{byStatus[s.key].length}</b></div>
                        {byStatus[s.key].map((task) => (
                          <article key={task.id} className={`sg-task${task.status === 'done' ? ' is-done' : ''}`}>
                            <h4 className="sg-task__title">{task.title}</h4>
                            <div className="sg-task__meta">
                              <span className="sg-task__who">
                                {task.assignee_name ? <Avatar name={task.assignee_name} size="sm" /> : <Icon name="user" size={14} />}
                                {task.assignee_name || t('Unassigned')}
                              </span>
                              {task.due_date && (
                                <span className={`sg-due${isLate(task) ? ' is-late' : ''}`}><Icon name="calendar" size={12} /> {String(task.due_date).slice(0, 10)}</span>
                              )}
                            </div>
                            <div className="sg-task__foot">
                              <select className="ex-select" value={task.status} onChange={(e) => setStatus(task, e.target.value)} aria-label={ar ? 'الحالة' : 'Status'}>
                                {STATUSES.map((o) => <option key={o.key} value={o.key}>{label(o)}</option>)}
                              </select>
                              <button type="button" className="sg-icon-btn sg-icon-btn--danger" aria-label={ar ? 'حذف' : 'Delete'} onClick={() => setDel({ kind: 'tasks', id: task.id })}><Icon name="trash" size={15} /></button>
                            </div>
                          </article>
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <aside className="sg-side-col">
          <Link to="/student/group-chat" className="btn btn-primary" style={{ justifyContent: 'center' }}><Icon name="message" size={16} /> {t('Group Chat')}</Link>
          <div className="ex-card sg-side">
            <h3>{ar ? 'أعضاء المجموعة' : 'Group members'} ({members.length})</h3>
            <div className="sg-side__list">
              {members.map((m) => (
                <div key={m.user_id} className="sg-side__row">
                  <Avatar name={m.full_name} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <strong>{m.full_name}</strong>
                    {m.email && <small>{m.email}</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {del && <DeleteModal ar={ar} title={delTitle} onClose={() => setDel(null)} onConfirm={confirmDelete} />}
    </div>
  );
}
