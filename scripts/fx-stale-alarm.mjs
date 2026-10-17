// The exchange-rate alarm (fpi.yml, after the commit): a currency in
// api/_data/fpi.json whose newest rate is older than 7 days opens a
// `data-alarm` issue (api/_lib/opsAlarm.js); the day every rate is fresh
// again, the issue is closed. A stale rate never stops the data: the site
// shows the trade in its own currency and leaves the dollar figures out.
//
//   node scripts/fx-stale-alarm.mjs            → raises / resolves (GITHUB_TOKEN)
//   node scripts/fx-stale-alarm.mjs --dry-run  → prints what it would say
//
// Exits 1 only when GitHub refused the alarm.
import fs from 'node:fs';
import path from 'node:path';
import { staleRates, RATE_ALARM_DAYS } from '../api/_lib/fx.js';
import { githubIssues, mentionOf, raise, resolve } from '../api/_lib/opsAlarm.js';

export const FX_ALARM_TITLE = 'Döviz kuru güncellenmiyor (fpi.json)';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fpi = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'fpi.json'), 'utf8'));
const today = process.env.FX_TODAY || new Date().toISOString().slice(0, 10);
const stale = staleRates(fpi.rates, today);
const runUrl = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

const body = [
  `${stale.length} para biriminin en yeni kuru ${RATE_ALARM_DAYS} günden eski (bugün ${today}):`,
  '',
  '| Para birimi | Son kur günü | Kaç gün önce | Kaynak |',
  '|---|---|---:|---|',
  ...stale.map((s) => `| ${s.cur} | ${s.last || '—'} | ${s.days} | ${fpi.rateSource?.[s.cur] || '—'} |`),
  '',
  'Etkisi: bu para birimindeki insider işlemleri dolara çevrilemez (sitede kendi para birimiyle, dolar tutarı olmadan görünür); 21 günü geçince o para birimiyle rapor veren şirketlerin (ör. TWD → TSMC) hisse başı kâr ve F/K değeri de boş kalır.',
  '',
  'Kaynaklar sırayla: Fed H.10 → ECB → FRED → currency-api. Çalışmanın günlüğünde her kaynağın cevabı yazar.',
  runUrl ? `\nÇalışma: ${runUrl}` : '',
].join('\n');

if (process.argv.includes('--dry-run')) {
  console.log(stale.length ? `ALARM\n\n${body}` : `all ${Object.keys(fpi.rates || {}).length} rates within ${RATE_ALARM_DAYS} days`);
  process.exit(0);
}
try {
  const issues = githubIssues({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
  const mention = mentionOf();
  if (stale.length) {
    const r = await raise(issues, { title: FX_ALARM_TITLE, body, mention });
    console.log(`${stale.map((s) => `${s.cur} ${s.days}d`).join(', ')} → issue #${r.number} ${r.action}`);
  } else {
    const r = await resolve(issues, { title: FX_ALARM_TITLE, mention, body: `Bütün kurlar ${RATE_ALARM_DAYS} gün içinde.` });
    console.log(`all rates fresh${r.number ? ` → issue #${r.number} closed` : ''}`);
  }
} catch (e) {
  console.error(`::error::the exchange-rate alarm could not be raised — ${e.message}`);
  process.exit(1);
}
