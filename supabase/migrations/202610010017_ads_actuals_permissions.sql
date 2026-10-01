-- The guarded TEST intake RPCs live in staging; this grants namespace lookup only.
begin;
grant usage on schema staging to admin;
commit;
