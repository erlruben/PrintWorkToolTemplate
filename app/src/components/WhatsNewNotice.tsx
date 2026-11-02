import { useState } from 'react';
import { dateLabel, markUpdatesSeen } from '../lib/updates';
import type { UpdateEntry } from '../lib/updates';
import { IconMegaphone } from './Icons';
import { Rich } from './Rich';

/**
 * A persistent announcement above the current screen, with a route to the
 * complete update history.
 */
export default function WhatsNewNotice({
  userId,
  unseen,
  onSeeAll,
}: {
  userId: string;
  unseen: UpdateEntry[];
  onSeeAll: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (unseen.length === 0) return null;
  const all = unseen.flatMap((u) => u.items);
  const items = all.slice(0, 3);
  const more = all.length - items.length;
  const done = () => {
    markUpdatesSeen(userId);
  };
  const seeAll = () => {
    done();
    onSeeAll();
  };
  return (
    <section className="whatsnew-banner" aria-labelledby="whatsnew-title">
      <div className="whatsnew-mark" aria-hidden="true"><IconMegaphone /></div>
      <div className="whatsnew-content">
        <div className="whatsnew-heading">
          <strong id="whatsnew-title">What&rsquo;s new</strong>
          <span>{dateLabel(unseen[0])}</span>
        </div>
        <p className="whatsnew-summary"><Rich text={items[0]} /></p>
        <div className="whatsnew-actions">
          {items.length > 1 || more > 0 ? (
            <button
              type="button"
              className="whatsnew-expand"
              aria-expanded={expanded}
              aria-controls="whatsnew-details"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show less' : 'More details'}
            </button>
          ) : null}
          <button type="button" className="whatsnew-link" onClick={seeAll}>See all updates</button>
        </div>
        {expanded && (
          <ul id="whatsnew-details">
            {items.slice(1).map((item, index) => <li key={index}><Rich text={item} /></li>)}
            {more > 0 && <li className="muted">and {more} more…</li>}
          </ul>
        )}
      </div>
      <button type="button" className="btn ghost sm whatsnew-dismiss" onClick={done}>Got it</button>
    </section>
  );
}
