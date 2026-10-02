// Why Finnhub answers 403: the same calls with and without the key, the key
// as the `token` parameter and as the X-Finnhub-Token header, on /quote and
// on another free endpoint (/stock/profile2). Prints the HTTP status and the
// first 200 characters of each body; never the key (only its shape: length,
// whether it carries spaces, a line break or quotes from a bad paste).
const KEY = process.env.FINNHUB_API_KEY || '';
const BASE = 'https://finnhub.io/api/v1';
const mask = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

console.log(`key: ${KEY ? `set, ${KEY.length} chars` : 'NOT set'}` +
  (KEY ? `, whitespace ${/\s/.test(KEY) ? 'YES' : 'no'}, line break ${/[\r\n]/.test(KEY) ? 'YES' : 'no'}, quotes ${/["']/.test(KEY) ? 'YES' : 'no'}, trimmed length ${KEY.trim().length}, charset ${/^[A-Za-z0-9]+$/.test(KEY.trim()) ? 'alphanumeric' : 'other'}` : ''));

const ip = await fetch('https://api.ipify.org').then((r) => r.text()).catch((e) => `? (${e.message})`);
console.log(`runner IP: ${ip}`);

const CASES = [
  ['a  no key           /quote', `${BASE}/quote?symbol=AAPL`, {}],
  ['b  token parameter  /quote', `${BASE}/quote?symbol=AAPL&token=${encodeURIComponent(KEY)}`, {}],
  ['b2 header           /quote', `${BASE}/quote?symbol=AAPL`, { 'X-Finnhub-Token': KEY }],
  ['b3 trimmed token    /quote', `${BASE}/quote?symbol=AAPL&token=${encodeURIComponent(KEY.trim())}`, {}],
  ['c  token parameter  /stock/profile2', `${BASE}/stock/profile2?symbol=AAPL&token=${encodeURIComponent(KEY)}`, {}],
  ['c2 header           /stock/profile2', `${BASE}/stock/profile2?symbol=AAPL`, { 'X-Finnhub-Token': KEY }],
];
for (const [name, url, headers] of CASES) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Fundocap probe', ...headers } });
    const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    console.log(`${name}  HTTP ${r.status}  ${mask(body)}`);
  } catch (e) {
    console.log(`${name}  request failed: ${mask(e.message)}`);
  }
  await new Promise((s) => setTimeout(s, 1100));
}
