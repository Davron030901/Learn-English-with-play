// `npm run export:web` — the web production build, tree-shaken (DECISIONS §28).
//
// Expo's tree shaking (SDK 52+, still marked experimental) is turned on for the web export only:
// it is what keeps the JavaScript bundle under the brief's 4 MB (§15), and it is verified there
// by the Playwright suite. Native builds are left as they are until it is tried on a device.
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1',
  EXPO_UNSTABLE_TREE_SHAKING: '1',
};
const run = spawnSync('npx', ['expo', 'export', '--platform', 'web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
process.exit(run.status ?? 1);
