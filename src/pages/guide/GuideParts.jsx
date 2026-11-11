import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { pickPair, pickText, ROLE_OPTIONS } from './guideUtils';

/* ───────────────────────── plain-text → safe React ───────────────────────── */

/** **bold** and `code` inside one line. Everything else is rendered as text (no HTML is ever injected). */
function inline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={`${keyBase}-${i}`} className="gd-code">{part.slice(1, -1)}</code>;
    return <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>;
  });
}

/** Paragraphs, "- " bullets, **bold**, `code`. Used for every long text of the guide. */
export function Rich({ text, className = '' }) {
  const blocks = String(text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (!blocks.length) return null;
  return (
    <div className={`gd-rich ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*([-•*])\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-•*])\s+/, ''), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── small bits ───────────────────────────── */

export function GuideBadge({ tone = 'neutral', icon, children, title }) {
  return (
    <span className={`gd-badge gd-badge--${tone}`} title={title}>
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

function roleLabels(roles, locale) {
  return (roles || []).map((r) => {
    const hit = ROLE_OPTIONS.find((o) => o.key === r);
    return hit ? hit[locale] : r;
  }).join(' · ');
}

/** "Where is it?" — the route as a path chip. */
function WhereChip({ route, tx }) {
  if (!route) return null;
  return (
    <span className="gd-where" title={tx.where}>
      <Icon name="route" size={13} />
      <bdi dir="ltr">{route}</bdi>
    </span>
  );
}

/* ───────────────────────────── item card ───────────────────────────── */

/**
 * One explained thing (a sidebar page, a task, a question).
 *   variant: 'page' (accordion) | 'faq' (question → answer) | 'overview' (always open)
 * `tools` is the edit-mode toolbar, rendered by the page.
 */
export function ItemCard({ item, tx, locale, variant = 'page', open, onToggle, tools, preview = false, onCopyLink }) {
  const title = pickText(item, 'title', locale);
  const summary = pickText(item, 'summary', locale);
  const body = pickText(item, 'body', locale);
  const steps = item.steps || [];
  const tips = item.tips || [];
  const faq = variant === 'faq';
  const hasDetails = !!(body || steps.length || tips.length || (faq && summary));
  const alwaysOpen = variant === 'overview';
  const isOpen = alwaysOpen || (hasDetails && open);
  const locked = !!item.locked;
  const audience = roleLabels(item.audience_roles, locale);
  const canToggle = hasDetails && !alwaysOpen;

  const head = (
    <>
      <span className="gd-item__icon" aria-hidden="true">
        <Icon name={faq ? 'help-circle' : (item.icon || 'file')} size={faq ? 18 : 20} />
      </span>
      <span className="gd-item__main">
        <span className="gd-item__titleRow">
          <h3 className="gd-item__title">{title}</h3>
          {locked && <GuideBadge tone="warn" icon="lock" title={tx.lockedHint}>{tx.lockedBadge}</GuideBadge>}
          {item.is_hidden && <GuideBadge tone="muted" icon="eye-off">{tx.hidden}</GuideBadge>}
          {item.is_custom && <GuideBadge tone="info" icon="sparkles">{tx.custom}</GuideBadge>}
        </span>
        {summary && !faq && <span className="gd-item__summary">{summary}</span>}
        {!faq && <WhereChip route={item.route} tx={tx} />}
      </span>
    </>
  );

  return (
    <article
      id={preview ? undefined : `g-${item.key}`}
      className={[
        'gd-item', `gd-item--${variant}`,
        isOpen ? 'is-open' : '', locked ? 'is-locked' : '', item.is_hidden ? 'is-hidden' : '',
        canToggle ? 'is-toggle' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="gd-item__head">
        {canToggle ? (
          <button type="button" className="gd-item__toggle" aria-expanded={isOpen} onClick={onToggle}>
            {head}
            <span className="gd-item__chev" aria-hidden="true"><Icon name="chevron-down" size={18} /></span>
          </button>
        ) : (
          <div className="gd-item__toggle gd-item__toggle--static">{head}</div>
        )}
        {tools && <div className="gd-item__tools">{tools}</div>}
      </div>

      <div className="gd-item__panel" data-open={isOpen ? 'true' : 'false'}>
        <div className="gd-item__panelInner">
          <div className="gd-item__details">
            {faq && summary && <Rich text={summary} className="gd-item__answer" />}
            {body && <Rich text={body} />}

            {steps.length > 0 && (
              <div className="gd-steps">
                <div className="gd-subhead"><Icon name="list-checks" size={15} /> {tx.steps}</div>
                <ol>
                  {steps.map((s, i) => (
                    <li key={i}>
                      <span className="gd-steps__n">{i + 1}</span>
                      <Rich text={pickPair(s, locale)} />
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {tips.length > 0 && (
              <div className="gd-tips">
                <div className="gd-subhead"><Icon name="sparkles" size={15} /> {tx.tips}</div>
                <ul>
                  {tips.map((s, i) => <li key={i}><Rich text={pickPair(s, locale)} /></li>)}
                </ul>
              </div>
            )}

            {audience && <div className="gd-audience"><Icon name="users" size={13} /> {tx.audienceOnly}: {audience}</div>}
            {item.permission && <div className="gd-audience"><Icon name="key" size={13} /> {tx.permission}: <bdi dir="ltr"><code className="gd-code">{item.permission}</code></bdi></div>}
          </div>
        </div>
      </div>

      {(item.route || !preview) && (
        <div className="gd-item__foot">
          {item.route && !locked && !preview && (
            <Link className="gd-btn gd-btn--primary gd-btn--sm" to={item.route}>
              {tx.open} <Icon name={locale === 'ar' ? 'arrow-left' : 'arrow-right'} size={14} />
            </Link>
          )}
          {item.route && locked && (
            <span className="gd-lockhint"><Icon name="lock" size={13} /> {tx.lockedHint}</span>
          )}
          {!preview && onCopyLink && (
            <button type="button" className="gd-btn gd-btn--ghost gd-btn--sm" onClick={() => onCopyLink(item)}>
              <Icon name="link" size={14} /> {tx.copyLink}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ───────────────────────────── task tile ("I want to…") ───────────────────────────── */

export function TaskTile({ item, tx, locale, tools, editing }) {
  const title = pickText(item, 'title', locale);
  const summary = pickText(item, 'summary', locale);
  const locked = !!item.locked;
  const linkable = item.route && !locked && !editing;
  const inner = (
    <>
      <span className="gd-task__icon" aria-hidden="true"><Icon name={item.icon || 'target'} size={20} /></span>
      <span className="gd-task__text">
        <span className="gd-task__title">{title}</span>
        {summary && <span className="gd-task__summary">{summary}</span>}
        {item.route && <WhereChip route={item.route} tx={tx} />}
        <span className="gd-task__badges">
          {locked && <GuideBadge tone="warn" icon="lock" title={tx.lockedHint}>{tx.lockedBadge}</GuideBadge>}
          {item.is_hidden && <GuideBadge tone="muted" icon="eye-off">{tx.hidden}</GuideBadge>}
          {item.is_custom && <GuideBadge tone="info" icon="sparkles">{tx.custom}</GuideBadge>}
        </span>
      </span>
      {linkable && <span className="gd-task__go" aria-hidden="true"><Icon name={locale === 'ar' ? 'arrow-left' : 'arrow-right'} size={18} /></span>}
    </>
  );
  const cls = `gd-task${locked ? ' is-locked' : ''}${item.is_hidden ? ' is-hidden' : ''}${linkable ? ' is-link' : ''}`;
  return (
    <div className="gd-task__wrap" id={`g-${item.key}`}>
      {linkable ? <Link to={item.route} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}
      {tools && <div className="gd-task__tools">{tools}</div>}
    </div>
  );
}
