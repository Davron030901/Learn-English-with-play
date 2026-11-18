// `npm run check:budget` — fails when the exported web bundle breaks the brief's budget (§15:
// "keep the JS bundle under 4 MB; content is data, never bundled"). Run it after
// `npm run export:web`, in CI as in a release.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_BYTES = 4_000_000;
const dir = join(process.argv[2] ?? 'dist', '_expo', 'static', 'js', 'web');

if (!existsSync(dir)) {
  console.error(`no web export at ${dir} — run \`npm run export:web\` first`);
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const total = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
for (const f of files) console.log(`${String(statSync(join(dir, f)).size).padStart(10)}  ${f}`);
const mb = (b) => (b / 1_000_000).toFixed(2);
if (total > BUDGET_BYTES) {
  console.error(`JavaScript ${mb(total)} MB is over the ${mb(BUDGET_BYTES)} MB budget (brief §15)`);
  process.exit(1);
}
console.log(`JavaScript ${mb(total)} MB, within the ${mb(BUDGET_BYTES)} MB budget`);
