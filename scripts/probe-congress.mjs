// One-off probe: prints the shape of the two official STOCK Act sources so
// the Congress parsers are written against real filings, not guesses.
// Runs in GitHub Actions (US runners; efdsearch.senate.gov geo-blocks the
// rest). Prints to the log only — writes nothing to the repo.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UA = process.env.SEC_USER_AGENT || 'Fundocap congress probe';
const year = new Date().getUTCFullYear();
const dir = mkdtempSync(join(tmpdir(), 'congress-'));

async function house() {
  const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  console.log('HOUSE zip', r.status, r.headers.get('content-length'));
  const zip = join(dir, 'fd.zip');
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  console.log('zip files', readdirSync(dir));
  const xml = readFileSync(join(dir, `${year}FD.xml`), 'utf8');
  console.log('xml head:\n', xml.slice(0, 1500));
  const members = xml.split('<Member>').slice(1);
  const ptr = members.filter((m) => /<FilingType>P<\/FilingType>/.test(m));
  console.log('members', members.length, 'ptr', ptr.length);
  const types = {};
  for (const m of members) { const t = (m.match(/<FilingType>(.*?)</) || [])[1]; types[t] = (types[t] || 0) + 1; }
  console.log('filing types', types);
  const last = ptr.slice(-6);
  console.log('last ptr rows:\n', last.join('\n---\n').slice(0, 3000));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const m of last.slice(-4)) {
    const id = (m.match(/<DocID>(.*?)</) || [])[1];
    const pr = await fetch(`https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${id}.pdf`, { headers: { 'User-Agent': UA } });
    const buf = new Uint8Array(await pr.arrayBuffer());
    console.log(`\n===== PDF ${id} status ${pr.status} bytes ${buf.length}`);
    try {
      const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
      for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        // keep y/x so the table layout can be rebuilt line by line
        const lines = {};
        for (const it of tc.items) {
          const y = Math.round(it.transform[5]);
          (lines[y] ||= []).push([Math.round(it.transform[4]), it.str]);
        }
        const out = Object.keys(lines).map(Number).sort((a, b) => b - a)
          .map((y) => `${y}| ` + lines[y].sort((a, b) => a[0] - b[0]).map(([x, s]) => `${x}:${s}`).join(' '));
        console.log(`-- page ${p}/${doc.numPages}\n` + out.join('\n').slice(0, 4000));
      }
    } catch (e) { console.log('pdf error', e.message); }
  }
}

async function senate() {
  const BASE = 'https://efdsearch.senate.gov';
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const h = (extra = {}) => ({ 'User-Agent': UA, Cookie: cookie(), ...extra });
  let r = await fetch(`${BASE}/search/home/`, { headers: h() }); keep(r);
  const html = await r.text();
  const token = (html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/) || [])[1];
  console.log('SENATE home', r.status, 'token', !!token);
  r = await fetch(`${BASE}/search/home/`, { method: 'POST', redirect: 'manual', headers: h({ 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/search/home/` }), body: new URLSearchParams({ csrfmiddlewaretoken: token, prohibition_agreement: '1' }) });
  keep(r); console.log('agree', r.status, r.headers.get('location'));
  const body = new URLSearchParams({ start: '0', length: '10', report_types: '[11]', filer_types: '[]', submitted_start_date: `01/01/${year} 00:00:00`, submitted_end_date: '', candidate_state: '', senator_state: '', office_id: '', first_name: '', last_name: '', csrfmiddlewaretoken: jar.get('csrftoken') || '' });
  r = await fetch(`${BASE}/search/report/data/`, { method: 'POST', headers: h({ 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/search/`, 'X-CSRFToken': jar.get('csrftoken') || '' }), body });
  keep(r);
  const j = await r.json().catch(async () => ({ err: (await r.text()).slice(0, 500) }));
  console.log('index', r.status, 'total', j.recordsFiltered, JSON.stringify(j.data?.slice(0, 5), null, 1));
  for (const row of (j.data || []).slice(0, 3)) {
    const href = (row[3].match(/href="([^"]+)"/) || [])[1];
    if (!href || href.includes('/paper/')) { console.log('skip', href); continue; }
    const pr = await fetch(BASE + href, { headers: h() });
    const ph = await pr.text();
    const tbl = ph.slice(ph.indexOf('<table'), ph.indexOf('</table>') + 8).replace(/\s+/g, ' ');
    console.log(`\n===== ${href} ${pr.status}\n`, tbl.slice(0, 3500));
  }
}

try { await house(); } catch (e) { console.log('HOUSE FAIL', e); }
try { await senate(); } catch (e) { console.log('SENATE FAIL', e); }
