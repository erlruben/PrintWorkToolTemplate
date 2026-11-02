import { useState } from 'react';
import BrandMark from './BrandMark';
import { IconChart, IconInventory, IconList, IconMonitor } from './Icons';

type PreviewTab = 'orders' | 'queue' | 'inventory' | 'workload';

const jobs = [
  { number: 'WO-8K2PM', title: 'Cafe window graphics', customer: 'Northline Coffee', artist: 'M. Santos', due: 'Today', status: 'Waiting to Print', tone: 'amber' },
  { number: 'WO-5R7JD', title: 'Product launch banners', customer: 'Field & Form', artist: 'A. Reyes', due: 'Tomorrow', status: 'In progress', tone: 'blue' },
  { number: 'WO-3N9QA', title: 'Event wayfinding set', customer: 'Common Ground', artist: 'J. Cruz', due: 'Oct 31', status: 'File Attached for Review', tone: 'violet' },
];

const stock = [
  { name: 'Gloss vinyl · 1.2m', category: 'Media', office: '12 rolls', production: '2 rolls', threshold: '3 rolls', low: true },
  { name: 'Matte laminate', category: 'Finishing', office: '8 rolls', production: '6 rolls', threshold: '2 rolls', low: false },
  { name: 'Eco-solvent ink · Cyan', category: 'Ink', office: '4 bottles', production: '5 bottles', threshold: '2 bottles', low: false },
];

export default function PreviewHome() {
  const [tab, setTab] = useState<PreviewTab>('orders');
  const nav: { id: PreviewTab; label: string; icon: typeof IconList }[] = [
    { id: 'orders', label: 'Work Orders', icon: IconList },
    { id: 'inventory', label: 'Inventory', icon: IconInventory },
    { id: 'workload', label: 'Workload', icon: IconChart },
    { id: 'queue', label: 'Print Queue', icon: IconMonitor },
  ];

  return (
    <div className="shell preview-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark size={34} />
          <div><div className="sidebar-brand-name">PrintFlow</div><div className="sidebar-brand-org">Print production</div></div>
        </div>
        <div className="sidebar-context" aria-label="Workspace area">
          <span className="sidebar-context-mark" aria-hidden="true" />
          <span>Production floor</span>
        </div>
        <nav className="sidebar-nav" aria-label="Preview navigation">
          {nav.map((item) => (
            <button key={item.id} aria-current={tab === item.id} onClick={() => setTab(item.id)}>
              <item.icon /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="preview-account"><span className="preview-avatar">D</span><span><strong>Demo User</strong><small>Moderator preview</small></span></div>
          <a className="preview-signin" href={`${window.location.pathname}?login=1`}>Sign in to your workspace</a>
          <div className="sidebar-credit"><span className="made-by dark"><span className="mb-label">Built by</span><img className="mb-mark" src="/brand/recon-mark.png" alt="" /><span className="mb-name">RECONTECH</span></span></div>
        </div>
      </aside>

      <main className="content">
        <div className="preview-banner">
          <span><strong>Read-only preview</strong> · Sample information only; no account or database connection.</span>
          <a href={`${window.location.pathname}?login=1`}>Sign in</a>
        </div>
        {tab === 'orders' && (
          <div className="wrap">
            <div className="page-head"><div><h1>Work Orders</h1><p className="sub">A live view of jobs moving through your print shop.</p></div><button className="btn" disabled>+ New work order</button></div>
            <div className="preview-metrics">
              <div className="card"><span>Active jobs</span><strong>18</strong><small>Across every stage</small></div>
              <div className="card"><span>Waiting to print</span><strong>6</strong><small>2 assigned to you</small></div>
              <div className="card"><span>Due today</span><strong>3</strong><small>1 needs attention</small></div>
            </div>
            <section className="card preview-board">
              <div className="preview-board-head"><div><h2>Recent work</h2><p className="muted">Example jobs · demo data</p></div><span className="preview-live"><i />Sample view</span></div>
              <div className="preview-job-list">
                {jobs.map((job) => (
                  <article className="preview-job" key={job.number}>
                    <span className="preview-job-mark"><IconList /></span>
                    <div className="preview-job-title"><strong>{job.title}</strong><span>{job.number} · {job.customer}</span></div>
                    <span className="preview-job-artist">{job.artist}</span>
                    <span className="preview-job-due">{job.due}</span>
                    <span className={`preview-status ${job.tone}`}>{job.status}</span>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {tab === 'inventory' && (
          <div className="wrap">
            <div className="page-head"><div><h1>Inventory</h1><p className="sub">Track materials, tools, equipment, and other stock across your locations.</p></div></div>
            <div className="preview-metrics"><div className="card"><span>Active items</span><strong>24</strong><small>Tracked inventory items</small></div><div className="card"><span>Low stock</span><strong>1</strong><small>Needs reorder</small></div><div className="card"><span>Locations</span><strong>2</strong><small>Office and Production</small></div></div>
            <section className="card preview-board"><div className="preview-board-head"><div><h2>Inventory levels</h2><p className="muted">Sample inventory · demo data</p></div></div><div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Item</th><th>Office</th><th>Production</th><th>Reorder at</th><th>Status</th></tr></thead><tbody>{stock.map((item) => <tr key={item.name}><td><strong>{item.name}</strong><span className="inventory-meta">{item.category}</span></td><td>{item.office}</td><td>{item.production}</td><td>{item.threshold}</td><td>{item.low ? <span className="inventory-low-badge">Reorder</span> : <span className="preview-in-stock">In stock</span>}</td></tr>)}</tbody></table></div></section>
          </div>
        )}
        {tab === 'queue' && (
          <div className="wrap">
            <div className="page-head"><div><h1>Print Queue</h1><p className="sub">Jobs ready for production.</p></div></div>
            <div className="preview-metrics"><div className="card"><span>In queue</span><strong>6</strong><small>Sorted by priority</small></div><div className="card"><span>Printing now</span><strong>2</strong><small>Both locations</small></div><div className="card"><span>Printer status</span><strong className="preview-ok">All working</strong><small>Office and Production</small></div></div>
            <section className="card preview-board"><div className="preview-board-head"><div><h2>Ready to print</h2><p className="muted">Example queue · demo data</p></div></div>{jobs.slice(0, 2).map((job, i) => <article className="preview-queue-job" key={job.number}><span className="preview-queue-number">0{i + 1}</span><div><strong>{job.title}</strong><span>{job.number} · {i ? 'Production' : 'Office'}</span></div><span className="preview-queue-pill">{i ? 'Assigned' : 'Waiting'}</span></article>)}</section>
          </div>
        )}
        {tab === 'workload' && (
          <div className="wrap">
            <div className="page-head"><div><h1>Workload</h1><p className="sub">A quick overview of team activity.</p></div></div>
            <div className="preview-metrics"><div className="card"><span>Jobs completed</span><strong>42</strong><small>This month</small></div><div className="card"><span>Artwork in progress</span><strong>7</strong><small>Across 3 artists</small></div><div className="card"><span>Prints completed</span><strong>35</strong><small>Across 2 operators</small></div></div>
            <section className="card preview-board"><div className="preview-board-head"><div><h2>Team snapshot</h2><p className="muted">Example workload · demo data</p></div></div><div className="preview-team-row"><span className="preview-avatar">A</span><div><strong>Artist</strong><small>Artwork progress</small></div><div className="preview-progress"><i style={{ width: '72%' }} /></div><strong>18 jobs</strong></div><div className="preview-team-row"><span className="preview-avatar teal">O</span><div><strong>Operator</strong><small>Print queue</small></div><div className="preview-progress"><i style={{ width: '54%' }} /></div><strong>14 jobs</strong></div></section>
          </div>
        )}
      </main>
    </div>
  );
}
