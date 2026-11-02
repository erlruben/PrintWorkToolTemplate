# Supabase database

Use a **new project** for this template. The migration history defines the
work-order tables, workflow functions, role policies, storage, notifications,
reporting data, and print-shop inventory.

## Project files

- `migrations/` — ordered, one-time schema changes; apply these to the new
  project.
- `schemas/` — readable reference definitions; keep them aligned with later
  migrations.
- `functions/` — Edge Functions that are deployed separately.
- `bootstrap-admin.sql` — replace its placeholders and run once for the first
  administrator.
- `db.mjs` — migration helper; reads `db.env`, which must stay local.

## Applying migrations

Create `db.env` from `db.env.example`, confirm the connection belongs to your
new project, then preview and apply:

```powershell
node supabase/db.mjs push --dry-run
node supabase/db.mjs push
```

Never point this template at the source tracker database. Review every proposed
migration before applying it, and get explicit approval before any operation
that removes or overwrites data.

## Changing the schema

1. Add a timestamped migration; never edit a migration already applied to a
   project.
2. Update the matching reference file under `schemas/`.
3. Test against a disposable database and verify each role's access.
4. Review the migration preview before applying it to any shared environment.

Edge Functions and provider webhooks are configured separately. Store their
secrets in the Supabase dashboard, never in the app or this repository.

## Inventory

Migration `20261029090000_inventory_system.sql` adds the item catalog,
per-location balances, and append-only stock movement history. Admins and
receptionists can manage items and record receipts or corrections. Categories
are intentionally flexible text so each shop can track print materials,
hardware, tools, equipment, and its own stock groups without a schema change.
The inventory area has Dashboard and All Inventory tabs. Monthly, quarterly,
yearly, and all-time filters show matching activity and items; stock changes
recorded from a filtered item list update the live balance now. Older activity
loads in pages. These filters do not represent historical balance snapshots.
Moderators receive the combined operational permissions of receptionists,
artists, and operators, but cannot manage accounts or shared app settings.
Operators can record usage only for their assigned location, and every usage
entry must reference a live work order. All signed-in roles can view stock and
history. A positive reorder threshold triggers a notification when a location
balance crosses down to that level; a threshold of zero disables alerts.

Inventory changes are performed through role-checked database functions.
Clients cannot directly edit balances or ledger entries. Review and apply the
migration only to the new, disposable/template Supabase project configured for
this app; do not run it against the source tracker project.
