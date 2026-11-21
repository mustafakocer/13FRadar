import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// What a cold function instance pays for the first insider answer. Each case
// runs in a fresh Node process (nothing parsed, nothing cached) and reports
// the wall time of the first answer, the peak memory, and every data file
// over 1 MB the process read to give it. Run after a build:
//
//   node scripts/insiders-cold.mjs            the table below
//   node scripts/insiders-cold.mjs --json     the same, machine-readable
//
//   feed  the free /api/insider-feed answer (tab=latest)
//   ssr   the server HTML of /tr/insiders
//
// tests/insiders-cold-start.test.mjs holds the free path to "no big file
// read" with this.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const BIG = 1024 * 1024;
export const CASES = ['feed', 'ssr'];

// ---- child: one case, one process
async function child(kind) {
  const big = new Map();
  const note = (file) => {
    if (typeof file !== 'string' || big.has(file)) return;
    try {
      const size = fs.statSync(file).size;
      if (size >= BIG) big.set(file, size);
    } catch {
      /* not a file we can weigh */
    }
  };
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (file, ...rest) {
    note(file);
    return readFileSync.call(this, file, ...rest);
  };
  const readFile = fs.promises.readFile;
  fs.promises.readFile = function (file, ...rest) {
    note(file);
    return readFile.call(this, file, ...rest);
  };

  const t0 = performance.now();
  let ok = false;
  let bytes = 0;
  if (kind === 'feed') {
    const { invoke } = await import(path.join(root, 'api', '_lib', 'ssr', 'invoke.js'));
    const { default: handler } = await import(path.join(root, 'api', '_handlers', 'insider-feed.js'));
    const r = await invoke(handler, { tab: 'latest' });
    ok = r.status === 200 && Array.isArray(r.body?.rows) && r.body.rows.length > 0;
    bytes = Buffer.byteLength(JSON.stringify(r.body));
  } else {
    const { renderPage } = await import(path.join(root, 'scripts', 'page-weight.mjs'));
    const r = await renderPage('/tr/insiders');
    ok = r.status === 200 && /insider-feed/.test(r.html);
    bytes = Buffer.byteLength(r.html);
  }
  const ms = Math.round(performance.now() - t0);
  const out = {
    kind,
    ok,
    ms,
    bytes,
    rssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    big: [...big].map(([file, size]) => ({ file: path.relative(root, file), mb: Number((size / 1e6).toFixed(1)) })),
  };
  process.stdout.write(`\n@@COLD@@${JSON.stringify(out)}\n`);
  process.exit(0);
}

// ---- parent
export function measure(kind, env = {}) {
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--child', kind], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const m = /@@COLD@@(.*)/.exec(r.stdout || '');
  if (!m) throw new Error(`insiders-cold ${kind}: no result (${(r.stderr || '').slice(0, 400)})`);
  return JSON.parse(m[1]);
}

const at = process.argv.indexOf('--child');
if (at > -1) {
  await child(process.argv[at + 1]);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const results = CASES.map((k) => measure(k));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.kind.padEnd(5)} ${r.ok ? 'ok ' : 'BAD'} ${String(r.ms).padStart(5)} ms  peak ${r.rssMb} MB  answer ${(r.bytes / 1024).toFixed(0)} KB`);
      for (const b of r.big) console.log(`        read ${String(b.mb).padStart(5)} MB  ${b.file}`);
    }
  }
}
