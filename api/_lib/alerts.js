// @ts-check
// Pure alert logic: filing diff, event ids, delivery planning, Turkish email.
import { classify } from './positionDiff.js';

/** @typedef {{ cusip: string, issuer: string, ticker?: string|null, value: number, shares: number, weight: number, putCall?: string }} Pos */
/** @typedef {{ cusip: string, issuer: string, ticker: string|null, action: 'NEW'|'ADD'|'REDUCE'|'EXIT', value: number, weight: number, dSharesPct: number|null }} Change */

/** Unique id of the "current effective filing" for a period: the newest
 * accession among the original and its amendments, so a later NEW HOLDINGS
 * amendment triggers a fresh (deduplicated) notification.
 * @param {{ acc: string, amendments?: { acc: string }[] }} filing */
export function eventId(filing) {
  const am = filing.amendments || [];
  return am.length ? `${filing.acc}+${am[am.length - 1].acc}` : filing.acc;
}

/** @param {Pos[]} positions */
function equityMap(positions) {
  /** @type {Map<string, Pos>} */
  const m = new Map();
  for (const p of positions) {
    if (p.putCall) continue;
    const c = m.get(p.cusip);
    if (c) {
      c.value += p.value;
      c.shares += p.shares;
      c.weight += p.weight;
    } else m.set(p.cusip, { ...p });
  }
  return m;
}

/**
 * Changes between two filings, largest first per bucket.
 * @param {Pos[] | null} prev @param {Pos[]} cur
 * @returns {{ NEW: Change[], ADD: Change[], REDUCE: Change[], EXIT: Change[], total: number }}
 */
export function diffFilings(prev, cur) {
  const out = { NEW: /** @type {Change[]} */ ([]), ADD: /** @type {Change[]} */ ([]), REDUCE: /** @type {Change[]} */ ([]), EXIT: /** @type {Change[]} */ ([]), total: 0 };
  const curMap = equityMap(cur);
  const prevMap = prev ? equityMap(prev) : null;
  if (!prevMap) {
    for (const p of curMap.values()) out.NEW.push({ cusip: p.cusip, issuer: p.issuer, ticker: p.ticker ?? null, action: 'NEW', value: p.value, weight: p.weight, dSharesPct: null });
    out.NEW.sort((a, b) => b.value - a.value);
    out.total = out.NEW.length;
    return out;
  }
  const all = new Set([...prevMap.keys(), ...curMap.keys()]);
  for (const c of all) {
    const p = prevMap.get(c) || null;
    const q = curMap.get(c) || null;
    const r = classify(
      p ? { reportDate: '', shares: p.shares, value: p.value, weight: p.weight } : null,
      q ? { reportDate: '', shares: q.shares, value: q.value, weight: q.weight } : null,
      true
    );
    if (r.action !== 'NEW' && r.action !== 'ADD' && r.action !== 'REDUCE' && r.action !== 'EXIT') continue;
    const src = /** @type {Pos} */ (q || p);
    out[r.action].push({
      cusip: c,
      issuer: src.issuer,
      ticker: src.ticker ?? null,
      action: r.action,
      value: q ? q.value : /** @type {Pos} */ (p).value,
      weight: q ? q.weight : /** @type {Pos} */ (p).weight,
      dSharesPct: r.dSharesPct,
    });
  }
  for (const k of /** @type {const} */ (['NEW', 'ADD', 'REDUCE', 'EXIT'])) out[k].sort((a, b) => b.value - a.value);
  out.total = out.NEW.length + out.ADD.length + out.REDUCE.length + out.EXIT.length;
  return out;
}

/**
 * Which (user, subscription, event) pairs still need a delivery.
 * @param {{ user_id: string, kind: 'fund'|'stock', key: string }[]} subs
 * @param {{ kind: 'fund'|'stock', key: string, eventId: string }[]} events
 * @param {{ user_id: string, kind: string, key: string, event_id: string, status: string, attempts: number }[]} delivered
 * @param {number} [maxAttempts]
 */
export function pendingDeliveries(subs, events, delivered, maxAttempts = 3) {
  const done = new Map();
  for (const d of delivered) done.set(`${d.user_id}|${d.kind}|${d.key}|${d.event_id}`, d);
  const out = [];
  for (const e of events) {
    for (const s of subs) {
      if (s.kind !== e.kind || s.key !== e.key) continue;
      const k = `${s.user_id}|${s.kind}|${s.key}|${e.eventId}`;
      const d = done.get(k);
      if (d && (d.status === 'sent' || d.attempts >= maxAttempts)) continue;
      out.push({ user_id: s.user_id, kind: s.kind, key: s.key, event_id: e.eventId, attempts: d?.attempts || 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Email rendering (Turkish)
const fmtMoney = (/** @type {number} */ v) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const fmtPct = (/** @type {number|null} */ v, digits = 1) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);
const esc = (/** @type {string} */ s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
const quarterLabel = (/** @type {string} */ d) => {
  const [y, m] = d.split('-').map(Number);
  return `${y} Ç${Math.ceil(m / 3)}`;
};

export const SPK_NOTICE = 'Burada yer alan bilgiler yatırım danışmanlığı kapsamında değildir.';
const LABEL = { NEW: 'Yeni pozisyon', ADD: 'Artırdı', REDUCE: 'Azalttı', EXIT: 'Çıktı' };

/**
 * @param {{ fundName: string, cik: string, reportDate: string, filingDate: string, aum: number, positions: number, diff: ReturnType<typeof diffFilings>, siteUrl: string, perBucket?: number }} a
 */
export function renderFundEmail(a) {
  const per = a.perBucket ?? 8;
  const q = quarterLabel(a.reportDate);
  const subject = `${a.fundName}: ${q} 13F açıklandı — ${a.diff.NEW.length} yeni, ${a.diff.EXIT.length} çıkış`;
  const link = `${a.siteUrl}/manager/${a.cik}`;
  const name = (/** @type {Change} */ c) => (c.ticker ? `${c.ticker} · ${c.issuer}` : c.issuer);

  const textLines = [
    `${a.fundName} — ${q} 13F dosyalaması (${a.filingDate})`,
    `Portföy büyüklüğü: ${fmtMoney(a.aum)} · ${a.positions} pozisyon`,
    '',
  ];
  const htmlParts = [];
  for (const k of /** @type {const} */ (['NEW', 'ADD', 'REDUCE', 'EXIT'])) {
    const list = a.diff[k];
    if (!list.length) continue;
    textLines.push(`${LABEL[k]} (${list.length}):`);
    for (const c of list.slice(0, per)) {
      const extra = k === 'ADD' || k === 'REDUCE' ? ` ${fmtPct(c.dSharesPct)}` : '';
      textLines.push(`  - ${name(c)}: ${fmtMoney(c.value)} (%${c.weight.toFixed(1)})${extra}`);
    }
    if (list.length > per) textLines.push(`  … ve ${list.length - per} tane daha`);
    textLines.push('');
    htmlParts.push(
      `<h3 style="margin:16px 0 6px">${LABEL[k]} (${list.length})</h3><ul style="margin:0;padding-left:18px">` +
        list
          .slice(0, per)
          .map((c) => {
            const extra = k === 'ADD' || k === 'REDUCE' ? ` <span style="color:#666">${fmtPct(c.dSharesPct)}</span>` : '';
            return `<li>${esc(name(c))}: <b>${fmtMoney(c.value)}</b> (%${c.weight.toFixed(1)})${extra}</li>`;
          })
          .join('') +
        (list.length > per ? `<li>… ve ${list.length - per} tane daha</li>` : '') +
        '</ul>'
    );
  }
  if (!a.diff.total) {
    textLines.push('Bu çeyrekte pozisyon değişikliği yok.');
    htmlParts.push('<p>Bu çeyrekte pozisyon değişikliği yok.</p>');
  }
  textLines.push(`Tüm portföy: ${link}`, '', SPK_NOTICE, `Uyarı ayarları: ${a.siteUrl}/account`);

  const html = `<!doctype html><html lang="tr"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101a2e;max-width:560px;margin:0 auto;padding:20px">
<div style="font-weight:800;font-size:18px">📡 13F Radar</div>
<h2 style="margin:12px 0 4px">${esc(a.fundName)}</h2>
<div style="color:#5d6675">${q} 13F dosyalaması · ${esc(a.filingDate)} · ${fmtMoney(a.aum)} · ${a.positions} pozisyon</div>
${htmlParts.join('')}
<p style="margin-top:20px"><a href="${link}" style="background:#f7c948;color:#101a2e;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:700">Tüm portföyü gör</a></p>
<p style="color:#5d6675;font-size:12px;margin-top:28px">${SPK_NOTICE}<br>Bu e-postayı takip ettiğiniz fon için uyarı açtığınız için aldınız. <a href="${a.siteUrl}/account">Uyarı ayarları</a></p>
</body></html>`;
  return { subject, html, text: textLines.join('\n') };
}

/**
 * Stock alert: one email per (user, stock, fund filing).
 * @param {{ ticker: string|null, issuer: string, cusip: string, fundName: string, cik: string, reportDate: string, filingDate: string, change: Change, siteUrl: string }} a
 */
export function renderStockEmail(a) {
  const sym = a.ticker || a.issuer;
  const q = quarterLabel(a.reportDate);
  const verb = LABEL[a.change.action];
  const subject = `${sym}: ${a.fundName} ${q}'de ${verb.toLowerCase()}`;
  const link = `${a.siteUrl}/stock/${a.ticker || ''}?cusip=${a.cusip}`;
  const extra = a.change.action === 'ADD' || a.change.action === 'REDUCE' ? ` (${fmtPct(a.change.dSharesPct)} hisse)` : '';
  const line = `${a.fundName}, ${q} dosyalamasında ${sym} pozisyonunda: ${verb}${extra}. Pozisyon: ${fmtMoney(a.change.value)} (%${a.change.weight.toFixed(1)}).`;
  const text = [line, `Detay: ${link}`, '', SPK_NOTICE, `Uyarı ayarları: ${a.siteUrl}/account`].join('\n');
  const html = `<!doctype html><html lang="tr"><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#101a2e;max-width:560px;margin:0 auto;padding:20px">
<div style="font-weight:800;font-size:18px">📡 13F Radar</div>
<h2 style="margin:12px 0 4px">${esc(sym)} · ${esc(verb)}</h2>
<p>${esc(line)}</p>
<p><a href="${link}" style="background:#f7c948;color:#101a2e;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:700">Hisse sayfası</a></p>
<p style="color:#5d6675;font-size:12px;margin-top:28px">${SPK_NOTICE}<br><a href="${a.siteUrl}/account">Uyarı ayarları</a></p>
</body></html>`;
  return { subject, html, text };
}
