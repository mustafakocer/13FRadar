// What one Supabase auth event should load. The SDK reports the same session
// several times on a page open — INITIAL_SESSION, often SIGNED_IN from the
// session it recovered, TOKEN_REFRESHED — and the provider used to run the
// whole profile load for each: is_pro and the profile row three times, and an
// upsert of the whole watchlist (a POST) every time, on every page. Now:
//   · the profile (is_pro, profiles) loads once per signed-in user, again
//     only when the user changes or their account is updated;
//   · opening a page writes nothing: the watchlist is read and merged into
//     the local list;
//   · the funds starred while signed out are uploaded on a sign-in, and only
//     those the account does not already have.
export function sessionPlan(event, session, loadedUid) {
  const uid = session?.user?.id || null;
  const changed = uid !== loadedUid;
  return {
    uid,
    load: changed || event === 'USER_UPDATED',
    upload: Boolean(uid) && event === 'SIGNED_IN',
  };
}

// The local favorites the account's rows lack.
export function localOnly(local, remote) {
  const have = new Set((remote || []).map((r) => r.cik));
  return (local || []).filter((f) => !have.has(f.cik));
}
