# PrintFlow Work Order Tracker

PrintFlow is a RECONTECH-built, reusable production-tracking template for print
shops. Its product identity is designed specifically for print-floor workflows;
it is not a reskin of the internal tracker used as a workflow reference. It
carries each work order from intake and artwork through review, the live print
queue, quality checks, and release.

Start with [SETUP.md](SETUP.md) to create a separate Supabase project and run
the app locally. Do not connect this template to the source tracker or its
production database.

## What is included

- **Work orders:** searchable jobs with customer, artist, materials, quantities,
  due dates, notes, attachments, and an audit history.
- **Role-aware workflow:** receptionist, artist, operator, moderator, and admin
  access. Moderators can use the combined day-to-day shop workflows; Admin
  remains the highest role and manages accounts and shared app settings.
  Tech Developer and Support accounts retain full Admin-equivalent access.
  Important permissions are enforced by Supabase row-level security and
  database guards, not only by hiding interface controls.
- **Print queue:** live queue with area assignment, priority, operator claim,
  progress/timer controls, file checks, and print completion.
- **Team coordination:** ticket comments, mentions, chat, notifications, and
  printable workload reports.
- **Inventory:** flexible categories for print materials, hardware, tools and
  equipment, location-based stock, low-stock alerts, receipts and corrections,
  usage linked to work orders, and a searchable audit history.
- **Reusable setup:** Supabase migrations and reference schemas, responsive
  React UI, tests, and template privacy/terms pages to customize.
- **Production-studio identity:** warm stock surfaces, an ink-dark workspace
  rail, and signal-orange actions designed for print-floor workflows.

## Workflow principles

- Keep work details attached to the job so production can see the same context
  as the person who opened it.
- Let meaningful actions drive the workflow: artist assignment, attached files,
  review/send-to-print, print completion, and release.
- Keep the print-ready file in shared storage and attach a preview or link to the
  ticket instead of forcing very large production files through the app.
- Preserve the role boundaries in the database; an artist must not be able to
  mark a job printed by calling the API directly.

## Development

```powershell
cd app
npm ci
npm run dev
npm test
npm run lint
npm run build
```

See [SETUP.md](SETUP.md) for backend configuration and [supabase/README.md](supabase/README.md)
for migration guidance. Before using the privacy or terms pages, replace the
template language with policies reviewed for your organization.
