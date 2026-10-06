// Pure helpers behind scripts/build-logos.mjs: robots.txt parsing and the
// image sniff (format + pixel size) that decides whether a site's icon is
// usable as a logo. No network here, so tests can cover the rules.
export const MIN_SIDE = 64;

// A company's website as written in a filing or a profile ("www.apple.com",
// "https://investor.x.com/", "apple.com") → its bare host for the logo CDN
// and the domain manifest; junk (empty, no dot, a mailto) → null.
export function hostOf(site) {
  const s = String(site || '').trim();
  if (!s || /^mailto:/i.test(s)) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch { return null; }
}

// The brand's registrable domain: "corporate.walmart.com" → "walmart.com",
// "ir.kkr.com" → "kkr.com", "bp.co.uk" stays — the logo CDN knows brands by
// their root, not by the investor-relations host a filing happens to list.
const TWO_LEVEL = /\.(co|com|org|net|ac|gov|edu|or|ne)\.[a-z]{2}$/;
export function rootDomain(host) {
  const h = hostOf(host);
  if (!h) return null;
  const parts = h.split('.');
  const keep = TWO_LEVEL.test(h) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

// ETFs and trusts file under the sponsor's trust ("ISHARES TR", "VANGUARD
// INDEX FDS") and the SEC feed carries no website for them; the sponsor's
// brand is the logo readers expect. Issuer name → domain, first match wins.
const SPONSORS = [
  [/\bISHARES\b/, 'ishares.com'],
  [/\bVANGUARD\b/, 'vanguard.com'],
  [/\bSPDR GOLD\b/, 'spdrgoldshares.com'],
  [/\bSPDR\b|\bSTATE STR\b|\bSELECT SECTOR\b|\bSSGA\b/, 'ssga.com'],
  [/\bINVESCO\b|\bPOWERSHARES\b/, 'invesco.com'],
  [/\bSCHWAB STRATEGIC\b|\bSCHWAB (?:U S|US) \w+ ETF\b/, 'schwabassetmanagement.com'],
  [/\bDIMENSIONAL\b/, 'dimensional.com'],
  [/\bFIRST TR(?:UST)?\b/, 'ftportfolios.com'],
  [/\bPROSHARES\b/, 'proshares.com'],
  [/\bDIREXION\b/, 'direxion.com'],
  [/\bWISDOMTREE\b/, 'wisdomtree.com'],
  [/\bARK ETF\b|\bARK INVEST\b/, 'ark-funds.com'],
  [/\bGLOBAL X\b/, 'globalxetfs.com'],
  [/\bVANECK\b|\bMARKET VECTORS\b/, 'vaneck.com'],
  [/\bPIMCO\b/, 'pimco.com'],
  [/\bGRAYSCALE\b/, 'grayscale.com'],
  [/\bJPMORGAN (?:EXCHANGE|ETF)\b|\bJ P MORGAN EXCHANGE\b/, 'jpmorgan.com'],
  [/\bGOLDMAN SACHS ETF\b/, 'gsam.com'],
  [/\bFIDELITY COVINGTON\b|\bFIDELITY .*ETF\b/, 'fidelity.com'],
  [/\bXTRACKERS\b|\bDWS\b/, 'dws.com'],
  [/\bPACER\b/, 'paceretfs.com'],
  [/\bAMPLIFY ETF\b/, 'amplifyetfs.com'],
  [/\bROUNDHILL\b/, 'roundhillinvestments.com'],
  [/\bYIELDMAX\b/, 'yieldmaxetfs.com'],
  [/\bFLEXSHARES\b/, 'flexshares.com'],
  [/\bALPS ETF\b/, 'alpsfunds.com'],
  [/\bJANUS (?:HENDERSON|DETROIT)\b/, 'janushenderson.com'],
  [/\bCAPITAL GROUP\b/, 'capitalgroup.com'],
  [/\bAVANTIS\b|\bAMERICAN CENT(?:URY|Y) ETF\b/, 'avantisinvestors.com'],
  [/\bBLACKROCK ETF\b|\bBLACKROCK FDS\b/, 'blackrock.com'],
];
export function sponsorDomain(issuer) {
  const name = String(issuer || '').toUpperCase();
  if (!name) return null;
  const hit = SPONSORS.find(([re]) => re.test(name));
  return hit ? hit[1] : null;
}

// robots.txt text → the rules for our bot: the FundocapBot group, else *
export function parseRobots(text) {
  const groups = []; let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const [, k, v] = m; const key = k.toLowerCase();
    if (key === 'user-agent') { if (!cur || cur.closed) { cur = { agents: [], allow: [], disallow: [], closed: false }; groups.push(cur); } cur.agents.push(v.trim().toLowerCase()); }
    else if (cur && (key === 'allow' || key === 'disallow')) { cur.closed = true; if (v.trim()) cur[key].push(v.trim()); }
  }
  return groups.find((g) => g.agents.includes('fundocapbot')) || groups.find((g) => g.agents.includes('*')) || { allow: [], disallow: [] };
}
// longest matching rule wins; a tie goes to Allow (the robots.txt convention)
export function robotsAllows(rules, pathname) {
  const hit = (list) => list.filter((p) => pathname.startsWith(p.replace(/\*.*$/, ''))).sort((a, b) => b.length - a.length)[0] || '';
  const a = hit(rules.allow), d = hit(rules.disallow);
  return !d || a.length >= d.length;
}

// ---------- image sniffing: format and pixel size ----------
export function imageInfo(buf) {
  const b = Buffer.from(buf);
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { ext: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { ext: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { ext: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { ext: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { ext: 'webp', w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    const n = b.readUInt16LE(4); let w = 0, h = 0;
    for (let i = 0; i < n && 6 + i * 16 + 2 <= b.length; i++) { w = Math.max(w, b[6 + i * 16] || 256); h = Math.max(h, b[7 + i * 16] || 256); }
    return { ext: 'ico', w, h };
  }
  const head = b.toString('utf8', 0, Math.min(b.length, 600)).trimStart().toLowerCase();
  if (head.startsWith('<') && head.includes('<svg')) return { ext: 'svg', w: Infinity, h: Infinity };
  return null;
}
export const usable = (info, { square = false } = {}) =>
  info && Math.min(info.w, info.h) >= MIN_SIDE && (!square || Math.max(info.w, info.h) / Math.min(info.w, info.h) <= 1.3);

