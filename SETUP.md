# Set up the PrintFlow template

Use a **new Supabase project** for this copy. Never reuse a production
database, credentials, or deployment settings from another tracker.

## 1. Create a Supabase project

Create a project for your own organization and keep its database password in
your password manager. Enable the services you plan to use: Database, Auth,
Storage, Realtime, and Edge Functions.

## 2. Apply the database schema

1. Copy `supabase/db.env.example` to `supabase/db.env`.
2. Set `SUPABASE_DB_URL` to the connection string for the **new** project.
3. Check that the project reference in the URL matches the project you just
   created.
4. Preview, then apply the migrations:

   ```powershell
   node supabase/db.mjs push --dry-run
   node supabase/db.mjs push
   ```

The migrations build the work-order schema and its database-enforced access
rules. See [supabase/README.md](supabase/README.md).

## 3. Configure the frontend

1. Copy `app/.env.example` to `app/.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the new project's
   API settings.
3. Never put a Supabase service-role key or database password in the frontend.

## 4. Create the first administrator

Create and confirm the first user in Supabase Auth. Edit the placeholder values
in `supabase/bootstrap-admin.sql` for that user and run the SQL once in the new
project's SQL editor. Sign in, then create the rest of the team through
**Accounts**. Public sign-up is disabled.

## 5. Run locally

```powershell
cd app
npm ci
npm run dev
```

Open the local address printed by Vite. Verify role access with separate test
accounts before inviting real users.

## 6. Configure optional integrations

- **Google Drive:** configure the Drive folder and OAuth client in Settings if
  you want direct file picking/uploads. Otherwise, add shared links to tickets.
- **Email:** configure the `password-reset` and `recovery-verify` Edge Functions
  and their mail secrets if you want password recovery emails.
- **Push notifications:** configure VAPID keys and the Supabase webhook if
  browser push is needed.
- **Cloudflare demo hosting:** this template includes a Cloudflare Workers
  static-assets configuration. The root build command explicitly builds the
  sample-only demo (`VITE_DEMO=1`); it does not connect to Supabase or include
  real work data. From the repository root, run `npm install`, `npm run login`,
  then `npm run deploy`. This publishes to the separate
  `printworktooltemplate-dev` Worker and is available at the `workers.dev`
  address Cloudflare assigns to your account. It does not update the source
  tracker's existing `printtemplate` Worker.
  To use real accounts and shared data instead, configure a separate Supabase
  project for this template and deploy only after reviewing the environment
  and access rules. Never use the source tracker's production services.
  Update `app/public/_headers` if you add external services.

Before deploying, replace the organization name and review the privacy and
terms templates in `app/public/`.
