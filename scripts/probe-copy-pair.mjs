// Evidence for a near-identical 13F pair (issue #68): who each filer is
// (EDGAR submissions: names, former names, addresses, phone), what each
// filing's cover page says (manager address, signer, CRD / SEC file
// numbers, other managers reported), how far the two information tables
// agree line by line, and the advisers' Form ADV records (IAPD).
//   PAIR="0001927315:0001104659-26-100644,0002058235:0001104659-26-091013" node scripts/probe-copy-pair.mjs
import { secGet } from '../api/_lib/sec.js';

const pair = (process.env.PAIR || '').split(',').map((s) => s.split(':'));
const strip = (cik) => String(Number(cik));
const tag = (xml, name) => [...String(xml).matchAll(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'g'))].map((m) => m[1].trim());
const one = (xml, name) => tag(xml, name)[0] ?? null;

const lines = {};
for (const [cik, acc] of pair) {
  console.log(`\n===== ${cik} · ${acc}`);
  const sub = (await secGet(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`)).data;
  console.log('name:', sub.name, '| formerNames:', JSON.stringify(sub.formerNames || []));
  console.log('business address:', JSON.stringify(sub.addresses?.business));
  console.log('mailing address:', JSON.stringify(sub.addresses?.mailing));
  console.log('phone:', sub.phone, '| state of inc.:', sub.stateOfIncorporation, '| ein:', sub.ein || '-', '| category:', sub.category || '-');
  const r = sub.filings?.recent || {};
  const forms = (r.form || []).map((f, i) => `${r.filingDate[i]} ${f} ${r.accessionNumber[i]}`).slice(0, 12);
  console.log('recent filings:', forms.join(' | '));

  const dir = `https://www.sec.gov/Archives/edgar/data/${strip(cik)}/${acc.replace(/-/g, '')}`;
  const idx = (await secGet(`${dir}/index.json`)).data;
  const names = (idx.directory?.item || []).map((i) => i.name);
  console.log('files:', names.join(', '));
  const primary = names.find((n) => /primary_doc\.xml$/i.test(n));
  if (primary) {
    const x = String((await secGet(`${dir}/${primary}`, { responseType: 'text' })).data);
    console.log('cover: filingManager', one(x, 'name'), '|', [one(x, 'street1'), one(x, 'street2'), one(x, 'city'), one(x, 'stateOrCountry'), one(x, 'zipCode')].filter(Boolean).join(', '));
    console.log('cover: signature', one(x, 'signature') || '-', '|', one(x, 'title') || '-', '|', one(x, 'phone') || '-', '|', one(x, 'signatureDate') || '-', '|', one(x, 'city') || '');
    console.log('cover: form13FFileNumber', tag(x, 'form13FFileNumber').join(' ') || '-', '| crdNumber', tag(x, 'crdNumber').join(' ') || '-', '| secFileNumber', tag(x, 'secFileNumber').join(' ') || '-');
    console.log('cover: reportType', one(x, 'reportType'), '| isAmendment', one(x, 'isAmendment'), '| tableEntryTotal', one(x, 'tableEntryTotal'), '| tableValueTotal', one(x, 'tableValueTotal'));
    const others = tag(x, 'name').slice(1);
    console.log('cover: other names on the cover (other managers / included managers):', others.join(' | ') || '-');
  }
  const table = names.find((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (table) {
    const x = String((await secGet(`${dir}/${table}`, { responseType: 'text' })).data);
    const rows = [...x.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)].map((m) => `${one(m[1], 'cusip')}|${one(m[1], 'sshPrnamt')}|${one(m[1], 'putCall') || ''}`);
    lines[cik] = rows;
    console.log('information table lines:', rows.length);
  }
}
const [a, b] = pair.map(([c]) => c);
if (lines[a] && lines[b]) {
  const B = new Map();
  for (const l of lines[b]) B.set(l, (B.get(l) || 0) + 1);
  let same = 0;
  for (const l of lines[a]) if (B.get(l) > 0) { same++; B.set(l, B.get(l) - 1); }
  console.log(`\noverlap (CUSIP + shares + put/call): ${same} of ${lines[a].length} (${a}) and of ${lines[b].length} (${b})`);
}

// Form ADV (IAPD): firm records by name
for (const q of (process.env.ADV_QUERIES || '').split(',').filter(Boolean)) {
  try {
    const r = await fetch(`https://api.adviserinfo.sec.gov/search/firm?query=${encodeURIComponent(q)}&hl=true&nrows=5&start=0&r=25&sort=score+desc&wt=json`, { headers: { 'User-Agent': process.env.SEC_USER_AGENT || 'probe' } });
    const j = await r.json().catch(() => null);
    const hits = j?.hits?.hits || [];
    console.log(`\nADV search "${q}": HTTP ${r.status}, ${hits.length} hit(s)`);
    for (const h of hits) {
      const s = h._source || {};
      console.log('  ', JSON.stringify({ name: s.firm_name, other: s.firm_other_names, crd: s.firm_source_id, sec: s.firm_ia_full_sec_number || s.firm_ia_sec_number, address: s.firm_ia_address_details || s.firm_address_details, scope: s.firm_ia_scope }).slice(0, 600));
    }
  } catch (e) {
    console.log(`ADV search "${q}": failed ${e.message}`);
  }
}
