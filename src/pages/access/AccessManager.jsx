import { useState } from 'react';
import AdminPage, { Chips } from '../../components/admin/AdminPage';
import { useL } from '../../components/admin/meetingsControl/shared';
import AccountsTab from '../../components/access/AccountsTab';
import GrantsTab from '../../components/access/GrantsTab';
import ExemptionsTab from '../../components/access/ExemptionsTab';
import PlansTab from '../../components/access/PlansTab';
import { useAuth } from '../../context/AuthContext';

/**
 * Access & Pricing — shared by the admin, university and faculty portals (/admin|university|faculty/access).
 * Lets the signed-in manager keep a price list (plans), give an account that is NOT linked to a university access to
 * messaging / meetings / projects / My PC / … for a price and a period, and follow, confirm, extend or withdraw those grants.
 * Talks to /api/v1/access/* (AccountAccessApiController). The server scopes everything: the admin sees all grants,
 * a university / faculty only its own plans and grants.
 */
export default function AccessManager() {
  const { L } = useL();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('accounts');
  const [bump, setBump] = useState(0);
  return (
    <AdminPage icon="lock" title={L('Access & Pricing', 'الصلاحيات والأسعار')}
      subtitle={L('Let an account that is not linked to a university use the platform — for free or for a fee, for a set period.',
        'اسمح لحساب مش مرتبط بجامعة إنه يستخدم المنصة — مجانًا أو بمبلغ، ولمدة محددة.')}>
      <Chips value={tab} onChange={setTab} label={L('Section', 'القسم')} options={[
        ['accounts', L('Accounts', 'الحسابات')], ['grants', L('Grants', 'المنح')], ['plans', L('Price list', 'قايمة الأسعار')],
        ...(isAdmin ? [['exemptions', L('Exemptions', 'الاستثناءات')]] : []),
      ]} />
      {tab === 'accounts' && <AccountsTab onGranted={() => setBump((b) => b + 1)} />}
      {tab === 'grants' && <GrantsTab refreshKey={bump} />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'exemptions' && isAdmin && <ExemptionsTab />}
    </AdminPage>
  );
}
