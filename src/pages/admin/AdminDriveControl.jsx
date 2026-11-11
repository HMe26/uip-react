import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminPage from '../../components/admin/AdminPage';
import { useL } from '../../components/admin/meetingsControl/shared';
import OverviewTab from '../../components/admin/driveControl/OverviewTab';
import UsersTab from '../../components/admin/driveControl/UsersTab';
import FilesTab from '../../components/admin/driveControl/FilesTab';
import SharesTab from '../../components/admin/driveControl/SharesTab';
import SettingsTab from '../../components/admin/driveControl/SettingsTab';
import AuditTab from '../../components/admin/driveControl/AuditTab';
import SearchTestPanel from '../../components/admin/driveControl/SearchTestPanel';
import HealthTab from '../../components/admin/driveControl/HealthTab';

/**
 * Admin → My PC Control. One place to run "My PC" for the whole platform:
 *   Overview · Users & quotas · All files · Share links · Features & system · Search & browser · Rules & limits · Activity log · Storage health.
 * Talks to /api/v1/admin/drive/control/* (AdminDriveControlApiController). The active tab lives in the URL (?tab=…).
 */
export default function AdminDriveControl() {
  const { L } = useL();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'overview');

  const TABS = [
    ['overview', L('Overview', 'نظرة عامة')],
    ['users', L('Users & quotas', 'المستخدمين والحصص')],
    ['files', L('All files', 'كل الملفات')],
    ['shares', L('Share links', 'روابط المشاركة')],
    ['features', L('Features & system', 'المفاتيح والنظام')],
    ['tools', L('Search & browser', 'البحث والمتصفح')],
    ['rules', L('Rules & limits', 'القواعد والحدود')],
    ['audit', L('Activity log', 'سجل النشاط')],
    ['health', L('Storage health', 'سلامة التخزين')],
  ];

  function go(next) {
    setTab(next);
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  }

  return (
    <AdminPage icon="hard-drive" title={L('My PC Control', 'التحكم في جهازي')}
      subtitle={L('Run My PC for the whole platform: system switches, quotas and limits, every user’s files, share links, the recycle bins and the audit trail.', 'تحكم كامل في جهازي: المفاتيح، الحصص والحدود، ملفات كل مستخدم، روابط المشاركة، المحذوفات وسجل النشاط.')}>
      <div className="mtc-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`mtc-tab${tab === k ? ' is-active' : ''}`} onClick={() => go(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab onGoto={go} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'files' && <FilesTab />}
        {tab === 'shares' && <SharesTab />}
        {tab === 'features' && <SettingsTab key="features" groups={['system', 'features', 'admin']} />}
        {tab === 'tools' && <SettingsTab key="tools" groups={['tools']} footer={{ tools: (ctx) => <SearchTestPanel {...ctx} /> }} />}
        {tab === 'rules' && <SettingsTab key="rules" groups={['access', 'limits', 'versions', 'uploads', 'sharing']} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'health' && <HealthTab />}
      </div>
    </AdminPage>
  );
}
