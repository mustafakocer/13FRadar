// E paketi mockup'larını gerçek Q2 verisinden üretir (sabit rakam yok):
//   node design/mockups/e-paketi/build.mjs
// Çıktı: Main.html, Fon.html, Hisse.html, FonMobil.html + mock.css/mock.js
// Bu dosyalar spesifikasyonun kendisidir; kod ile çelişirse mockup kazanır.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextDeadline } from '../../../api/_lib/calendar.js';
import { readSeries } from '../../../api/_lib/priceStore.js';
import { closeOn } from '../../../api/_lib/valueUnits.js';
import { periodReturns } from '../../../api/_handlers/perf.js';
import { displayCompany } from '../../../client/src/lib/label.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const consensus = J('client/public/consensus.json');
const latest = J('api/_data/latest-holdings.json');
const hist = J('api/_data/guru-history.json');
const returns = J('client/public/returns.json').returns;
const meta = J('api/_data/ticker-meta.json');
const fund = J('api/_data/fundamentals.json').byTicker;
const teaser = J('client/public/insiders-teaser.json');
const summary = J('client/public/universe-summary.json');
const filings = J('client/public/filings.json');
const cusips = J('api/_data/cusip-tickers.json');
const fpi = J('api/_data/fpi.json');
const insiders = J('api/_data/insiders.json');
const names = J('api/_data/company-names.json').names;

// ---------- biçim yardımcıları (TR: ondalık virgül, binlik nokta) ----------
const tr = (n, d = 2) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${tr(a / 1e12)}T`;
  if (a >= 1e9) return `${s}$${tr(a / 1e9)}B`;
  if (a >= 1e6) return `${s}$${tr(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${s}$${tr(a / 1e3, 1)}K`;
  return `${s}$${tr(a)}`;
};
const pct = (v, d = 1, sign = true) => (v == null ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}%${tr(Math.abs(v), d)}`);
const num = (v) => Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const AYU = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const day = (iso) => `${Number(iso.slice(8, 10))} ${AY[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const dayShort = (iso) => `${Number(iso.slice(8, 10))} ${AY[Number(iso.slice(5, 7)) - 1]}`;
const dayLong = (iso) => `${Number(iso.slice(8, 10))} ${AYU[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const q = (iso) => `${iso.slice(0, 4)} Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const coName = (t, issuer) => displayCompany(names[t] || names[String(t).replace(/\./g, '-')] || issuer || t).short;
const HUES = [212, 338, 158, 28, 268, 2, 98, 190, 48, 310];
const hue = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const logo = (sym, size = 28) =>
  `<span class="logo" style="--h:${hue(sym)};--s:${size}px" aria-hidden="true">${esc(String(sym).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase())}</span>`;
const fundLogo = (name, size = 36) => {
  const ini = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<span class="logo fund" style="--h:${hue(name)};--s:${size}px" aria-hidden="true">${esc(ini)}</span>`;
};
const TODAY = '2026-10-06';
const daysTo = (iso) => Math.round((Date.parse(iso) - Date.parse(TODAY)) / 86400000);

// ---------- veri: Berkshire ----------
const BRK = '0001067983';
const brk = latest.byCik[BRK];
const brkUpd = consensus.updates.find((u) => u.cik === BRK);
const brkQ = hist.gurus[BRK].quarters;
const brkPos = hist.gurus[BRK].positions;
const prevQ = brkQ[brkQ.length - 2];
const lastQ = brkQ[brkQ.length - 1];
const aum8 = brkQ.slice(-8);
const changeOf = (cusip) => {
  const s = brkPos[cusip]?.series || [];
  const cur = s.find((r) => r[0] === lastQ.reportDate);
  const prev = s.find((r) => r[0] === prevQ.reportDate);
  if (!cur) return null;
  if (!prev) return { kind: 'new' };
  const d = ((cur[1] - prev[1]) / prev[1]) * 100;
  return { kind: Math.abs(d) < 0.05 ? 'same' : d > 0 ? 'add' : 'reduce', d };
};
const heldLabel = (cusip) => {
  const p = brkPos[cusip];
  if (!p) return '—';
  const yrs = p.heldQuarters / 4;
  const from2016 = p.firstSeen <= '2016-12-31';
  return `${tr(yrs, 1)}${from2016 ? '+' : ''} yıl${from2016 ? ' (veri 2016’dan)' : ''}`;
};
const sinceReport = (t) => {
  if (!t) return null;
  const qe = closeOn(t, brk.reportDate);
  const last = readSeries(t)?.prices?.at(-1)?.close;
  return qe > 0 && last > 0 ? ((last - qe) / qe) * 100 : null;
};
const positions = brk.top.map((p) => ({ ...p, t: cusips[p.cusip] || null }));
const top10 = positions.slice(0, 10).reduce((s, p) => s + p.weight, 0);
let w = 0, r = 0;
for (const p of positions.slice(0, 50)) { const rr = p.t && returns[p.t]?.ret1y; if (rr != null) { w += p.weight; r += p.weight * rr; } }
const brkRet1y = w ? r / w : null;
const aumQoq = ((lastQ.aum - prevQ.aum) / prevQ.aum) * 100;
const sectors = {};
for (const p of positions) { const s = meta[p.t]?.sector || 'Diğer'; sectors[s] = (sectors[s] || 0) + p.weight; }
const sectorRows = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
const sec4 = sectorRows.slice(0, 4); const secOther = sectorRows.slice(4).reduce((s, x) => s + x[1], 0);
const SECTOR_TR = { Technology: 'Teknoloji', 'Financial Services': 'Finans', 'Consumer Defensive': 'Temel Tüketim', Energy: 'Enerji', 'Communication Services': 'İletişim', Healthcare: 'Sağlık', Industrials: 'Sanayi', 'Consumer Cyclical': 'Tüketim', 'Basic Materials': 'Hammadde', Utilities: 'Kamu Hizmeti', 'Real Estate': 'Gayrimenkul', Diğer: 'Diğer' };
const biggestAdd = [...brkUpd.adds].sort((a, b) => b.value - a.value)[0];
const biggestExit = brkUpd.exits[0];
const biggestReduce = [...brkUpd.reduces].sort((a, b) => b.value - a.value)[0];

// ---------- veri: AAPL ----------
const aapl = consensus.mostHeld.find((m) => m.ticker === 'AAPL');
const aaplSeries = readSeries('AAPL');
const aaplPerf = periodReturns(aaplSeries);
const aaplLast = aaplSeries.prices.at(-1), aaplPrev = aaplSeries.prices.at(-2);
const aaplFun = fund.AAPL, aaplMeta = meta.AAPL;
const tryRate = fpi.rates.TRY.at(-1); // [date, usd per TRY]
const usdTry = 1 / tryRate[1];
const holders3 = [...aapl.holders].sort((a, b) => b.weight - a.weight).slice(0, 3);
const aaplIns = insiders.rows.filter((x) => x.t === 'AAPL' && x.d >= '2025-10-06').sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);
const year = aaplSeries.prices.filter((p) => p.date >= '2025-10-06');

// ---------- veri: Bugün ----------
const lastDay = teaser.lastDay;
const pulse = teaser.pulse;
const lastFilingDay = filings.rows.map((x) => x.filed).sort().at(-1);
const dayRows = filings.rows.filter((x) => x.filed === lastFilingDay);
const amendedN = dayRows.filter((x) => x.amended).length;
const newQ = dayRows.filter((x) => x.reportDate === '2026-09-30').length;
const dl = nextDeadline(new Date(`${TODAY}T12:00:00Z`));
const watch = ['0001067983', '0001536411', '0001656456'].map((cik) => consensus.updates.find((u) => u.cik === cik));
const chipsOf = (u) => {
  const out = [];
  if (u.newBuys[0]) out.push(['new', `Yeni · ${u.newBuys[0].ticker || coName(null, u.newBuys[0].issuer)}`]);
  if (u.adds[0]) out.push(['add', `${u.adds[0].ticker} ${pct(u.adds[0].change, 0)}`]);
  if (u.reduces[0]) out.push(['reduce', `${u.reduces[0].ticker} ${pct(u.reduces[0].change, 0)}`]);
  if (u.exits[0]) out.push(['exit', `Çıktı · ${u.exits[0].ticker || coName(null, u.exits[0].issuer)}`]);
  return out.slice(0, 4);
};
const csuite = (teaser.signals?.csuite || []).slice(0, 4);
const cluster = (teaser.signals?.cluster || []).slice(0, 2);
const top5 = [...consensus.mostHeld].sort((a, b) => b.holderCount - a.holderCount || b.totalValue - a.totalValue).slice(0, 5);
const ROLE = { ceo: 'CEO', cfo: 'CFO', director: 'Yön. Kurulu', officer: 'Yönetici', owner10: '%10 ortak' };
const updUtc = summary.updatedAt.slice(11, 16);

// ---------- kabuk ----------
const NAV = [
  ['bugun', 'Bugün', 'Main.html', 'M3 12 12 3l9 9M5 10v10h14V10'],
  ['ustalar', 'Ustalar', '/gurus', 'M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z'],
  ['fonlar', 'Fonlar', '/screen', 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6'],
  ['hisseler', 'Hisseler', '/screen/stocks', 'M4 19l5-6 4 3 7-9M4 5v14h16'],
  ['insider', 'Insider', '/insiders', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0'],
  ['siralamalar', 'Sıralamalar', '/rankings/most-bought', 'M4 20h4V10H4zM10 20h4V4h-4zM16 20h4v-7h-4z'],
  ['takvim', '13F Takvimi', '/calendar', 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4'],
  ['takip', 'Takip Listem', '/watchlist', 'M12 4l2.4 5 5.6.8-4 3.9.9 5.6L12 16.6 7.1 19.3l.9-5.6-4-3.9L9.6 9z'],
  ['karsilastir', 'Karşılaştır', '/compare', 'M8 4v16M16 4v16M4 8h8M12 16h8'],
  ['ogren', 'Öğren', '/rehber', 'M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z'],
];
const ico = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const sidebar = (active, subnav = '') => `
<nav class="side" aria-label="Ana menü">
  <a class="brand" href="Main.html"><span class="mark">F</span><span>Fundocap</span></a>
  <ul>
    ${NAV.map(([k, label, href, d]) => `<li><a href="${href}" ${k === active ? 'class="on" aria-current="page"' : ''}>${ico(d)}<span>${label}</span></a></li>`).join('\n    ')}
  </ul>
  ${subnav}
  <div class="user">
    <span class="avatar" aria-hidden="true">M</span>
    <div><b>Mustafa</b><a href="/account">Hesabım</a></div>
    <span class="badge pro">PRO</span>
  </div>
</nav>`;
const topbar = (title, sub, extra = '') => `
<header class="top">
  <div class="tt"><h1>${title}</h1><span class="muted small">${sub}</span></div>
  <label class="search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Fon, hisse ya da yönetici ara" aria-label="Ara"><kbd>⌘K</kbd></label>
  <div class="tools">${extra}<button class="seg" aria-label="Dil">TR</button><button class="icon" id="theme" aria-label="Temayı değiştir">◐</button></div>
</header>`;
const mobileBar = (active) => `
<nav class="tabbar" aria-label="Alt menü">
  ${[['bugun', 'Bugün', 0], ['ustalar', 'Ustalar', 1], ['hisseler', 'Hisseler', 3], ['insider', 'Insider', 4], ['takip', 'Takip', 7]].map(([k, l, i]) => `<a href="${NAV[i][2]}" ${k === active ? 'class="on" aria-current="page"' : ''}>${ico(NAV[i][3], 20)}<span>${l}</span></a>`).join('')}
</nav>`;
const page = ({ title, body, mobile = false, active, nav = '' }) => `<!doctype html>
<html lang="tr" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Fundocap mockup</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="mock.css">
</head>
<body class="${mobile ? 'mobile' : 'desktop'}">
<div class="frame">
${mobile ? '' : sidebar(active, nav)}
<main class="main">
${body}
</main>
${mobile ? mobileBar(active) : ''}
</div>
<div class="note">Mockup · gerçek Q2 2026 verisi (${dayShort(summary.dataUpdatedAt.slice(0, 10))} derlemesi) · tema: <button id="theme2">açık/koyu</button> · ölçek: ${mobile ? '390px telefon' : '1360px masaüstü'}</div>
<script src="mock.js"></script>
</body>
</html>`;

// =====================================================================
// Main.html — Bugün paneli
// =====================================================================
const buyShare = (pulse.buyValue / (pulse.buyValue + pulse.sellValue)) * 100;
const mainBody = `
${topbar('Bugün', `son veri: ${dayShort(lastDay)} · güncelleme ${dayShort(summary.updatedAt.slice(0, 10))} ${updUtc} UTC`)}
<section class="kpis">
  <div class="kpi"><div class="lbl">Yönetici işlemleri · ${dayShort(lastDay)}</div>
    <div class="two"><div><b class="up">${num(pulse.buyCount)} alım</b><span>${money(pulse.buyValue)}</span></div><div><b class="down">${num(pulse.sellCount)} satış</b><span>${money(pulse.sellValue)}</span></div></div>
    <div class="sub">Alımlar ${pct(buyShare, 1, false)} · yöneticiler net ${buyShare >= 50 ? 'alıcı' : 'satıcı'}</div></div>
  <div class="kpi"><div class="lbl">Yeni 13F bildirimi · ${dayShort(lastFilingDay)}</div><b>${num(dayRows.length)}</b><div class="sub">${amendedN} düzeltme · ${newQ} yeni çeyrek (${q('2026-09-30')})</div></div>
  <div class="kpi"><div class="lbl">Takip listem</div><b>${watch.length} fon</b><div class="sub">Bu hafta bildirim yapan yok · son: ${dayShort(watch[0].filed)}</div></div>
  <div class="kpi"><div class="lbl">Sıradaki 13F son tarihi</div><b>${day(dl.deadline)}</b><div class="sub">${dl.quarter.replace(/Q(\d) (\d+)/, '$2 Q$1')} bildirimleri · ${daysTo(dl.deadline)} gün kaldı</div></div>
</section>
<div class="cols">
<div class="col">
  <section class="card">
    <div class="head"><h2>Takip listendeki fonlar bu çeyrek ne yaptı?</h2><a href="/watchlist">Tümü →</a></div>
    <p class="desc">Her fonun son 13F bildirimindeki en büyük hamleleri, pay adedine göre.</p>
    <div class="fundcards">
      ${watch.map((u) => `<article class="fund">
        ${fundLogo(u.manager)}
        <div class="who"><b>${esc(u.manager.replace(/\s*\(.*\)$/, ''))}</b><span class="muted small">${esc(u.manager.match(/\((.*)\)/)?.[1] || '')} · ${money(u.aum)} · ${dayShort(u.filed)}</span></div>
        <div class="chips">${chipsOf(u).map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join('')}</div>
      </article>`).join('\n      ')}
      <a class="fund add" href="/gurus">+ Fon ekle</a>
    </div>
  </section>
  <section class="card">
    <div class="head"><h2>Son bildirim gününün öne çıkan yönetici alımları</h2><a href="/insiders">Insider →</a></div>
    <p class="desc">CEO, CFO gibi üst düzey yöneticilerin kendi şirket hissesini açık piyasadan alması. Form 4, 2 iş günü içinde SEC'e bildirilir.</p>
    <table class="tbl">
      <thead><tr><th>Hisse</th><th>Kim aldı</th><th class="r">Tutar</th><th class="r">Alımdan bu yana</th><th></th></tr></thead>
      <tbody>
        ${cluster.map((c) => `<tr><td><div class="sym">${logo(c.t)}<div><b>${c.t}</b><span>${esc(coName(c.t, c.c))}</span></div><span class="chip new">Küme alımı · ${c.insiders} yönetici</span></div></td><td><span class="role">Yön. Kurulu ×${c.insiders}</span></td><td class="r">${money(c.v)}</td><td class="r ${cls(c.ret)}">${pct(c.ret)}</td><td class="r"><a href="/stock/${c.t}">Detay ›</a></td></tr>`).join('\n        ')}
        ${csuite.map((c) => `<tr><td><div class="sym">${logo(c.t)}<div><b>${c.t}</b><span>${esc(coName(c.t, c.c))}</span></div></div></td><td><span class="role ${c.r}">${ROLE[c.r] || c.r}</span> <span class="muted small">${esc(c.n.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '))}</span></td><td class="r">${money(c.v)}</td><td class="r ${cls(c.ret)}">${pct(c.ret)}</td><td class="r"><a href="/stock/${c.t}">Detay ›</a></td></tr>`).join('\n        ')}
      </tbody>
    </table>
  </section>
</div>
<aside class="col side-col">
  <section class="card">
    <div class="head"><h2>Ustaların en çok tuttuğu</h2><a href="/consensus">Tam liste →</a></div>
    <ol class="toplist">
      ${top5.map((m) => `<li>${logo(m.ticker, 24)}<div><b>${m.ticker}</b><span>${esc(coName(m.ticker, m.issuer))}</span></div><div class="r"><b>${m.holderCount} usta</b><span>${money(m.totalValue)}</span></div></li>`).join('\n      ')}
    </ol>
  </section>
  <section class="card">
    <div class="head"><h2>Piyasa</h2><span class="muted small">${dayShort(returns.SPY.asOf)}</span></div>
    <table class="tbl mini"><tbody>
      ${[['S&P 500', 'SPY'], ['Nasdaq 100', 'QQQ'], ['Russell 2000', 'IWM']].map(([n, s]) => `<tr><td>${n}</td><td class="r ${cls(returns[s].ret1d)}">${pct(returns[s].ret1d, 2)}</td><td class="r muted">YBB <b class="${cls(returns[s].retYtd)}">${pct(returns[s].retYtd)}</b></td></tr>`).join('')}
    </tbody></table>
    <div class="muted small mt">${tr(usdTry)} ₺/$ · ${dayShort(tryRate[0])}</div>
  </section>
  <section class="card dark">
    <div class="lbl">Biliyor muydun?</div>
    <p>13F bildirimleri çeyrek bittikten en geç 45 gün sonra verilir; yani bir fonun "bu çeyrek" aldığı hisseyi en erken 45 gün gecikmeyle görürsün.</p>
    <a href="/rehber">Öğren →</a>
  </section>
</aside>
</div>`;

// =====================================================================
// Fon.html — Berkshire
// =====================================================================
const FUND_NAV = [['ozet', 'Özet'], ['ceyrek', 'Bu çeyrek ne yaptı'], ['pozisyonlar', 'Pozisyonlar'], ['dagilim', 'Dağılım'], ['gecmis', 'Geçmiş'], ['backtest', 'Backtest'], ['sss', 'Sık sorulanlar']];
const subnav = (items) => `<div class="subnav"><div class="lbl">BU SAYFADA</div><ul>${items.map(([id, l], i) => `<li><a href="#${id}" ${i === 0 ? 'class="on"' : ''}>${l}</a></li>`).join('')}</ul></div>`;
const chg = (p) => {
  const c = changeOf(p.cusip);
  if (!c) return '<span class="muted">—</span>';
  if (c.kind === 'new') return '<span class="chip new">Yeni</span>';
  if (c.kind === 'same') return '<span class="muted">Değişmedi</span>';
  return `<span class="${c.d > 0 ? 'up' : 'down'}">${c.d > 0 ? '▲' : '▼'} ${pct(c.d)} pay</span>`;
};
const posRow = (p, i) => {
  const sr = sinceReport(p.t);
  return `<tr><td class="muted">${i + 1}</td><td><div class="sym">${logo(p.t || '?')}<div><b>${p.t || '—'}</b><span>${esc(coName(p.t, p.issuer))}</span></div></div></td><td class="r">${money(p.value)}</td><td class="r"><div class="wbar"><span>${pct(p.weight, 1, false)}</span><i style="width:${Math.min(100, (p.weight / positions[0].weight) * 100)}%"></i></div></td><td class="r">${chg(p)}</td><td class="r ${cls(sr)}">${pct(sr)}</td><td class="r muted">${heldLabel(p.cusip)}</td><td class="r">${num(p.shares)}</td></tr>`;
};
const cardList = (title, kind, rows, fmt) => `<article class="qcard ${kind}"><div class="lbl">${title} · ${rows.length}</div>${rows.length ? `<ul>${rows.slice(0, 3).map((x) => `<li>${logo(x.ticker || '?', 20)}<b>${x.ticker || coName(null, x.issuer)}</b><span>${fmt(x)}</span></li>`).join('')}</ul>${rows.length > 3 ? `<a href="#" class="small">+ ${rows.slice(3).map((x) => x.ticker).join(', ')}</a>` : ''}` : '<p class="muted small">Bu çeyrek yok</p>'}</article>`;
const maxAum = Math.max(...aum8.map((x) => x.aum));
const fonBody = `
${topbar('Berkshire Hathaway', `${q(brk.reportDate)} bildirimi · son veri: ${dayShort(lastDay)}`, '<button class="btn ghost">☆ Takip et</button><button class="btn ghost">Excel</button><select class="btn ghost" aria-label="Çeyrek"><option>2026 Q2</option><option>2026 Q1</option><option>2025 Q4</option></select>')}
<nav class="crumbs" aria-label="Kırıntı"><a href="/gurus">Ustalar</a> › <a href="/gurus?cat=value">Değer yatırımcısı</a> › <span>Berkshire Hathaway</span></nav>
<section id="ozet" class="fundhead">
  ${fundLogo('Berkshire Hathaway', 56)}
  <div>
    <h1>Berkshire Hathaway <span class="muted">· Warren Buffett</span></h1>
    <div class="chips"><span class="chip">Değer yatırımcısı</span><span class="chip">Omaha, NE</span><span class="chip">Dönem sonu ${day(brk.reportDate)}</span><span class="chip">SEC'e bildirim ${day(brk.filed)}</span><a class="chip" href="https://www.sec.gov/Archives/edgar/data/1067983/${brk.acc.replace(/-/g, '')}/" title="SEC EDGAR · CIK ${BRK}">SEC kaynağını aç ↗</a></div>
  </div>
</section>
<section class="summary">
  <p>${dayLong(brk.reportDate)} itibarıyla <b>${brk.count} pozisyon</b>, toplam <b>${money(brk.aum)}</b>. En büyük pozisyon ${esc(coName(positions[0].t, positions[0].issuer))} (${pct(positions[0].weight, 0, false)}). Bu çeyrek en büyük hamle: ${esc(coName(biggestAdd.ticker, biggestAdd.issuer))}'i <b>${pct(biggestAdd.change, 0)} artırdı</b>, ${esc(coName(biggestExit?.ticker, biggestExit?.issuer))}'ten <b>tamamen çıktı</b>.</p>
</section>
<section class="kpis four">
  <div class="kpi"><div class="lbl">Portföy büyüklüğü</div><b>${money(brk.aum)}</b><div class="sub ${cls(aumQoq)}">${pct(aumQoq)} 3 aylık</div><p class="desc">Fonun SEC'e bildirdiği ABD hisselerinin toplam değeri.</p></div>
  <div class="kpi"><div class="lbl">Pozisyon</div><b>${brk.count}</b><div class="sub">${lastQ.newCount} yeni · ${lastQ.exitCount} çıkış</div><p class="desc">Bu çeyrek tutulan farklı hisse sayısı.</p></div>
  <div class="kpi"><div class="lbl">İlk 10 hissenin payı</div><b>${pct(top10, 1, false)}</b><div class="sub">çok odaklı portföy</div><p class="desc">Portföyün yüzde kaçı en büyük 10 hissede. Yüksekse fon az sayıda hisseye odaklı.</p></div>
  <div class="kpi"><div class="lbl">İlk 50 pozisyonun 1 yıllık getirisi</div><b class="${cls(brkRet1y)}">${pct(brkRet1y)}</b><div class="sub">S&P 500 ${pct(returns.SPY.ret1y)}</div><p class="desc">Bugünkü ağırlıklarla, son 1 yılın fiyat getirisi; fonun gerçek getirisi değil.</p></div>
</section>
<section id="ceyrek" class="card">
  <div class="head"><h2>Bu çeyrek ne yaptı?</h2><span class="muted small">${q(prevQ.reportDate)} → ${q(lastQ.reportDate)} · pay adedine göre · fiyat hareketi sayılmaz</span></div>
  <div class="qgrid">
    ${cardList('YENİ ALIM', 'new', brkUpd.newBuys, (x) => coName(x.ticker, x.issuer))}
    ${cardList('ARTIRDI', 'add', brkUpd.adds, (x) => pct(x.change, 0) + ' pay')}
    ${cardList('AZALTTI', 'reduce', brkUpd.reduces, (x) => pct(x.change, 0) + ' pay')}
    ${cardList('TAMAMEN ÇIKTI', 'exit', brkUpd.exits, (x) => coName(x.ticker, x.issuer))}
  </div>
</section>
<section id="pozisyonlar" class="card">
  <div class="head"><h2>Pozisyonlar</h2><label class="search sm"><span aria-hidden="true">⌕</span><input type="search" placeholder="Hisse ara" aria-label="Pozisyonlarda ara"></label></div>
  <table class="tbl positions">
    <thead><tr><th>#</th><th>Hisse</th><th class="r">Değer</th><th class="r">Portföy payı</th><th class="r">Çeyrek değişimi</th><th class="r" title="Fonun bildirdiği çeyrek sonu kapanışı ile bugünkü fiyat arasındaki % fark.">Bildirimden bu yana</th><th class="r">Elinde tutma</th><th class="r">Adet</th></tr></thead>
    <tbody>${positions.slice(0, 6).map(posRow).join('\n')}</tbody>
  </table>
  <button class="btn ghost wide">${brk.count - 6} pozisyon daha göster</button>
</section>
<div class="cols two">
<section id="dagilim" class="card">
  <div class="head"><h2>Sektör dağılımı</h2></div>
  <div class="hbars">
    ${[...sec4, ['Diğer', secOther]].map(([s, v]) => `<div class="hbar"><span>${SECTOR_TR[s] || s}</span><i style="width:${(v / sec4[0][1]) * 100}%"></i><b>${pct(v, 0, false)}</b></div>`).join('')}
  </div>
</section>
<section id="gecmis" class="card">
  <div class="head"><h2>Portföy büyüklüğü · son 8 çeyrek</h2></div>
  <div class="vbars" role="img" aria-label="Son 8 çeyrek portföy büyüklüğü">
    ${aum8.map((x) => `<div class="vbar" title="${q(x.reportDate)}: ${money(x.aum)}">${x === aum8.at(-1) ? `<em>${money(x.aum)}</em>` : ''}<i style="height:${(x.aum / maxAum) * 100}%"></i><span>${q(x.reportDate).replace('20', '').replace(' ', ' ')}</span></div>`).join('')}
  </div>
  <p class="muted small">13F toplamları, birim düzeltmesi uygulanmış. Üzerine gelince değer.</p>
</section>
</div>
<section id="backtest" class="card"><div class="head"><h2>Backtest</h2><span class="badge pro">PRO</span></div><p class="muted small">[mevcut backtest bölümü — değişmiyor]</p></section>
<section id="sss" class="card">
  <h2>Sık sorulanlar</h2>
  <details open><summary>Berkshire Hathaway ${q(brk.reportDate)}'de ne aldı?</summary><p>${brkUpd.newBuys.length} yeni pozisyon açtı (${brkUpd.newBuys.map((x) => coName(x.ticker, x.issuer)).join(', ')}) ve ${brkUpd.adds.length} pozisyonu artırdı; en büyüğü ${coName(biggestAdd.ticker, biggestAdd.issuer)} (${pct(biggestAdd.change, 0)} pay).</p></details>
  <details><summary>Ne sattı?</summary><p>${brkUpd.exits.length} pozisyondan tamamen çıktı (${brkUpd.exits.map((x) => coName(x.ticker, x.issuer)).join(', ')}) ve ${brkUpd.reduces.length} pozisyonu azalttı; en büyüğü ${coName(biggestReduce.ticker, biggestReduce.issuer)} (${pct(biggestReduce.change, 0)} pay).</p></details>
  <details><summary>Bu veri ne kadar güncel?</summary><p>13F bildirimleri çeyrek sonundan itibaren 45 güne kadar gecikmeli gelir. Bu sayfa ${day(brk.filed)} tarihli bildirime dayanır; fiyatlar her gece güncellenir.</p></details>
</section>`;

// =====================================================================
// Hisse.html — AAPL
// =====================================================================
const STOCK_NAV = [['ozet', 'Özet'], ['kim', 'Kim tutuyor'], ['fiyat', 'Fiyat'], ['temel', 'Temel veriler'], ['yonetici', 'Yönetici işlemleri']];
const pe = aaplLast.close / aaplFun.eps.value;
const dy = (aaplFun.div.value / aaplLast.close) * 100;
const mcap = aaplFun.shares.value * aaplLast.close;
const act = (h) => ({ add: 'Artırdı', reduce: 'Azalttı', hold: 'Değişmedi', new: 'Yeni' }[h.activity] || h.activity);
// 1 yıllık çizgi: SVG yolu (haftalık örnekleme)
const pts = year.filter((_, i) => i % 5 === 0 || i === year.length - 1);
const lo = Math.min(...pts.map((p) => p.close)), hi = Math.max(...pts.map((p) => p.close));
const W = 640, H = 220;
const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((p.close - lo) / (hi - lo)) * (H - 20) - 10).toFixed(1)}`).join(' ');
const d1 = ((aaplLast.close - aaplPrev.close) / aaplPrev.close) * 100;
const KIND = { P: 'Alım', S: 'Satış', M: 'Opsiyon kullanımı', A: 'Hisse ödülü', F: 'Vergi için teslim', G: 'Bağış' };
const hisseBody = `
${topbar('Apple', `fiyat: ${dayShort(aaplLast.date)} kapanışı · 13F: ${q(consensus.quarter)}`, '<button class="btn ghost">☆ Takip et</button><button class="btn ghost">⇄ Karşılaştır</button><a class="btn ghost" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193">SEC ↗</a>')}
<nav class="crumbs" aria-label="Kırıntı"><a href="/screen/stocks">Hisseler</a> › <a href="/screen/stocks?sector=tech">Teknoloji</a> › <span>Apple</span></nav>
<section id="ozet" class="fundhead stock">
  ${logo('AAPL', 56)}
  <div>
    <h1>Apple Inc. <span class="muted">· AAPL · NASDAQ</span></h1>
    <div class="price"><b>${tr(aaplLast.close)} <small>USD</small></b><span class="badge ${cls(d1)}">${pct(d1, 2)}</span><span class="muted small">≈ ₺${num(aaplLast.close * usdTry)} · kapanış ${dayShort(aaplLast.date)}</span></div>
    <div class="perf">${[['1G', 'd1'], ['1H', 'w1'], ['1A', 'm1'], ['6A', 'm6'], ['YBB', 'ytd'], ['1Y', 'y1'], ['5Y', 'y5']].map(([l, k]) => `<span><em>${l}</em><b class="${cls(aaplPerf.periods[k])}">${pct(aaplPerf.periods[k])}</b></span>`).join('')}</div>
  </div>
</section>
<section class="summary">
  <p>Takip ettiğimiz ${consensus.coverage.tracked} ünlü yatırımcıdan <b>${aapl.holderCount}'u</b> Apple tutuyor, toplam <b>${money(aapl.totalValue)}</b>. Bu çeyrek <b>${aapl.buyers}'i aldı</b>, <b>${aapl.sellers}'u sattı</b>. En büyük sahip: ${esc(holders3[0].name.replace(/\s*\(.*\)$/, ''))} (${esc(holders3[0].name.match(/\((.*)\)/)?.[1] || '')}), portföyünün ${pct(holders3[0].weight, 0, false)}'i.</p>
</section>
<section id="kim" class="card">
  <div class="head"><h2>Kim tutuyor?</h2><a href="/stock/AAPL#holders">${aapl.holderCount} ustanın tamamı →</a></div>
  <p class="desc">Portföy payına göre ilk 3 usta ve bu çeyrekteki hareketleri.</p>
  <div class="holders">
    ${holders3.map((h) => `<article class="holder">${fundLogo(h.name, 40)}<div><b>${esc(h.name.replace(/\s*\(.*\)$/, ''))}</b><span class="muted small">${esc(h.name.match(/\((.*)\)/)?.[1] || '')}</span><div class="mt"><span class="chip">Portföy payı ${pct(h.weight, 1, false)}</span> <span class="chip ${h.activity}">Bu çeyrek: ${act(h)}${h.change ? ` ${pct(h.change, 0)}` : ''}</span></div></div></article>`).join('')}
    <div class="minis">
      <div class="kpi"><div class="lbl">Bu çeyrek aldı</div><b class="up">${aapl.buyers} usta</b><div class="sub">${money(aapl.buyValue)}</div></div>
      <div class="kpi"><div class="lbl">Bu çeyrek sattı</div><b class="down">${aapl.sellers} usta</b><div class="sub">${money(aapl.sellValue)}</div></div>
      <div class="kpi"><div class="lbl">Net akış</div><b class="${cls(aapl.netValue)}">${money(aapl.netValue)}</b><div class="sub">pay adedi × çeyrek sonu fiyatı</div></div>
    </div>
  </div>
</section>
<section id="fiyat" class="card">
  <div class="head"><h2>Fiyat</h2><div class="seg-group">${['1A', '3A', '6A', '1Y', '5Y'].map((l) => `<button class="seg ${l === '1Y' ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  <div class="cols chart">
    <svg viewBox="0 0 ${W} ${H}" class="line" role="img" aria-label="AAPL son 1 yıl kapanış"><path d="${linePath}"/><circle cx="${W}" cy="${(H - ((aaplLast.close - lo) / (hi - lo)) * (H - 20) - 10).toFixed(1)}" r="4"/></svg>
    <table class="tbl mini facts"><tbody>
      <tr><td>Önceki kapanış</td><td class="r">${tr(aaplPrev.close)}</td></tr>
      <tr><td>52 hafta</td><td class="r">${tr(aaplMeta.lo)} – ${tr(aaplMeta.hi)}</td></tr>
    </tbody></table>
  </div>
  <p class="muted small">Gün aralığı ve hacim: veri kaynağında yok, satır gizli.</p>
</section>
<section id="temel" class="card">
  <div class="head"><h2>Temel veriler</h2></div>
  <p class="desc">Kaynak: Apple'ın SEC'e verdiği ${aaplFun.eps.form}, ${day(aaplFun.eps.filed)} · <a href="${aaplFun.eps.url}">bildirimi aç ↗</a></p>
  <table class="tbl facts wide"><tbody>
    <tr><td><b>Piyasa değeri</b><span>Dolaşımdaki hisse × fiyat.</span></td><td class="r">${money(mcap)}</td></tr>
    <tr><td><b>F/K</b><span>Fiyatın son 12 ay hisse başı kâra oranı; kaç yıllık kâr ödediğini söyler.</span></td><td class="r">${tr(pe, 1)}</td></tr>
    <tr><td><b>Hisse başı kâr (12 ay)</b><span>Son dört çeyreğin toplam net kârı, hisse başına.</span></td><td class="r">$${tr(aaplFun.eps.value)}</td></tr>
    <tr><td><b>Beta</b><span>Piyasaya göre oynaklık; 1 üzeri endeksten sert hareket eder.</span></td><td class="r">${tr(aaplFun.beta.value)}</td></tr>
    <tr><td><b>Temettü verimi</b><span>Yıllık temettünün fiyata oranı.</span></td><td class="r">${pct(dy, 2, false)}</td></tr>
  </tbody></table>
</section>
<section id="yonetici" class="card">
  <div class="head"><h2>Yönetici işlemleri</h2><a href="/insiders?q=AAPL">Tümü →</a></div>
  <p class="desc">Şirket yöneticileri kendi hisselerini alıp sattığında 2 iş günü içinde SEC'e bildirir (Form 4).</p>
  ${aaplIns.length ? `<table class="tbl"><thead><tr><th>Tarih</th><th>Kim</th><th>İşlem</th><th class="r">Adet</th><th class="r">Fiyat</th><th class="r">Tutar</th><th class="r">Alımdan bu yana</th></tr></thead><tbody>
    ${aaplIns.map((x) => `<tr><td>${dayShort(x.d)}</td><td><b>${esc(x.n.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '))}</b><span class="muted small"> · ${esc(x.ti || ROLE[x.r] || '')}</span></td><td><span class="chip ${x.k === 'P' ? 'add' : x.k === 'S' ? 'reduce' : ''}">${KIND[x.k] || x.k}</span></td><td class="r">${num(x.s)}</td><td class="r">${x.p ? '$' + tr(x.p) : '—'}</td><td class="r">${x.v ? money(x.v) : '—'}</td><td class="r muted">${x.k === 'P' || x.k === 'S' ? pct(((aaplLast.close - x.p) / x.p) * 100) : '—'}</td></tr>`).join('')}
  </tbody></table>` : '<p class="muted">Son 12 ayda bildirilen işlem yok.</p>'}
</section>`;

// =====================================================================
// FonMobil.html — Berkshire, 390px
// =====================================================================
const mobBody = `
<header class="top mob">
  <a href="/gurus" class="icon" aria-label="Geri">‹</a>
  <h1>Berkshire Hathaway</h1>
  <div class="tools"><button class="icon" aria-label="Takip et">☆</button><button class="icon" aria-label="Paylaş">⇪</button><button class="icon" id="theme" aria-label="Tema">◐</button></div>
</header>
<div class="chipnav">${FUND_NAV.filter(([k]) => k !== 'backtest').map(([id, l], i) => `<a href="#${id}" ${i === 0 ? 'class="on"' : ''}>${l}</a>`).join('')}</div>
<section id="ozet" class="fundhead">
  ${fundLogo('Berkshire Hathaway', 44)}
  <div><div class="muted small">Warren Buffett · Değer yatırımcısı</div><div class="chips"><span class="chip">Dönem sonu ${dayShort(brk.reportDate)}</span><span class="chip">SEC'e bildirim ${dayShort(brk.filed)}</span></div></div>
</section>
<section class="summary"><p>${dayLong(brk.reportDate)} itibarıyla <b>${brk.count} pozisyon</b>, toplam <b>${money(brk.aum)}</b>. En büyük pozisyon ${esc(coName(positions[0].t, positions[0].issuer))} (${pct(positions[0].weight, 0, false)}). Bu çeyrek: ${esc(coName(biggestAdd.ticker, biggestAdd.issuer))} <b>${pct(biggestAdd.change, 0)}</b>, ${esc(coName(biggestExit?.ticker, biggestExit?.issuer))}'ten <b>çıktı</b>.</p></section>
<section class="kpis two">
  <div class="kpi"><div class="lbl">Portföy</div><b>${money(brk.aum)}</b><div class="sub ${cls(aumQoq)}">${pct(aumQoq)} 3 aylık</div></div>
  <div class="kpi"><div class="lbl">Pozisyon</div><b>${brk.count}</b><div class="sub">${lastQ.newCount} yeni · ${lastQ.exitCount} çıkış</div></div>
  <div class="kpi"><div class="lbl">İlk 10 payı</div><b>${pct(top10, 0, false)}</b><div class="sub">çok odaklı</div></div>
  <div class="kpi"><div class="lbl">1Y getiri (ilk 50)</div><b class="${cls(brkRet1y)}">${pct(brkRet1y)}</b><div class="sub">S&P ${pct(returns.SPY.ret1y)}</div></div>
</section>
<section id="ceyrek" class="card">
  <div class="head"><h2>Bu çeyrek ne yaptı?</h2></div>
  <div class="muted small">${q(prevQ.reportDate)} → ${q(lastQ.reportDate)} · pay adedine göre</div>
  <div class="qgrid">
    ${cardList('YENİ', 'new', brkUpd.newBuys, (x) => coName(x.ticker, x.issuer))}
    ${cardList('ARTIRDI', 'add', brkUpd.adds, (x) => pct(x.change, 0))}
    ${cardList('AZALTTI', 'reduce', brkUpd.reduces, (x) => pct(x.change, 0))}
    ${cardList('ÇIKTI', 'exit', brkUpd.exits, (x) => coName(x.ticker, x.issuer))}
  </div>
</section>
<section id="pozisyonlar" class="card">
  <div class="head"><h2>Pozisyonlar</h2></div>
  <div class="rows">
    ${positions.slice(0, 6).map((p) => { const sr = sinceReport(p.t); return `<a class="row" href="/stock/${p.t}">${logo(p.t || '?', 32)}<div><b>${esc(coName(p.t, p.issuer))}</b><span class="muted small">${pct(p.weight, 1, false)} · ${heldLabel(p.cusip)}</span></div><div class="r"><b>${money(p.value)}</b><span class="${cls(sr)} small">${pct(sr)}</span></div></a>`; }).join('')}
  </div>
  <button class="btn ghost wide">${brk.count - 6} pozisyon daha göster</button>
</section>
<section id="dagilim" class="card"><div class="head"><h2>Sektör dağılımı</h2></div><div class="hbars">${[...sec4, ['Diğer', secOther]].map(([s, v]) => `<div class="hbar"><span>${SECTOR_TR[s] || s}</span><i style="width:${(v / sec4[0][1]) * 100}%"></i><b>${pct(v, 0, false)}</b></div>`).join('')}</div></section>
<section id="gecmis" class="card"><div class="head"><h2>Son 8 çeyrek</h2></div><div class="vbars">${aum8.map((x) => `<div class="vbar" title="${q(x.reportDate)}: ${money(x.aum)}"><i style="height:${(x.aum / maxAum) * 100}%"></i><span>${q(x.reportDate).slice(2).replace(' ', '')}</span></div>`).join('')}</div></section>
<section id="sss" class="card"><h2>Sık sorulanlar</h2><details><summary>Ne aldı?</summary><p>${brkUpd.newBuys.map((x) => coName(x.ticker, x.issuer)).join(', ')}; ${coName(biggestAdd.ticker, biggestAdd.issuer)} ${pct(biggestAdd.change, 0)}.</p></details><details><summary>Ne sattı?</summary><p>${brkUpd.exits.map((x) => coName(x.ticker, x.issuer)).join(', ')} (çıkış); ${coName(biggestReduce.ticker, biggestReduce.issuer)} ${pct(biggestReduce.change, 0)}.</p></details><details><summary>Bu veri ne kadar güncel?</summary><p>${day(brk.filed)} tarihli 13F; fiyatlar her gece.</p></details></section>`;

// ---------- yaz ----------
fs.writeFileSync(path.join(here, 'Main.html'), page({ title: 'Bugün', body: mainBody, active: 'bugun' }));
fs.writeFileSync(path.join(here, 'Fon.html'), page({ title: 'Fon · Berkshire', body: fonBody, active: 'ustalar', nav: subnav(FUND_NAV) }));
fs.writeFileSync(path.join(here, 'Hisse.html'), page({ title: 'Hisse · AAPL', body: hisseBody, active: 'hisseler', nav: subnav(STOCK_NAV) }));
fs.writeFileSync(path.join(here, 'FonMobil.html'), page({ title: 'Fon · Berkshire (telefon)', body: mobBody, mobile: true, active: 'ustalar' }));
console.log('mockups written:', ['Main.html', 'Fon.html', 'Hisse.html', 'FonMobil.html'].join(', '));
