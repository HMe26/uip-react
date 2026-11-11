import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import AdminPage from '../../components/admin/AdminPage';
import { useL } from '../../components/admin/meetingsControl/shared';
import OverviewTab from '../../components/admin/meetingsControl/OverviewTab';
import MeetingsTab from '../../components/admin/meetingsControl/MeetingsTab';
import SettingsTab from '../../components/admin/meetingsControl/SettingsTab';
import UsersTab from '../../components/admin/meetingsControl/UsersTab';
import AuditTab from '../../components/admin/meetingsControl/AuditTab';

/**
 * Admin → Meetings Control. One place to run the whole meetings system:
 *   Overview · Meetings (list + per-meeting control) · Features & system · Rules & limits · Blocked creators · Activity log.
 * Talks to /api/v1/admin/meetings/control/* (AdminMeetingsControlApiController). The active tab and the open meeting
 * live in the URL (?tab=…&meeting=<uuid>) so a refresh or a shared link lands on the same view.
 */
export default function AdminMeetingsControl() {
  const { L } = useL();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'overview');
  const meeting = params.get('meeting'); // old links (?meeting=<uuid>) now land on the meeting's own page

  const TABS = [
    ['overview', L('Overview', 'نظرة عامة'), 'dashboard'],
    ['meetings', L('Meetings', 'الاجتماعات'), 'video'],
    ['features', L('Features & system', 'المفاتيح والنظام'), 'shield'],
    ['rules', L('Rules & limits', 'القواعد والحدود'), 'settings'],
    ['video', L('Video servers', 'سيرفرات الفيديو'), 'video'],
    ['users', L('Blocked creators', 'المحظورين'), 'user-x'],
    ['audit', L('Activity log', 'سجل النشاط'), 'clock'],
  ];

  function go(next) {
    setTab(next);
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  }

  if (meeting) return <Navigate to={`/admin/meetings-control/${meeting}`} replace />;

  return (
    <AdminPage icon="video" title={L('Meetings Control', 'التحكم في الاجتماعات')}
      subtitle={L('Run the entire meetings system: switches, limits, every live and past meeting, participants, files, recordings and the audit trail.', 'تحكم كامل في نظام الاجتماعات: المفاتيح، الحدود، كل الاجتماعات الشغالة والسابقة، المشاركين، الملفات، التسجيلات وسجل النشاط.')}>
      <div className="mtc-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`mtc-tab${tab === k ? ' is-active' : ''}`} onClick={() => go(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab onGoto={go} />}
        {tab === 'meetings' && <MeetingsTab />}
        {tab === 'features' && <SettingsTab key="features" groups={['system', 'features']} />}
        {tab === 'rules' && <SettingsTab key="rules" groups={['creation', 'limits', 'access', 'defaults', 'recording']} />}
        {tab === 'video' && <SettingsTab key="video" groups={['video']} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </AdminPage>
  );
}
