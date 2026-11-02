import { isAdminRole, isReceptionRole, SITE_LABEL, type Role, type Site } from './types';

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  unit: string;
  low_stock_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryStock {
  item_id: string;
  site: Site;
  quantity: number;
  updated_at: string;
}

export type InventoryMovementType = 'receipt' | 'adjustment_in' | 'adjustment_out' | 'usage';

export interface InventoryMovement {
  id: string;
  item_id: string;
  site: Site;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  work_order_id: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

export const INVENTORY_CATEGORY_SUGGESTIONS = [
  'Printing Materials',
  'Hardware Materials',
  'Tools & Equipment',
  'General',
] as const;

export function inventoryCategoryOptions(categories: readonly string[]): string[] {
  const suggested = new Set(INVENTORY_CATEGORY_SUGGESTIONS.map((category) => category.toLowerCase()));
  const additional = new Map<string, string>();
  for (const category of categories) {
    const trimmed = category.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !suggested.has(key) && !additional.has(key)) additional.set(key, trimmed);
  }
  return [
    ...INVENTORY_CATEGORY_SUGGESTIONS,
    ...[...additional.values()].sort((a, b) => a.localeCompare(b)),
  ];
}

export const SITE_NAME = SITE_LABEL;

export const MOVEMENT_NAME: Record<InventoryMovementType, string> = {
  receipt: 'Stock received',
  adjustment_in: 'Adjustment added',
  adjustment_out: 'Adjustment removed',
  usage: 'Used on work order',
};

export const canManageInventory = (role: Role | null | undefined) =>
  isAdminRole(role) || isReceptionRole(role) || role === 'supply_clerk';

export const canRecordInventoryUsage = (role: Role | null | undefined) =>
  canManageInventory(role) || role === 'operator';

export function isLowStock(quantity: number, threshold: number): boolean {
  return threshold > 0 && quantity <= threshold;
}

export function movementDelta(type: InventoryMovementType, quantity: number): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return type === 'receipt' || type === 'adjustment_in' ? quantity : -quantity;
}

export function formatStock(quantity: number): string {
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 }).format(quantity);
}
