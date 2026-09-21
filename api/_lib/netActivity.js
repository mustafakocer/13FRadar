// Net buying and selling across a set of funds — the one definition behind
// "most bought", "most sold", the per-stock ownership table, the landing
// page's quarter activity, the fund update cards and the /report pivot.
//
//   For every security and every fund in the set:
//     Δshares = shares_t − shares_{t−1}
//       a position opened this quarter:  shares_{t−1} = 0  (Δ = the whole stake)
//       a position closed this quarter:  shares_t     = 0  (Δ = −previous stake)
//   net $  = Σ_funds Δshares × P
//   buy $  = Σ_funds max(Δshares, 0) × P,   sell $ = Σ_funds max(−Δshares, 0) × P
//   P      = the security's period-end price: Σ value_t / Σ shares_t over the
//            funds that hold it at t (the price every 13F row implies), and
//            the previous period's implied price when nobody holds it any
//            more (a name the whole set exited).
//
// So a fund that opened a $1B position counts as $1B bought — never a
// fraction of it — and a fund that doubled a position counts the shares it
// added at the quarter-end price, not the change in the position's value
// (a name that merely went up contributes nothing). Amendments are already
// folded into the snapshots handed in (api/_lib/amendments.js): a 13F-HR/A
// is a correction, never a quarter of trades.
//
// Pure. `managers` is [{ cik, name, reportDate, cur, prev }] where cur/prev
// are effective snapshots ({ positions: [{ cusip, putCall, issuer, value,
// shares, weight }] }); a fund with no previous quarter contributes holdings
// but no trades. PUT/CALL rows are not trades in the underlying and are
// skipped (the caller aggregates them separately).
//
// `idOf(position)` picks the security identity — the CUSIP by default, a
// ticker from the security master when the caller has one, so a CUSIP
// change under a position is not read as a sale plus a purchase.

const equity = (snap) => (snap?.positions || []).filter((p) => !p.putCall);

export function netActivity(managers, { idOf = (p) => String(p.cusip || '').toUpperCase() } = {}) {
  const rows = new Map();
  const row = (id, p) => {
    let r = rows.get(id);
    if (!r) {
      r = {
        id,
        cusip: String(p.cusip || '').toUpperCase(),
        issuer: p.issuer || '',
        totalValue: 0,
        totalShares: 0,
        prevValue: 0,
        prevShares: 0,
        holders: [],
        buyShares: 0,
        sellShares: 0,
        buyValue: 0,
        sellValue: 0,
        netValue: 0,
        buyers: 0,
        sellers: 0,
        newBuyers: 0,
        adders: 0,
        reducers: 0,
        exiters: 0,
        price: null,
        // per-fund deltas, priced in the second pass
        deltas: [],
      };
      rows.set(id, r);
    }
    return r;
  };

  // pass 1: books and share deltas
  for (const m of managers || []) {
    const cur = new Map();
    for (const p of equity(m.cur)) {
      const id = idOf(p);
      const c = cur.get(id) || { shares: 0, value: 0, weight: 0, p };
      c.shares += p.shares || 0;
      c.value += p.value || 0;
      c.weight += p.weight || 0;
      cur.set(id, c);
    }
    const prev = new Map();
    if (m.prev) {
      for (const p of equity(m.prev)) {
        const id = idOf(p);
        const q = prev.get(id) || { shares: 0, value: 0, weight: 0, p };
        q.shares += p.shares || 0;
        q.value += p.value || 0;
        q.weight += p.weight || 0;
        prev.set(id, q);
      }
    }
    for (const [id, c] of cur) {
      const r = row(id, c.p);
      if (!r.issuer && c.p.issuer) r.issuer = c.p.issuer;
      r.totalValue += c.value;
      r.totalShares += c.shares;
      const holder = { cik: m.cik, name: m.name, weight: c.weight, shares: c.shares, value: c.value, change: null, activity: 'hold' };
      r.holders.push(holder);
      if (!m.prev) continue;
      const q = prev.get(id);
      const d = c.shares - (q?.shares || 0);
      if (!q) holder.activity = 'new';
      else {
        holder.change = q.shares > 0 ? (d / q.shares) * 100 : null;
        holder.activity = d > 0 ? 'add' : d < 0 ? 'reduce' : 'hold';
      }
      if (d !== 0 || !q) r.deltas.push({ cik: m.cik, name: m.name, delta: d, kind: holder.activity, weight: c.weight, change: holder.change });
    }
    for (const [id, q] of prev) {
      if (cur.has(id)) continue;
      const r = row(id, q.p);
      r.prevValue += q.value;
      r.prevShares += q.shares;
      r.deltas.push({ cik: m.cik, name: m.name, delta: -q.shares, kind: 'exit', weight: q.weight, change: -100 });
    }
    for (const [id, q] of prev) {
      if (!cur.has(id)) continue;
      const r = row(id, q.p);
      r.prevValue += q.value;
      r.prevShares += q.shares;
    }
  }

  // pass 2: one period-end price per security, then dollars
  for (const r of rows.values()) {
    r.price = r.totalShares > 0 ? r.totalValue / r.totalShares : r.prevShares > 0 ? r.prevValue / r.prevShares : 0;
    for (const t of r.deltas) {
      t.value = Math.abs(t.delta) * r.price;
      if (t.delta > 0) {
        r.buyShares += t.delta;
        r.buyValue += t.value;
        r.buyers++;
        if (t.kind === 'new') r.newBuyers++;
        else r.adders++;
      } else if (t.delta < 0) {
        r.sellShares += -t.delta;
        r.sellValue += t.value;
        r.sellers++;
        if (t.kind === 'exit') r.exiters++;
        else r.reducers++;
      }
    }
    r.netValue = r.buyValue - r.sellValue;
    r.holderCount = r.holders.length;
    r.avgWeight = r.holderCount ? r.holders.reduce((s, h) => s + h.weight, 0) / r.holderCount : 0;
    r.maxWeight = r.holderCount ? Math.max(...r.holders.map((h) => h.weight)) : 0;
    r.holders.sort((x, y) => y.weight - x.weight);
    delete r.prevValue;
    delete r.prevShares;
  }
  return rows;
}

// The per-fund story a manager card tells — new buys, adds, reduces and
// exits, valued the same way as the roll-up — read back out of the rows.
export function storiesByManager(rows) {
  const out = new Map();
  for (const r of rows.values()) {
    for (const t of r.deltas) {
      let s = out.get(t.cik);
      if (!s) out.set(t.cik, (s = { newBuys: [], adds: [], reduces: [], exits: [] }));
      const list = t.kind === 'new' ? s.newBuys : t.kind === 'add' ? s.adds : t.kind === 'reduce' ? s.reduces : s.exits;
      list.push({ id: r.id, cusip: r.cusip, issuer: r.issuer, weight: t.weight, value: t.value, ...(t.kind === 'add' || t.kind === 'reduce' ? { change: t.change } : {}) });
    }
  }
  return out;
}

// The row shape /report renders (scripts/build-guru-activity.mjs):
//   t ticker · g holders · ng new holders · sh shares held · bs/ss shares
//   bought/sold · b/s buyers/sellers · nv net $ · tv total $ held
export const activityRow = (r, ticker) => ({
  t: ticker,
  g: r.holderCount,
  ng: r.newBuyers,
  sh: Math.round(r.totalShares),
  bs: Math.round(r.buyShares),
  ss: Math.round(r.sellShares),
  nv: Math.round(r.netValue),
  tv: Math.round(r.totalValue),
  b: r.buyers,
  s: r.sellers,
});
