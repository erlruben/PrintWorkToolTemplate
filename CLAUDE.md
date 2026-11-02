# Project guidance

This folder is a reusable work-order tracker template. Keep changes scoped to
this project unless separately asked.

## Backend safety

- Configure this copy with a new development or test Supabase project.
- Before applying migrations, verify the project reference and show the user
  what will run.
- Do not connect to, modify, or deploy to the source tracker's production
  database or hosting.
- Treat destructive database operations as permanent. Ask for explicit
  authorization before running them.
- Keep `.env.local`, `supabase/db.env`, service-role keys, and database
  passwords out of source control and build output.
- Use additive migrations for schema changes. Keep `supabase/schemas/`
  synchronized with the migration source.

## Development

Run commands from `app/`:

```powershell
npm test
npm run lint
npm run build
```

Preserve the workflow rules and role checks in both the UI and database. Add a
focused test when changing permissions, status transitions, or print-queue
behavior.
