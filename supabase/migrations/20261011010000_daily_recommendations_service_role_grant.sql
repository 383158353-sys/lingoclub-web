-- The import endpoint writes with the service role key; this project does not
-- grant table privileges to service_role by default, so grant them explicitly.
grant select, insert, update, delete on public.daily_recommendations to service_role;
