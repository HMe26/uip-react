import { useTranslations } from '../../context/LanguageContext';
import i18nCommon from '../../i18n/common';
import i18nMeetings from '../../i18n/shared/meetings';

const translations = { ...i18nCommon, ...i18nMeetings };

/** iOS-style switch row used for waiting room / guests in the create + edit dialogs. */
export function ToggleRow({ checked, onChange, title, hint }) {
  return (
    <label className="mtg-toggle">
      <span className="mtg-toggle__txt"><strong>{title}</strong>{hint && <span>{hint}</span>}</span>
      <span className="mtg-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="mtg-switch__track" />
      </span>
    </label>
  );
}

const PRESETS = [30, 60, 90, 120];

/**
 * Meeting length picker. `value` is `null` for an open-ended meeting (no end time — it stays open until the host ends it),
 * otherwise a number of minutes. Open-ended is a first-class choice, not a hidden default.
 */
export function DurationPicker({ value, onChange }) {
  const t = useTranslations(translations);
  const openEnded = value === null;
  const isPreset = !openEnded && PRESETS.includes(Number(value));
  const isCustom = !openEnded && !isPreset;

  return (
    <div className="mtg-duration">
      <div className="mtg-chips" role="group" aria-label={t('Duration')}>
        <button type="button" className={`mtg-chip ${openEnded ? 'is-on' : ''}`} onClick={() => onChange(null)}>{t('Open-ended')}</button>
        {PRESETS.map((m) => (
          <button key={m} type="button" className={`mtg-chip ${Number(value) === m ? 'is-on' : ''}`} onClick={() => onChange(m)}>
            {m} {t('min')}
          </button>
        ))}
        <button type="button" className={`mtg-chip ${isCustom ? 'is-on' : ''}`} onClick={() => onChange(isCustom ? value : 45)}>{t('Custom')}</button>
      </div>
      {isCustom && (
        <div className="mtg-field">
          <label>{t('Duration (minutes)')}</label>
          <input className="form-input" type="number" min="5" required value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        </div>
      )}
      <p className="mtg-hint">
        {openEnded
          ? t('No end time — the meeting stays open until the host ends it.')
          : t('The duration is a planning estimate; the meeting is never cut off automatically.')}
      </p>
    </div>
  );
}

/** Value to send to the API: null (open-ended) or a whole number >= 5. */
export function durationPayload(value) {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 5 ? Math.round(n) : null;
}
