-- Chat, 2026-10-11: archive a chat, or delete it on your own side.
--  * chat_members.archived_at: this person put the chat away. It leaves their
--    list (it sits under "Archived chats") until a newer message arrives.
--  * chat_members.cleared_at: this person deleted the chat on THEIR side.
--    The app stops showing them anything in it up to that moment; everyone
--    else keeps their own copy. No message row is removed.
-- Both are the member's own marks: the existing chat_members_self policy
-- (a person may update only their own membership row) already covers them.
--
-- Additive only: two new empty columns. No data is changed or removed.
alter table public.chat_members add column if not exists archived_at timestamptz;
alter table public.chat_members add column if not exists cleared_at  timestamptz;
