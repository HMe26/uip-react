import Icon from '../Icon';
import { ago } from '../feed/feedUi';
import { PAvatar, useTt } from '../posts/shared';
import PersonActions from './PersonActions';

export const ROLE_LABEL = {
  student: ['Student', 'طالب'], academic_staff: ['Academic staff', 'هيئة تدريس'], faculty: ['Faculty', 'كلية'], university: ['University', 'جامعة'],
  supervisor: ['Supervisor', 'مشرف'], admin: ['Administrator', 'مسؤول'], data_analyst: ['Data analyst', 'محلل بيانات'], security_admin: ['Security', 'أمن'], security_officer: ['Security', 'أمن'],
};

export function roleText(role, tt) {
  if (!role) return '';
  const l = ROLE_LABEL[role];
  return l ? tt(l[0], l[1]) : String(role).replace(/_/g, ' ');
}

/** One person as a row (lists) or a card (suggestions grid). */
export default function PersonCard({ p, mode = 'default', variant = 'row', onPatch, onRemove, onOpen }) {
  const { tt, locale } = useTt();
  const org = locale === 'ar' ? (p.org_ar || p.org_en) : (p.org_en || p.org_ar);
  const meta = [roleText(p.role, tt), org].filter(Boolean).join(' · ');
  return (
    <li className={`nw-person nw-person--${variant}`}>
      <button type="button" className="nw-person__av" onClick={() => onOpen?.(p)} aria-label={p.full_name}><PAvatar user={p} size={variant === 'card' ? 72 : 52} /></button>
      <div className="nw-person__main">
        <button type="button" className="nw-person__name" onClick={() => onOpen?.(p)}>{p.full_name}</button>
        {meta && <small className="nw-person__meta">{meta}</small>}
        {p.mutual_connections > 0 && <small className="nw-person__mutual"><Icon name="users" size={12} /> {tt(`${p.mutual_connections} mutual connection${p.mutual_connections > 1 ? 's' : ''}`, `${p.mutual_connections} اتصال مشترك`)}</small>}
        {p.follows_me && !p.is_following && mode !== 'received' && <small className="nw-person__tag">{tt('Follows you', 'يتابعك')}</small>}
        {p.message && <q className="nw-person__quote" dir="auto">{p.message}</q>}
        {p.at && mode !== 'default' && <small className="nw-person__time">{ago(p.at, locale)}</small>}
      </div>
      <PersonActions p={p} mode={mode} onPatch={onPatch} onRemove={onRemove} onOpenProfile={onOpen} />
    </li>
  );
}
