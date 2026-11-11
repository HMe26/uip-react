import Icon from './Icon';

/**
 * Mandatory approval path: supervisor doctor → faculty → university, then (separately) publish.
 * Driven by the API's `flow` object ({ stages:[{stage,state}], awaiting, supervisor_unlinked }) and the
 * project status. States: approved | awaiting | pending | skipped. "Approved" ≠ "Published".
 */
const LABEL = {
  supervisor_review: { en: 'Supervisor doctor', ar: 'الدكتور المشرف' },
  faculty_review: { en: 'Faculty', ar: 'الكلية' },
  university_review: { en: 'University', ar: 'الجامعة' },
};

export const STAGE_LABEL = (stage, ar) => (LABEL[stage] ? LABEL[stage][ar ? 'ar' : 'en'] : stage);

export default function ApprovalStages({ flow, status, ar, compact = false }) {
  if (!flow || !Array.isArray(flow.stages)) return null;
  const submitted = status === 'submitted';
  const approved = status === 'approved' || status === 'published';
  const published = status === 'published';

  const rows = flow.stages.map((s) => ({ key: s.stage, state: s.state, label: STAGE_LABEL(s.stage, ar) }));
  rows.push({
    key: 'publish',
    state: published ? 'approved' : approved ? 'awaiting' : 'pending',
    label: ar ? 'النشر للعامة' : 'Published to the public',
    note: approved && !published ? (ar ? 'جاهز للنشر' : 'Ready to publish') : null,
  });

  const cls = (st) => (st === 'approved' ? 'is-done' : st === 'awaiting' ? 'is-now' : '');
  const icon = (st) => (st === 'approved' ? 'check' : st === 'awaiting' ? 'clock' : 'more-horizontal');

  return (
    <div>
      <ol className="um-flow">
        {rows.map((r) => (
          <li key={r.key} className={cls(r.state)} style={r.state === 'skipped' ? { opacity: 0.55 } : undefined}>
            <span className="um-flow__dot"><Icon name={icon(r.state)} size={14} /></span>
            <span>
              {r.label}
              {r.state === 'skipped' && <small style={{ marginInlineStart: 8 }}>{ar ? '(غير مطلوبة)' : '(not required)'}</small>}
              {r.state === 'awaiting' && submitted && <small style={{ marginInlineStart: 8 }}>{ar ? '(بانتظار القرار)' : '(awaiting decision)'}</small>}
              {r.note && <small style={{ marginInlineStart: 8 }}>({r.note})</small>}
            </span>
          </li>
        ))}
      </ol>
      {!compact && flow.supervisor_unlinked && (
        <p className="um-panel__sub" style={{ marginTop: 10 }}>
          {ar
            ? 'اسم المشرف المكتوب لم يُربط بحساب دكتور واحد في الجامعة، لذلك تم تخطي مرحلة المشرف. يمكن للطالب إضافة الدكتور من البحث.'
            : 'The typed supervisor name did not match a single doctor account, so the supervisor stage was skipped. The student can add the doctor via search.'}
        </p>
      )}
    </div>
  );
}
