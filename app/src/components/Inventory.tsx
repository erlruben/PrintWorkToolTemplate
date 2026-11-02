import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useWorkOrders } from '../lib/data';
import { canManageInventory, canRecordInventoryUsage, formatStock, inventoryCategoryOptions, isLowStock, MOVEMENT_NAME, SITE_NAME, type InventoryItem, type InventoryMovement, type InventoryMovementType, type InventoryStock } from '../lib/inventory';
import { periodBounds, periodLabelOf, periodTitle, recentLabels, type PeriodType } from '../lib/periods';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/sessionContext';
import type { Site } from '../lib/types';

const SITES: Site[] = ['office', 'production'];
const MOVEMENT_PAGE_SIZE = 150;
const MOVEMENT_OPTIONS: { value: InventoryMovementType; label: string }[] = [
  { value: 'receipt', label: 'Receive stock' },
  { value: 'adjustment_in', label: 'Correction: add stock' },
  { value: 'adjustment_out', label: 'Correction: remove stock' },
  { value: 'usage', label: 'Record work-order usage' },
];

const blankItem = () => ({ name: '', category: 'General', sku: '', unit: 'item', threshold: '0', active: true });
type InventoryTab = 'dashboard' | 'items';

interface PeriodActivitySummary {
  itemIds: Set<string>;
  movementCount: number;
  addedCount: number;
  removedCount: number;
}

function localDate(value: string) {
  return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Inventory() {
  const { profile } = useSession();
  const { orders } = useWorkOrders();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [periodActivity, setPeriodActivity] = useState<PeriodActivitySummary>({
    itemIds: new Set(),
    movementCount: 0,
    addedCount: 0,
    removedCount: 0,
  });
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [loadingMoreMovements, setLoadingMoreMovements] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState(blankItem);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [historyPeriod, setHistoryPeriod] = useState<PeriodType | 'all'>('month');
  const [historyMonth, setHistoryMonth] = useState(() => periodLabelOf('month'));
  const [historyQuarter, setHistoryQuarter] = useState(() => periodLabelOf('quarter'));
  const [historyYear, setHistoryYear] = useState(() => periodLabelOf('year'));
  const [activeTab, setActiveTab] = useState<InventoryTab>('dashboard');
  const movementRequestId = useRef(0);
  const [movementType, setMovementType] = useState<InventoryMovementType>('receipt');
  const [itemId, setItemId] = useState('');
  const [site, setSite] = useState<Site>(profile?.site ?? 'office');
  const [quantity, setQuantity] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [note, setNote] = useState('');

  const canManage = canManageInventory(profile?.role);
  const canUse = canRecordInventoryUsage(profile?.role);
  const selectedMovementType = canManage ? movementType : 'usage';
  const visibleOrders = useMemo(
    () => orders.filter((order) => !order.deleted_at).sort((a, b) => b.date_given.localeCompare(a.date_given)),
    [orders],
  );
  const periodItems = useMemo(
    () => historyPeriod === 'all' ? items : items.filter((item) => periodActivity.itemIds.has(item.id)),
    [historyPeriod, items, periodActivity.itemIds],
  );
  const activeItems = useMemo(() => items.filter((item) => item.active), [items]);
  const periodActiveItems = useMemo(() => periodItems.filter((item) => item.active), [periodItems]);
  const categoryOptions = useMemo(
    () => inventoryCategoryOptions(items.map((item) => item.category)),
    [items],
  );
  const visibleItems = useMemo(
    () => selectedCategory
      ? periodItems.filter((item) => item.category.trim().toLowerCase() === selectedCategory.toLowerCase())
      : periodItems,
    [periodItems, selectedCategory],
  );
  const lowCount = useMemo(
    () => stock.filter((row) => {
      const item = items.find((candidate) => candidate.id === row.item_id);
      return item?.active && isLowStock(Number(row.quantity), Number(item.low_stock_threshold));
    }).length,
    [items, stock],
  );
  const activeMovementTypes = canManage ? MOVEMENT_OPTIONS : MOVEMENT_OPTIONS.filter((option) => option.value === 'usage');
  const historyLabel = historyPeriod === 'month'
    ? historyMonth
    : historyPeriod === 'quarter'
      ? historyQuarter
      : historyPeriod === 'year'
        ? historyYear
        : null;
  const historyTitle = historyLabel ? periodTitle(historyPeriod as PeriodType, historyLabel) : null;
  const historyLabels = historyPeriod === 'month'
    ? recentLabels('month', 24)
    : historyPeriod === 'quarter'
      ? recentLabels('quarter', 12)
      : historyPeriod === 'year'
        ? recentLabels('year', 10)
        : [];
  const periodSelector = (
    <div className="inventory-history-filters">
      <label className="field"><span>Period</span>
        <select value={historyPeriod} onChange={(event) => setHistoryPeriod(event.target.value as PeriodType | 'all')}>
          <option value="month">Monthly</option>
          <option value="quarter">Quarterly</option>
          <option value="year">Yearly</option>
          <option value="all">All time</option>
        </select>
      </label>
      {historyPeriod !== 'all' && historyTitle && (
        <label className="field"><span>{historyPeriod === 'month' ? 'Month' : historyPeriod === 'quarter' ? 'Quarter' : 'Year'}</span>
          <select
            value={historyLabel ?? ''}
            onChange={(event) => {
              if (historyPeriod === 'month') setHistoryMonth(event.target.value);
              else if (historyPeriod === 'quarter') setHistoryQuarter(event.target.value);
              else setHistoryYear(event.target.value);
            }}
          >
            {historyLabels.map((label) => <option key={label} value={label}>{periodTitle(historyPeriod, label)}</option>)}
          </select>
        </label>
      )}
    </div>
  );

  const fetchPeriodActivityPage = useCallback((from: number) => {
    let query = supabase.from('inventory_movements').select('item_id, quantity_delta');
    if (historyPeriod !== 'all') {
      const label = historyPeriod === 'month' ? historyMonth : historyPeriod === 'quarter' ? historyQuarter : historyYear;
      const bounds = periodBounds(historyPeriod, label);
      query = query.gte('created_at', bounds.startIso).lt('created_at', bounds.endIsoExclusive);
    }
    return query.order('created_at', { ascending: false }).range(from, from + MOVEMENT_PAGE_SIZE - 1);
  }, [historyMonth, historyPeriod, historyQuarter, historyYear]);

  const fetchPeriodActivity = useCallback(async (): Promise<PeriodActivitySummary> => {
    const summary: PeriodActivitySummary = {
      itemIds: new Set(),
      movementCount: 0,
      addedCount: 0,
      removedCount: 0,
    };
    let from = 0;
    while (true) {
      const { data, error: activityError } = await fetchPeriodActivityPage(from);
      if (activityError) throw new Error(activityError.message);
      const page = data ?? [];
      for (const movement of page) {
        summary.itemIds.add(movement.item_id);
        summary.movementCount += 1;
        if (Number(movement.quantity_delta) > 0) summary.addedCount += 1;
        if (Number(movement.quantity_delta) < 0) summary.removedCount += 1;
      }
      if (page.length < MOVEMENT_PAGE_SIZE) return summary;
      from += page.length;
    }
  }, [fetchPeriodActivityPage]);

  const fetchMovementPage = useCallback((from: number) => {
    let query = supabase.from('inventory_movements').select('*');
    if (historyPeriod !== 'all') {
      const label = historyPeriod === 'month' ? historyMonth : historyPeriod === 'quarter' ? historyQuarter : historyYear;
      const bounds = periodBounds(historyPeriod, label);
      query = query.gte('created_at', bounds.startIso).lt('created_at', bounds.endIsoExclusive);
    }
    return query.order('created_at', { ascending: false }).range(from, from + MOVEMENT_PAGE_SIZE - 1);
  }, [historyMonth, historyPeriod, historyQuarter, historyYear]);

  const load = useCallback(async () => {
    const requestId = ++movementRequestId.current;
    setLoading(true);
    setLoadingMoreMovements(false);
    try {
      const [itemResult, stockResult, movementResult, activitySummary] = await Promise.all([
        supabase.from('inventory_items').select('*').order('name'),
        supabase.from('inventory_stock').select('*'),
        fetchMovementPage(0),
        fetchPeriodActivity(),
      ]);
      if (requestId !== movementRequestId.current) return;
      const failed = [itemResult.error, stockResult.error, movementResult.error].find(Boolean);
      if (failed) {
        setError(failed.message);
        if (movementResult.error) {
          setMovements([]);
          setHasMoreMovements(false);
        }
      } else {
        setItems((itemResult.data ?? []) as InventoryItem[]);
        setStock((stockResult.data ?? []) as InventoryStock[]);
        setMovements((movementResult.data ?? []) as InventoryMovement[]);
        setPeriodActivity(activitySummary);
        setHasMoreMovements((movementResult.data?.length ?? 0) === MOVEMENT_PAGE_SIZE);
        setError(null);
      }
    } catch (loadError) {
      if (requestId === movementRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load inventory.');
        setMovements([]);
        setHasMoreMovements(false);
        setPeriodActivity({ itemIds: new Set(), movementCount: 0, addedCount: 0, removedCount: 0 });
      }
    } finally {
      if (requestId === movementRequestId.current) setLoading(false);
    }
  }, [fetchMovementPage, fetchPeriodActivity]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`inventory-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, () => { void load(); })
      .subscribe();
    return () => {
      movementRequestId.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function loadMoreMovements() {
    setLoadingMoreMovements(true);
    const requestId = movementRequestId.current;
    try {
      const { data, error: movementError } = await fetchMovementPage(movements.length);
      if (requestId !== movementRequestId.current) return;
      if (movementError) {
        setError(movementError.message);
      } else {
        const nextPage = (data ?? []) as InventoryMovement[];
        setMovements((current) => [...current, ...nextPage]);
        setHasMoreMovements(nextPage.length === MOVEMENT_PAGE_SIZE);
      }
    } catch (loadError) {
      if (requestId === movementRequestId.current) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load more stock activity.');
      }
    } finally {
      if (requestId === movementRequestId.current) setLoadingMoreMovements(false);
    }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    const threshold = Number(itemForm.threshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      setError('Enter a valid low-stock threshold, or 0 to turn off the alert.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await supabase.rpc('save_inventory_item', {
      p_id: editing,
      p_name: itemForm.name,
      p_category: itemForm.category,
      p_sku: itemForm.sku || null,
      p_unit: itemForm.unit,
      p_low_stock_threshold: threshold,
      p_active: itemForm.active,
    });
    if (saveError) {
      setError(saveError.message);
    } else {
      setMessage(editing ? 'Inventory item updated.' : 'Inventory item added.');
      setEditing(null);
      setItemForm(blankItem());
      await load();
    }
    setBusy(false);
  }

  function startEditing(item: InventoryItem) {
    setEditing(item.id);
    setItemForm({
      name: item.name,
      category: item.category,
      sku: item.sku ?? '',
      unit: item.unit,
      threshold: String(item.low_stock_threshold),
      active: item.active,
    });
    setError(null);
    setMessage(null);
  }

  async function recordMovement(event: FormEvent) {
    event.preventDefault();
    const amount = Number(quantity);
    if (!selectedItemId) {
      setError('Add an active inventory item first.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    if (selectedMovementType === 'usage' && !workOrderId) {
      setError('Choose the work order this material was used for.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: movementError } = await supabase.rpc('record_inventory_movement', {
      p_item_id: selectedItemId,
      p_site: selectedSite,
      p_movement_type: selectedMovementType,
      p_quantity: amount,
      p_work_order_id: selectedMovementType === 'usage' ? workOrderId : null,
      p_note: note || null,
    });
    if (movementError) {
      setError(movementError.message);
    } else {
      setMessage(`${MOVEMENT_NAME[selectedMovementType]} saved.`);
      setQuantity('');
      setWorkOrderId('');
      setNote('');
      await load();
    }
    setBusy(false);
  }

  const selectedItemId = periodActiveItems.some((item) => item.id === itemId) ? itemId : periodActiveItems[0]?.id ?? '';
  const selectedItem = periodActiveItems.find((item) => item.id === selectedItemId);
  const selectedSite = profile?.role === 'operator' && profile.site ? profile.site : site;
  const availableForSite = stock.find((row) => row.item_id === selectedItemId && row.site === selectedSite)?.quantity ?? 0;

  return (
    <div className="wrap inventory-page">
      <div className="page-head">
        <div>
          <h1>Inventory</h1>
          <p className="sub">Review stock activity and current quantities for materials, tools, and equipment.</p>
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="inventory-success" role="status">{message}</div>}

      <div className="inventory-tabs" role="tablist" aria-label="Inventory sections">
        <button
          type="button"
          role="tab"
          id="inventory-dashboard-tab"
          aria-selected={activeTab === 'dashboard'}
          aria-controls="inventory-dashboard-panel"
          className={activeTab === 'dashboard' ? 'inventory-tab active' : 'inventory-tab'}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          role="tab"
          id="inventory-items-tab"
          aria-selected={activeTab === 'items'}
          aria-controls="inventory-items-panel"
          className={activeTab === 'items' ? 'inventory-tab active' : 'inventory-tab'}
          onClick={() => setActiveTab('items')}
        >
          All Inventory
        </button>
      </div>

      {activeTab === 'dashboard' ? (
        <section className="inventory-tab-panel" role="tabpanel" id="inventory-dashboard-panel" aria-labelledby="inventory-dashboard-tab" tabIndex={0}>
          <section className="card inventory-period-dashboard">
            <div className="inventory-section-heading">
              <div>
                <h2>Stock activity statistics</h2>
                <p className="muted">
                  {historyPeriod === 'all' ? 'All-time activity' : `Activity for ${historyTitle}`}
                  {' · '}counts are entries, not combined quantities across different units.
                </p>
              </div>
              {periodSelector}
            </div>
            <div className="inventory-summary inventory-period-stats">
              <div className="inventory-stat"><span>Stock movements</span><strong>{loading ? '—' : periodActivity.movementCount}</strong></div>
              <div className="inventory-stat"><span>Stock additions</span><strong>{loading ? '—' : periodActivity.addedCount}</strong></div>
              <div className="inventory-stat"><span>Stock removals</span><strong>{loading ? '—' : periodActivity.removedCount}</strong></div>
              <div className="inventory-stat"><span>Items with activity</span><strong>{loading ? '—' : periodActivity.itemIds.size}</strong></div>
            </div>
          </section>

          <div className="inventory-current-heading"><h2>Current stock overview</h2><p className="muted">Live balances are not changed by the history filter.</p></div>
          <div className="inventory-summary">
            <div className="card inventory-stat"><span>Active items</span><strong>{activeItems.length}</strong></div>
            <div className={`card inventory-stat ${lowCount ? 'is-low' : ''}`}><span>Locations below reorder level</span><strong>{lowCount}</strong></div>
            <div className="card inventory-stat"><span>Tracked locations</span><strong>2</strong></div>
          </div>

          <section className="card inventory-catalog">
            <div className="inventory-section-heading">
              <div>
                <h2>Stock activity</h2>
                <p className="muted">{historyPeriod === 'all' ? 'All-time receipts, corrections, and work-order usage.' : `Stock movements for ${historyTitle}.`}</p>
              </div>
            </div>
            {loading ? <p className="muted">Loading stock activity…</p> : movements.length === 0 ? (
              <div className="inventory-empty">{historyPeriod === 'all' ? 'No stock activity has been recorded yet.' : `No stock activity recorded for ${historyTitle}.`}</div>
            ) : (
              <div className="inventory-history">
                {movements.map((movement) => {
                  const item = items.find((candidate) => candidate.id === movement.item_id);
                  const order = movement.work_order_id ? visibleOrders.find((candidate) => candidate.id === movement.work_order_id) : null;
                  return (
                    <div className="inventory-history-row" key={movement.id}>
                      <span className={`inventory-movement-dot ${movement.quantity_delta < 0 ? 'out' : 'in'}`} aria-hidden="true" />
                      <div className="inventory-history-main">
                        <strong>{item?.name ?? 'Inventory item'}</strong>
                        <span>{MOVEMENT_NAME[movement.movement_type]} · {SITE_NAME[movement.site]}{order ? ` · ${order.wo_number}` : ''}{movement.note ? ` · ${movement.note}` : ''}</span>
                      </div>
                      <strong className={movement.quantity_delta < 0 ? 'inventory-quantity-out' : 'inventory-quantity-in'}>
                        {movement.quantity_delta > 0 ? '+' : ''}{formatStock(Number(movement.quantity_delta))} {item?.unit ?? ''}
                      </strong>
                      <time>{localDate(movement.created_at)}</time>
                    </div>
                  );
                })}
              </div>
            )}
            {hasMoreMovements && (
              <button className="btn ghost sm inventory-history-more" type="button" onClick={() => void loadMoreMovements()} disabled={loading || loadingMoreMovements}>
                {loadingMoreMovements ? 'Loading…' : 'Load more activity'}
              </button>
            )}
          </section>
        </section>
      ) : (
        <section className="inventory-tab-panel" role="tabpanel" id="inventory-items-panel" aria-labelledby="inventory-items-tab" tabIndex={0}>
          <section className="card inventory-catalog">
            <div className="inventory-section-heading">
              <div>
                <h2>All inventory</h2>
                <p className="muted">
                  {historyPeriod === 'all' ? 'Every catalog item with current live quantities.' : `Items with stock activity in ${historyTitle}; quantities shown are current live balances.`}
                  {' '}A 0 reorder threshold disables low-stock alerts.
                </p>
              </div>
              <div className="inventory-items-filters">
                {periodSelector}
                <label className="field inventory-category-filter"><span>Category</span>
                  <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
                    <option value="">All categories</option>
                    {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {loading ? <p className="muted">Loading inventory…</p> : items.length === 0 ? (
              <div className="inventory-empty">No inventory items yet. Add materials, tools, equipment, or other stock your team keeps on hand.</div>
            ) : historyPeriod !== 'all' && periodItems.length === 0 ? (
              <div className="inventory-empty">No items had stock activity in {historyTitle}. Try another period or view all time.</div>
            ) : visibleItems.length === 0 ? (
              <div className="inventory-empty">No items in this category.</div>
            ) : (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead><tr><th>Item</th><th>Office</th><th>Production</th><th>Reorder at</th>{canManage && <th>Action</th>}</tr></thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const balance = (location: Site) => Number(stock.find((row) => row.item_id === item.id && row.site === location)?.quantity ?? 0);
                      return (
                        <tr key={item.id} className={!item.active ? 'inactive' : undefined}>
                          <td><strong>{item.name}</strong><span className="inventory-meta">{item.category}{item.sku ? ` · ${item.sku}` : ''} · per {item.unit}</span>{!item.active && <span className="inventory-inactive-label">Inactive</span>}</td>
                          {SITES.map((location) => {
                            const amount = balance(location);
                            const low = item.active && isLowStock(amount, Number(item.low_stock_threshold));
                            return <td key={location}><strong>{formatStock(amount)} {item.unit}</strong>{low && <span className="inventory-low-badge">Reorder</span>}</td>;
                          })}
                          <td>{Number(item.low_stock_threshold) > 0 ? `${formatStock(Number(item.low_stock_threshold))} ${item.unit}` : 'Off'}</td>
                          {canManage && <td><button className="btn ghost sm" type="button" onClick={() => startEditing(item)}>Edit</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {canUse && (
            <form className="card inventory-form" onSubmit={recordMovement}>
              <div className="inventory-section-heading">
                <div>
                  <h2>Record stock activity</h2>
                  <p className="muted">Choose an item found in the filtered inventory. Stock changes are recorded now and update its live balance.</p>
                </div>
              </div>
              {periodActiveItems.length ? (
                <div className="inventory-movement-fields">
                  <label className="field"><span>Activity</span>
                    <select value={selectedMovementType} onChange={(event) => setMovementType(event.target.value as InventoryMovementType)}>
                      {activeMovementTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Inventory item</span>
                    <select value={selectedItemId} onChange={(event) => setItemId(event.target.value)} required>
                      {periodActiveItems.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Location</span>
                    <select value={selectedSite} disabled={profile?.role === 'operator'} onChange={(event) => setSite(event.target.value as Site)}>
                      {SITES.map((location) => <option key={location} value={location}>{SITE_NAME[location]}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>Quantity</span><input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
                  {selectedMovementType === 'usage' && (
                    <label className="field inventory-work-order"><span>Work order</span>
                      <select value={workOrderId} onChange={(event) => setWorkOrderId(event.target.value)} required>
                        <option value="">Choose a work order</option>
                        {visibleOrders.map((order) => <option key={order.id} value={order.id}>{order.wo_number} · {order.description}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="field inventory-note"><span>Note (optional)</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Supplier, reason, or details" /></label>
                </div>
              ) : <div className="inventory-empty">No active items match this period. Change the period or select All time to choose a current item.</div>}
              {selectedMovementType === 'usage' && selectedItem && (
                <p className="inventory-available">Available at {SITE_NAME[selectedSite]}: <strong>{formatStock(Number(availableForSite))} {selectedItem.unit}</strong></p>
              )}
              {periodActiveItems.length > 0 && <button className="btn" disabled={busy || loading}>{busy ? 'Saving…' : 'Save stock activity'}</button>}
            </form>
          )}
          {canManage && (
            <form className="card inventory-form" onSubmit={saveItem}>
              <div className="inventory-section-heading">
                <div>
                  <h2>{editing ? 'Edit item' : 'Add an item'}</h2>
                  <p className="muted">Add materials, tools, equipment, or any other stock your team tracks.</p>
                </div>
                {editing && <button className="btn ghost sm" type="button" onClick={() => { setEditing(null); setItemForm(blankItem()); }}>Cancel edit</button>}
              </div>
              <div className="inventory-item-fields">
                <label className="field"><span>Item name</span><input value={itemForm.name} maxLength={120} required onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="e.g. Gloss vinyl 1.2m" /></label>
                <label className="field"><span>Category</span><input list="inventory-category-options" value={itemForm.category} maxLength={60} required onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })} placeholder="Choose or enter a category" /><datalist id="inventory-category-options">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist></label>
                <label className="field"><span>SKU (optional)</span><input value={itemForm.sku} maxLength={80} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} placeholder="Supplier code" /></label>
                <label className="field"><span>Stock unit</span><input value={itemForm.unit} maxLength={24} required onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })} placeholder="item, piece, box, roll" /></label>
                <label className="field"><span>Reorder at</span><input type="number" min="0" step="0.001" value={itemForm.threshold} required onChange={(event) => setItemForm({ ...itemForm, threshold: event.target.value })} /></label>
              </div>
              {editing && (
                <label className="check-row inventory-active-toggle">
                  <input type="checkbox" checked={itemForm.active} onChange={(event) => setItemForm({ ...itemForm, active: event.target.checked })} />
                  Item is active
                </label>
              )}
              <button className="btn" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add item'}</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
