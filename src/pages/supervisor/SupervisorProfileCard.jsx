import Icon from '../../components/Icon';
import { PersonProfile, ProfileBlock, useTr } from '../../components/settings/IdentityProfile';

/**
 * Supervisor Profile section. The supervisor edits their own name, phone,
 * academic title and department (PATCH /api/v1/supervisor/settings/profile);
 * email, permissions, supervision scope and status stay with the inviting
 * university. Layout/design: components/settings/IdentityProfile.jsx.
 */
const SCOPE_LABEL = {
  faculty: ['Faculty', 'كلية'], department: ['Department', 'قسم'], group: ['Group', 'مجموعة'],
  project: ['Project', 'مشروع'], academic_year: ['Academic year', 'سنة دراسية'],
};

export default function SupervisorProfileCard({ supervisor, profile, scopes, permissions, myPermissions, scopeLabel, endpoint, avatarEndpoint }) {
  const { ar, tr } = useTr();

  if (!supervisor) {
    return <div className="sp-empty"><Icon name="alert-triangle" size={22} />{tr('Your account is not currently active.', 'حسابك غير نشط حاليًا.')}</div>;
  }

  // roster row (title/department/status) + the account row (phone/photo/names)
  const row = { ...supervisor, ...profile };

  return (
    <PersonProfile
      profile={row}
      endpoint={endpoint}
      eyebrow={tr('Academic Staff · Supervisor', 'الهيئة التدريسية · مشرف')}
      subtitle={(p) => [p.title, p.department].filter(Boolean).join(' — ') || tr('Supervisor', 'مشرف')}
      status={supervisor.status}
      avatar={{ endpoint: avatarEndpoint }}
      fields={[
        { key: 'phone', label: tr('Phone', 'رقم التليفون'), ltr: true, maxLength: 30, placeholder: '+20 100 000 0000' },
        { key: 'title', label: tr('Academic title', 'اللقب الأكاديمي'), maxLength: 100, placeholder: tr('e.g. Dr., Prof.', 'مثال: د.، أ.د.') },
        { key: 'department', label: tr('Department', 'القسم'), maxLength: 150 },
      ]}
      managed={[
        { icon: 'mail', label: tr('Email', 'البريد الإلكتروني'), value: row.email, ltr: true },
      ]}
      managedNote={tr('Your email, permissions and supervision scope are managed by your university.', 'البريد الإلكتروني والصلاحيات ونطاق الإشراف تُدار من جامعتك.')}
    >
      <div className="sp-two">
        <ProfileBlock
          title={tr('Permissions', 'الصلاحيات')}
          count={`${myPermissions.filter((k) => permissions.some((p) => p.key === k)).length} / ${permissions.length}`}
        >
          <ul className="sp-perms">
            {permissions.map((p) => {
              const on = myPermissions.includes(p.key);
              return (
                <li key={p.key} className={on ? 'is-on' : 'is-off'}>
                  <span className="sp-perms__mark"><Icon name={on ? 'check' : 'x'} size={13} /></span>
                  {ar ? p.ar : p.en}
                </li>
              );
            })}
          </ul>
        </ProfileBlock>

        <ProfileBlock title={tr('Supervision scope', 'نطاق الإشراف')}>
          {scopes.length === 0 ? (
            <p className="sp-muted">{tr('No scope assigned yet.', 'لا يوجد نطاق مُسند بعد.')}</p>
          ) : (
            <ul className="sp-scopes">
              {scopes.map((s, i) => {
                const l = SCOPE_LABEL[s.scope_type];
                return (
                  <li key={i}>
                    <span className="sp-scopes__type">{l ? l[ar ? 1 : 0] : s.scope_type}</span>
                    <span className="sp-scopes__name">{scopeLabel(s)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </ProfileBlock>
      </div>
    </PersonProfile>
  );
}
