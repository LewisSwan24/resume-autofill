// Copies the page engine bundle (inject/dist/engine.js) and the demo form (demo/*) into the Android assets, where
// FillBrowserPlugin injects engine.js and WebViewAssetLoader serves assets/raf/demo/ on
// https://appassets.androidplatform.net/demo/. Exits non-zero when the engine was not built.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(mobile, 'inject', 'dist', 'engine.js');
const demo = join(mobile, 'demo');
const target = join(mobile, 'android', 'app', 'src', 'main', 'assets', 'raf');

if (!existsSync(engine)) {
  process.stderr.write('copy-page-assets: inject/dist/engine.js is missing; run the inject build first.\n');
  process.exit(1);
}

mkdirSync(join(target, 'demo'), { recursive: true });
copyFileSync(engine, join(target, 'engine.js'));
let copied = 1;
for (const name of readdirSync(demo)) {
  const from = join(demo, name);
  if (!statSync(from).isFile()) continue;
  copyFileSync(from, join(target, 'demo', name));
  copied++;
}
process.stdout.write(`copy-page-assets: ${copied} files into android/app/src/main/assets/raf\n`);
