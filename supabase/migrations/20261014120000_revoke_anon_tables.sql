-- Signed-out visitors get no table rights at all, 2026-10-14.
--
-- supabase/schemas/07_api_privileges.sql says "Nothing is granted to anon", but
-- the project's own default gives the signed-out role (anon) every right on
-- every new table — 98 grants found by the health check on 2026-10-14. Row
-- security already stops anon from seeing or changing a single row (no rule is
-- written for anon), so this changes nothing that works today; it removes the
-- rights themselves, as the reference always intended, so a future table
-- whose row security is forgotten is still closed to the public.
--
-- Not touched: anon may still use the schema and run the few sign-in helper
-- functions it is granted (looking up a username, starting a password reset).
-- Additive in effect: no data is changed.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
-- And for tables made later by the database owner (migrations).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
