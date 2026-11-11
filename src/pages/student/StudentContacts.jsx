import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import Icon from '../../components/Icon';
import { useTranslations, useLanguage } from '../../context/LanguageContext';
import { usePageMeta } from '../../context/PageMetaContext';
import { Avatar, MessageModal, SgSkeleton } from '../../components/student/groupUi';
import { EmptyState } from '../../components/student/stUi';
import i18nCommon from '../../i18n/common';
import i18nPage from '../../i18n/student/contacts';

const translations = { ...i18nCommon, ...i18nPage };

/**
 * Student "My Contacts": GET /api/v1/contacts
 * (ContactsApiController::index() — hierarchy, university, faculty, head of
 * department, supervisors, group members). "Message" opens a proper modal and
 * starts the chat via POST /api/v1/messaging/conversations/direct, then hands
 * off to /student/messages. Styles: styles/css/student-groups.css (sg-*).
 */
export default function StudentContacts() {
  const t = useTranslations(translations);
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const navigate = useNavigate();
  usePageMeta(t('My Contacts'), t('Your university, faculty, department, supervisors, and group members — all in one place.'));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [target, setTarget] = useState(null); // { email, name }

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get('/api/v1/contacts')
      .then((json) => setData(json.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (body) => {
    try {
      await api.post('/api/v1/messaging/conversations/direct', { recipient_email: target.email, body });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
    setTarget(null);
    navigate('/student/messages');
  };

  if (loading) return <SgSkeleton rows={3} h={110} />;
  if (error) {
    return (
      <div className="ex-page">
        <div className="st-alert st-alert--danger"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>
      </div>
    );
  }
  if (!data) return null;

  const { hierarchy, university, faculty, department_head: head, supervisors = [], group_members: members = [] } = data;
  const pick = (obj, en, a) => (ar ? obj?.[a] : obj?.[en]) || obj?.[en] || obj?.[a] || '—';

  if (!hierarchy) {
    return (
      <div className="ex-page">
        <div className="ex-card">
          <EmptyState icon="building" title={t('No institutional data is linked to your account yet.')} />
        </div>
      </div>
    );
  }

  const chain = [
    { label: t('University'), value: pick(hierarchy, 'university_name_en', 'university_name_ar') },
    { label: t('Faculty'), value: pick(hierarchy, 'faculty_name_en', 'faculty_name_ar') },
    { label: t('Department'), value: pick(hierarchy, 'department_name_en', 'department_name_ar') },
  ];
  const meta = [
    { label: t('Academic Year'), value: hierarchy.academic_year ?? '—' },
    { label: t('Semester'), value: hierarchy.current_semester ?? '—' },
    { label: t('Group'), value: hierarchy.group_name || '—' },
  ];

  const ContactCard = ({ role, name, email, emptyText }) => {
    if (!name) {
      return (
        <div className="sg-contact sg-contact--empty">
          <span className="sg-contact__role">{role}</span>
          <p>{emptyText}</p>
        </div>
      );
    }
    return (
      <div className="sg-contact">
        <div className="sg-contact__top">
          <Avatar name={name} size="lg" />
          <div className="sg-contact__text">
            <span className="sg-contact__role">{role}</span>
            <span className="sg-contact__name" title={name}>{name}</span>
            <span className="sg-contact__mail" title={email}><bdi>{email}</bdi></span>
          </div>
        </div>
        <div className="sg-contact__foot">
          <button type="button" className="btn btn-primary btn-sm" disabled={!email} onClick={() => setTarget({ email, name })}>
            <Icon name="message" size={14} /> {t('Message')}
          </button>
          {email && (
            <a className="btn btn-outline btn-sm" href={`mailto:${email}`}><Icon name="mail" size={14} /> {ar ? 'بريد' : 'Email'}</a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ex-page">
      <div className="ex-card">
        <div className="ex-card__head">
          <div>
            <h2 className="ex-card__title">{t('Institutional Chain')}</h2>
            <p className="ex-card__sub">{meta.map((m) => `${m.label}: ${m.value}`).join('  ·  ')}</p>
          </div>
        </div>
        <div className="sg-chain">
          {chain.map((s) => (
            <div key={s.label} className="sg-step">
              <span className="sg-step__label">{s.label}</span>
              <span className="sg-step__value">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sg-section-title">{ar ? 'الإدارة والإشراف' : 'Administration & supervision'}</div>
      <div className="sg-grid">
        <ContactCard
          role={t('University')}
          name={university ? pick(university, 'name_en', 'name_ar') : ''}
          email={university?.email}
          emptyText={t('No linked university account.')}
        />
        <ContactCard
          role={t('Faculty')}
          name={faculty ? pick(faculty, 'name_en', 'name_ar') : ''}
          email={faculty?.email}
          emptyText={t('No linked faculty account.')}
        />
        <ContactCard
          role={t('Head of Department')}
          name={head?.full_name}
          email={head?.email}
          emptyText={t('No Head of Department currently assigned.')}
        />
        {supervisors.length === 0 ? (
          <ContactCard role={t('Supervisors')} name="" emptyText={t('No supervisor currently assigned to you.')} />
        ) : supervisors.map((sup) => (
          <ContactCard key={sup.id || sup.email} role={ar ? 'مشرف' : 'Supervisor'} name={sup.full_name} email={sup.email} />
        ))}
      </div>

      <div className="sg-section-title">{t('My Group Members')} <span>{hierarchy.group_id ? `(${members.length})` : ''}</span></div>
      <div className="ex-card">
        {!hierarchy.group_id ? (
          <EmptyState icon="users" title={ar ? 'لست عضوًا في مجموعة مشروع بعد.' : "You're not part of a project group yet."} />
        ) : members.length === 0 ? (
          <EmptyState icon="users" title={t('No other members in your group yet.')} />
        ) : (
          <div className="sg-grid" style={{ padding: 16 }}>
            {members.map((m) => (
              <div key={m.user_id || m.email} className="sg-person">
                <Avatar name={m.full_name} />
                <div className="sg-person__text">
                  <span className="sg-person__name">{m.full_name || ''}</span>
                  {m.email && <span className="sg-person__mail"><bdi>{m.email}</bdi></span>}
                </div>
                {m.email && (
                  <button type="button" className="sg-icon-btn" aria-label={t('Message')} title={t('Message')} onClick={() => setTarget({ email: m.email, name: m.full_name || '' })}>
                    <Icon name="message" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="sg-contacts-foot" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span>{t('Want to message a student outside your group?')}</span>
          <Link to="/student/messages" className="btn btn-outline btn-sm"><Icon name="message-square" size={14} /> {ar ? 'فتح الرسائل' : 'Open Messages'}</Link>
        </div>
      </div>

      {target && <MessageModal ar={ar} name={target.name} onClose={() => setTarget(null)} onSend={send} />}
    </div>
  );
}
