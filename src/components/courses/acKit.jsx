import Icon from '../Icon';

/**
 * Shared building blocks for the academic pages (courses, fees, grades, attendance, timetable...).
 * Styles: styles/css/academic-ui.css (acx-*), on top of the portal's st-* design.
 */

export function AcPage({ children }) {
  return <div className="acx-page">{children}</div>;
}

export function AcHead({ title, text, children }) {
  return (
    <div className="acx-head">
      <div className="acx-head__text">
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      {children && <div className="acx-head__actions">{children}</div>}
    </div>
  );
}

export function AcAlerts({ error, notice }) {
  return (
    <>
      {error && <div className="st-alert st-alert--danger" role="alert"><Icon name="alert-triangle" size={16} /><span>{error}</span></div>}
      {notice && <div className="st-alert st-alert--success" role="status"><Icon name="check-circle" size={16} /><span>{notice}</span></div>}
    </>
  );
}

/** items: [{label, value, icon, tone: 'good'|'warn'|'bad', meta}] */
export function AcKpis({ items }) {
  return (
    <div className="acx-kpis">
      {items.map((k) => (
        <div key={k.label} className={`st-kpi acx-kpi${k.tone ? ` acx-kpi--${k.tone}` : ''}`}>
          {k.icon && <span className="acx-kpi__ic"><Icon name={k.icon} size={18} /></span>}
          <span className="st-kpi__label">{k.label}</span>
          <span className="st-kpi__value">{k.value}</span>
          {k.meta != null && k.meta !== '' && <span className="st-kpi__meta">{k.meta}</span>}
        </div>
      ))}
    </div>
  );
}

export function AcPanel({ title, sub, tools, flush, foot, children }) {
  return (
    <section className="acx-panel">
      {(title || tools) && (
        <div className="acx-panel__head">
          <div className="acx-panel__title">{typeof title === 'string' ? <b>{title}</b> : title}{sub && <small>{sub}</small>}</div>
          {tools && <div className="acx-panel__tools">{tools}</div>}
        </div>
      )}
      {flush ? children : <div className="acx-panel__body">{children}</div>}
      {foot && <div className="acx-panel__foot">{foot}</div>}
    </section>
  );
}

/** items: [[label, value], ...] */
export function AcNums({ items, inline }) {
  return (
    <ul className={`acx-nums${inline ? ' acx-nums--inline' : ''}`}>
      {items.map(([label, value]) => <li key={label}><span>{label}</span><b>{value}</b></li>)}
    </ul>
  );
}

export function AcTable({ children }) {
  return <div className="acx-table-wrap"><table className="acx-table">{children}</table></div>;
}

export function AcField({ label, children }) {
  return <label className="acx-field"><span>{label}</span>{children}</label>;
}
