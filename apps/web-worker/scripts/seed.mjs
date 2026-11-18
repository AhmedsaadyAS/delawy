// Seed CLI — reads the Spike's real data and builds idempotent SQL.
//   node scripts/seed.mjs [--sql .dev/seed.sql] [--summary .dev/seed-summary.json]
//
// Inputs (relative to apps/web-worker/):
//   ../../spike/skus.csv             — current tracked set (active = 1)
//   ../../spike/data/results.jsonl   — Spike price readings (WARP runs)
//   ./seed/removed-skus.csv         — SKUs that left skus.csv (active = 0)
//
// The SQL is applied by `npm run seed` via `wrangler d1 execute DB --local`.
// Re-running is safe: products upsert with a no-regression guard, points
// and failures use INSERT OR IGNORE, poll_runs use ON CONFLICT DO NOTHING.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed, parseCsv, toSql } from './seed-lib.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k, v];
  }),
);
const sqlPath = args.get('--sql') || join(appDir, '.dev', 'seed.sql');
const summaryPath = args.get('--summary') || join(appDir, '.dev', 'seed-summary.json');

const skusText = readFileSync(join(appDir, '..', '..', 'spike', 'skus.csv'), 'utf-8');
const resultsText = readFileSync(
  join(appDir, '..', '..', 'spike', 'data', 'results.jsonl'),
  'utf-8',
);
const removedText = readFileSync(join(appDir, 'seed', 'removed-skus.csv'), 'utf-8');

const records = resultsText
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line));

const seed = buildSeed({
  records,
  skus: parseCsv(skusText),
  removedSkus: parseCsv(removedText),
});

mkdirSync(dirname(sqlPath), { recursive: true });
writeFileSync(sqlPath, toSql(seed));
writeFileSync(summaryPath, JSON.stringify(seed.summary, null, 2));

console.log('Seed summary:');
console.log(JSON.stringify(seed.summary, null, 2));
console.log(`\nSQL written to ${sqlPath}`);
console.log(`Summary written to ${summaryPath}`);
