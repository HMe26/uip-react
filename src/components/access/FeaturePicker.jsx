import { FEATURE_LABELS } from './accessShared';
import { useL } from '../admin/meetingsControl/shared';

/** Checkbox list of grantable features. "Everything" is exclusive. value: string[] */
export default function FeaturePicker({ value, onChange }) {
  const { ar } = useL();
  const all = value.includes('all');
  const toggle = (k) => {
    if (k === 'all') return onChange(all ? [] : ['all']);
    const next = value.includes(k) ? value.filter((x) => x !== k) : [...value.filter((x) => x !== 'all'), k];
    return onChange(next);
  };
  return (
    <div className="mtc-stack" role="group">
      {Object.keys(FEATURE_LABELS).map((k) => (
        <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', opacity: all && k !== 'all' ? 0.5 : 1 }}>
          <input type="checkbox" checked={k === 'all' ? all : (all || value.includes(k))} disabled={all && k !== 'all'} onChange={() => toggle(k)} />
          {FEATURE_LABELS[k][ar ? 1 : 0]}
        </label>
      ))}
    </div>
  );
}
