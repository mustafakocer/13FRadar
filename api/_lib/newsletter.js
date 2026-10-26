import { esc } from './leads.js';

// The weekly "Smart Money" newsletter, built from the files the nightly jobs
// already write. Pure: scripts/send-newsletter.mjs reads the files, passes
// them in, and mails what comes back. Data, not advice: no "buy", no
// targets, the same words the site uses.
//
// Sections, each skipped when the week has nothing for it:
//   insiders  the strongest cluster buys (insiders-teaser.json signals.cluster)
//   ceo       the largest CEO/CFO open-market buy (signals.csuite)
//   congress  the largest stock buys members of Congress disclosed
//   filings   tracked superinvestors who filed a 13F this week

const DAY = 86400 * 1000;
const money = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
const range = (lo, hi) => (hi ? `${money(lo)}–${money(hi)}` : `${money(lo)}+`);

const T = {
  tr: {
    subject: (lead) => `📬 Akıllı para bu hafta${lead ? `: ${lead}` : ''}`,
    hello: 'Merhaba 👋 Bu hafta büyük oyuncuların yaptıkları, tek e-postada:',
    insiders: '🔥 İçeriden toplu alımlar',
    insiderLine: (c) => `${c.t} · ${c.c}: ${c.insiders} yönetici birlikte ${money(c.v)} aldı`,
    ceo: '👔 Haftanın en büyük CEO/CFO alımı',
    ceoLine: (r) => `${r.t} · ${r.c}: ${r.n} (${r.r.toUpperCase()}) ${money(r.v)} aldı`,
    congress: '🏛️ Kongre üyelerinin en büyük alımları',
    congressLine: (r, who) => `${r.t}: ${who} · ${range(r.lo, r.hi)}`,
    filings: '📊 Bu hafta 13F veren ustalar',
    filingsMore: (n) => `…ve ${n} usta daha`,
    leadInsider: (c) => `${c.t}'de ${c.insiders} yöneticiden toplu alım`,
    leadCongress: (r) => `Kongre ${r.t} aldı`,
    cta: 'Tüm portföyler, alım-satımlar ve insider akışı Pro’da 👉',
    note: 'Veriler SEC ve Kongre bildirimlerinden derlenir; yatırım tavsiyesi değildir.',
    empty: 'Bu hafta öne çıkan bir hareket olmadı; haftaya görüşürüz 👋',
  },
  en: {
    subject: (lead) => `📬 Smart money this week${lead ? `: ${lead}` : ''}`,
    hello: 'Hi 👋 What the big players did this week, in one email:',
    insiders: '🔥 Insider cluster buys',
    insiderLine: (c) => `${c.t} · ${c.c}: ${c.insiders} insiders bought ${money(c.v)} together`,
    ceo: '👔 The week’s largest CEO/CFO buy',
    ceoLine: (r) => `${r.t} · ${r.c}: ${r.n} (${r.r.toUpperCase()}) bought ${money(r.v)}`,
    congress: '🏛️ Largest stock buys by members of Congress',
    congressLine: (r, who) => `${r.t}: ${who} · ${range(r.lo, r.hi)}`,
    filings: '📊 Superinvestors who filed a 13F this week',
    filingsMore: (n) => `…and ${n} more`,
    leadInsider: (c) => `${c.insiders} insiders buying ${c.t}`,
    leadCongress: (r) => `Congress bought ${r.t}`,
    cta: 'Every portfolio, trade and the full insider feed are in Pro 👉',
    note: 'Compiled from SEC and Congressional disclosures; not investment advice.',
    empty: 'Nothing stood out this week; see you next Monday 👋',
  },
};

export function buildNewsletter({ teaser = {}, congress = {}, filings = [], gurus = [], now = new Date(), lang = 'tr', site, pathOf = (cik) => `/manager/${cik}` }) {
  const t = T[lang === 'en' ? 'en' : 'tr'];
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const L = (p) => `${site}/${lang}${p}`;
  const sections = [];

  const clusters = (teaser.signals?.cluster || [])
    .filter((c) => (c.last || c.to || '') >= since)
    .sort((a, b) => b.insiders - a.insiders || b.v - a.v)
    .slice(0, 3);
  if (clusters.length) sections.push({ title: t.insiders, items: clusters.map((c) => ({ text: t.insiderLine(c), url: L(`/stock/${c.t}`) })) });

  const ceo = (teaser.signals?.csuite || []).filter((r) => (r.f || r.d || '') >= since).sort((a, b) => b.v - a.v)[0];
  if (ceo) sections.push({ title: t.ceo, items: [{ text: t.ceoLine(ceo), url: L(`/stock/${ceo.t}`) }] });

  const members = congress.members || {};
  const buys = (congress.rows || [])
    .filter((r) => r.k === 'buy' && r.t && r.at === 'stock' && (r.f || '') >= since)
    .sort((a, b) => (b.hi || b.lo || 0) - (a.hi || a.lo || 0));
  const seen = new Set();
  const top = [];
  for (const r of buys) {
    // one line per member: three trades by one person is one story
    if (seen.has(r.m)) continue;
    seen.add(r.m);
    top.push(r);
    if (top.length === 3) break;
  }
  if (top.length) {
    sections.push({
      title: t.congress,
      items: top.map((r) => {
        const m = members[r.m];
        const who = m ? `${m.n} (${m.p}-${m.st})` : r.m;
        return { text: t.congressLine(r, who), url: m?.slug ? L(`/congress/${m.slug}`) : L('/congress') };
      }),
    });
  }

  const guruCiks = new Map(gurus.map((g) => [String(g.cik).padStart(10, '0'), g]));
  const filed = [];
  const filedSeen = new Set();
  for (const f of filings) {
    const cik = String(f.cik).padStart(10, '0');
    if (!guruCiks.has(cik) || (f.filed || '') < since || filedSeen.has(cik)) continue;
    filedSeen.add(cik);
    filed.push({ text: guruCiks.get(cik).name, url: L(pathOf(cik)) });
  }
  if (filed.length) {
    const shown = filed.slice(0, 6);
    sections.push({ title: t.filings, items: shown, more: filed.length > shown.length ? t.filingsMore(filed.length - shown.length) : null });
  }

  const lead = clusters[0] ? t.leadInsider(clusters[0]) : top[0] ? t.leadCongress(top[0]) : null;
  return { subject: t.subject(lead), sections, empty: !sections.length, hello: t.hello, cta: { text: t.cta, url: L('/pricing') }, note: t.note, emptyText: t.empty };
}

// text + html from the built issue; `unsub` is the reader's own link
export function renderNewsletter(issue, { unsub, footer }) {
  const textParts = [issue.hello, ''];
  for (const s of issue.sections) {
    textParts.push(s.title);
    for (const i of s.items) textParts.push(`• ${i.text}\n  ${i.url}`);
    if (s.more) textParts.push(s.more);
    textParts.push('');
  }
  if (issue.empty) textParts.push(issue.emptyText, '');
  textParts.push(`${issue.cta.text} ${issue.cta.url}`, '', issue.note, '', footer);
  const text = textParts.join('\n');

  const sec = issue.sections
    .map(
      (s) =>
        `<h3 style="font-size:16px;margin:22px 0 8px">${esc(s.title)}</h3><ul style="padding-left:18px;margin:0">${s.items
          .map((i) => `<li style="margin:6px 0"><a href="${esc(i.url)}" style="color:#1B2A6B">${esc(i.text)}</a></li>`)
          .join('')}</ul>${s.more ? `<p style="color:#667;margin:6px 0">${esc(s.more)}</p>` : ''}`
    )
    .join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#14182b;max-width:560px">
<p>${esc(issue.hello)}</p>${sec}${issue.empty ? `<p>${esc(issue.emptyText)}</p>` : ''}
<p style="margin:26px 0"><a href="${esc(issue.cta.url)}" style="background:#1B2A6B;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${esc(issue.cta.text)}</a></p>
<p style="font-size:12px;color:#667">${esc(issue.note)}</p>
<p style="font-size:12px;color:#667;white-space:pre-line">${esc(footer).replace(esc(unsub), `<a href="${esc(unsub)}" style="color:#667">${esc(unsub)}</a>`)}</p></div>`;
  return { text, html };
}

// One guru's new 13F, for the single-guru alert.
export function guruAlertMail({ lang = 'tr', name, filing, url }) {
  const date = filing.reportDate || '';
  if (lang === 'en') {
    return { subject: `🔔 ${name} filed a new 13F`, text: `${name} just filed its 13F for the quarter ending ${date} (${filing.positions ?? '?'} positions).\n\nSee what it bought and sold: ${url}` };
  }
  return { subject: `🔔 ${name} yeni 13F verdi`, text: `${name}, ${date} dönemi için 13F bildirimini yayımladı (${filing.positions ?? '?'} pozisyon).\n\nNeyi alıp sattığına bak: ${url}` };
}
