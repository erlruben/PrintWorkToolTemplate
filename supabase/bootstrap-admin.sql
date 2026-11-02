-- Run this ONCE, after you have created your own user in
-- Supabase → Authentication → Users → Add user.
--
-- It promotes that first account to admin so you can add everyone else from
-- inside the tracker. Nobody can self-signup, so this is the way in.

update public.profiles
set    role = 'admin',
       must_change_password = false,
       full_name = 'CHANGE ME'          -- your name as it should appear
where  id = (
  select id from auth.users where email = 'CHANGE-ME@example.com'
);

-- Check it worked:
select p.full_name, p.role, u.email
from   public.profiles p
join   auth.users u on u.id = p.id;
