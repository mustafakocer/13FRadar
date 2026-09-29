-- Reverts 0005_job_triggers.up.sql: the cron jobs, the ops schema and its
-- log. The extensions and the Vault secret stay (other things may use them;
-- delete the secret by hand if the trigger is retired for good). The GitHub
-- `schedule:` fallback keeps the jobs running, late.
do $$
declare j text;
begin
  foreach j in array array['gh-universe', 'gh-fpi', 'gh-freshness-am', 'gh-insiders-catchup', 'gh-freshness-pm', 'gh-dispatch-collect'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;
drop schema if exists ops cascade;
