Marker files. A push that changes `backup` runs the database backup
workflow; a push that changes `migrate` runs the migration named on its first
line (`all`, `0001_rls`, `0002_constraints`, `0003_stripe_events`). Both
workflows can also be started from the Actions tab. Used by a session that
can push to the branch but is not allowed to dispatch workflows.
