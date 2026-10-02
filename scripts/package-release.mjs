import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid release version');
if (!/^[a-z0-9-]+$/.test(manifest.id)) throw new Error('Invalid plugin ID');
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  if (!statSync(`dist/${name}`).size) throw new Error(`Empty release asset: ${name}`);
}
// Python's standard library keeps ZIP packaging independent of npm dependencies.
execFileSync('python3', ['-c', `
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
manifest = json.loads(Path('dist/manifest.json').read_text())
with ZipFile(f"dist/karakeep-sync-{manifest['version']}.zip", 'w', ZIP_DEFLATED) as archive:
    for name in ('main.js', 'manifest.json', 'styles.css'):
        archive.write(Path('dist') / name, f"{manifest['id']}/{name}")
`], { stdio: 'inherit' });
console.log(`Packaged dist/karakeep-sync-${manifest.version}.zip`);
