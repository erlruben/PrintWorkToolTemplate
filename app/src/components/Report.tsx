import { useState } from 'react';
import type { Profile, WorkOrder } from '../lib/types';
import PeriodReport from './PeriodReport';
import AllTimeReport from './AllTimeReport';
import type { PeriodType } from '../lib/periods';

interface Props {
  orders: WorkOrder[];
  profiles: Profile[];
}

type Tab = PeriodType | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'quarter', label: 'Quarterly' },
  { key: 'year', label: 'Yearly' },
  { key: 'all', label: 'All time' },
];

/** The four report views — only Yearly archives a closed year; Monthly/Quarterly are for viewing, All time never archives. */
export default function Report({ orders, profiles }: Props) {
  const [tab, setTab] = useState<Tab>('month');

  return (
    <div>
      <div role="tablist" className="row report-tabs" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`chip-pick ${tab === t.key ? 'on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'all'
        ? <AllTimeReport orders={orders} profiles={profiles} />
        // Keyed by tab: each period type starts on its own current period.
        : <PeriodReport key={tab} orders={orders} profiles={profiles} periodType={tab} />}
    </div>
  );
}
