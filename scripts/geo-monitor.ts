// AI citation monitor (GEO). Asks each configured question to Anthropic
// (claude-opus-5 + web search) and OpenAI (Responses API + web search),
// records which domains each answer cites or mentions, and whether ours
// appears. Providers without an API key are skipped. Never run in CI.
//
//   npm run geo-monitor                 → geo-monitor/results.csv (appends) +
//                                         geo-monitor/<date>.json (raw)
//   npm run geo-monitor -- --dry-run    → lists questions, calls nothing
//   npm run geo-monitor -- --limit 3    → first N questions (smoke test)
//
// Env: ANTHROPIC_API_KEY, OPENAI_API_KEY (optional each), SITE_URL or
// GEO_DOMAIN (our domain, default from config), OPENAI_MODEL (default gpt-5).
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

type Question = { lang: 'en' | 'tr'; q: string };
type Config = { domain: string; questions: Question[] };
type Result = {
  date: string;
  question: string;
  lang: string;
  provider: 'anthropic' | 'openai';
  model: string;
  citedDomains: string[];
  mentionedDomains: string[];
  ours: boolean;
  answerChars: number;
  error?: string;
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const root = process.cwd();
const config: Config = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'geo-monitor.config.json'), 'utf8'));
const ourDomain = (process.env.GEO_DOMAIN || (process.env.SITE_URL ? new URL(process.env.SITE_URL).hostname : config.domain)).replace(/^www\./, '');
const today = new Date().toISOString().slice(0, 10);
const outDir = path.join(root, 'geo-monitor');
fs.mkdirSync(outDir, { recursive: true });

const domainOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
// bare domain mentions in prose (e.g. "according to whalewisdom.com")
const mentions = (text: string) => uniq((text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|gov|co|app|ai|tr)\b/gi) || []).map((d) => d.toLowerCase().replace(/^www\./, '')));
const isOurs = (domains: string[]) => domains.some((d) => d === ourDomain || d.endsWith(`.${ourDomain}`));

const SYSTEM = 'Answer the user\'s question using web search. Cite the sources you rely on. Answer in the language of the question.';

async function askAnthropic(client: Anthropic, q: Question): Promise<Result> {
  const model = 'claude-opus-5';
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: q.q }];
  let text = '';
  const cited: (string | null)[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
    for (const block of res.content) {
      if (block.type === 'text') {
        text += block.text;
        for (const c of block.citations || []) if ('url' in c && typeof c.url === 'string') cited.push(domainOf(c.url));
      } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === 'web_search_result') cited.push(domainOf(r.url));
      }
    }
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content });
      continue;
    }
    if (res.stop_reason === 'refusal') throw new Error(`refusal: ${res.stop_details?.category ?? 'unknown'}`);
    break;
  }
  const citedDomains = uniq(cited);
  const mentionedDomains = mentions(text);
  return { date: today, question: q.q, lang: q.lang, provider: 'anthropic', model, citedDomains, mentionedDomains, ours: isOurs([...citedDomains, ...mentionedDomains]), answerChars: text.length };
}

async function askOpenAI(client: OpenAI, q: Question): Promise<Result> {
  const model = process.env.OPENAI_MODEL || 'gpt-5';
  const res = await client.responses.create({
    model,
    instructions: SYSTEM,
    input: q.q,
    tools: [{ type: 'web_search' }],
  });
  const cited: (string | null)[] = [];
  let text = '';
  for (const item of res.output as any[]) {
    if (item.type === 'message') {
      for (const part of item.content || []) {
        if (part.type === 'output_text') {
          text += part.text || '';
          for (const a of part.annotations || []) if (a.type === 'url_citation' && a.url) cited.push(domainOf(a.url));
        }
      }
    }
  }
  const citedDomains = uniq(cited);
  const mentionedDomains = mentions(text);
  return { date: today, question: q.q, lang: q.lang, provider: 'openai', model, citedDomains, mentionedDomains, ours: isOurs([...citedDomains, ...mentionedDomains]), answerChars: text.length };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const questions = config.questions.slice(0, limit);
  if (dryRun) {
    console.log(`dry run — ${questions.length} questions, our domain: ${ourDomain}`);
    for (const q of questions) console.log(`  [${q.lang}] ${q.q}`);
    console.log(`providers: anthropic=${process.env.ANTHROPIC_API_KEY ? 'on' : 'skipped (no ANTHROPIC_API_KEY)'} openai=${process.env.OPENAI_API_KEY ? 'on' : 'skipped (no OPENAI_API_KEY)'}`);
    return;
  }
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;
  if (!anthropic && !openai) {
    console.error('No provider key found (ANTHROPIC_API_KEY / OPENAI_API_KEY). Nothing to do.');
    process.exit(1);
  }
  const results: Result[] = [];
  for (const q of questions) {
    for (const [name, fn] of [
      ['anthropic', anthropic ? () => askAnthropic(anthropic, q) : null],
      ['openai', openai ? () => askOpenAI(openai, q) : null],
    ] as const) {
      if (!fn) continue;
      try {
        const r = await fn();
        results.push(r);
        console.log(`${r.ours ? '★' : '·'} ${name.padEnd(9)} [${q.lang}] ${q.q.slice(0, 60)} → ${r.citedDomains.slice(0, 5).join(', ') || '(no citations)'}`);
      } catch (e: any) {
        const msg = e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e instanceof OpenAI.APIError ? `${e.status} ${e.message}` : String(e?.message || e);
        results.push({ date: today, question: q.q, lang: q.lang, provider: name, model: '', citedDomains: [], mentionedDomains: [], ours: false, answerChars: 0, error: msg });
        console.log(`! ${name.padEnd(9)} [${q.lang}] ${q.q.slice(0, 60)} → ERROR ${msg}`);
      }
    }
  }
  const csv = path.join(outDir, 'results.csv');
  const header = 'date,question,lang,provider,model,cited_domains,mentioned_domains,our_domain_cited,answer_chars,error\n';
  if (!fs.existsSync(csv)) fs.writeFileSync(csv, header);
  fs.appendFileSync(csv, results.map((r) => [r.date, r.question, r.lang, r.provider, r.model, r.citedDomains.join(' '), r.mentionedDomains.join(' '), r.ours ? 'yes' : 'no', r.answerChars, r.error || ''].map(csvCell).join(',') + '\n').join(''));
  fs.writeFileSync(path.join(outDir, `${today}.json`), JSON.stringify(results, null, 2));
  const ours = results.filter((r) => r.ours).length;
  console.log(`\n${results.length} answers · ${ourDomain} cited in ${ours} (${results.length ? Math.round((ours / results.length) * 100) : 0}%) → ${csv}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
