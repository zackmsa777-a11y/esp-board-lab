// Build the standalone parts workspace and publish board assets. No npm dependencies.
import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parts = path.join(root, 'parts');
const target = path.resolve(root, process.env.CARGO_TARGET_DIR || 'parts/target');
const output = path.join(root, 'app/public/parts');
const boardsOutput = path.join(root, 'app/public/boards');
const exists = async (file) => access(file).then(() => true, () => false);

async function main() {
  const workspace = await readFile(path.join(parts, 'Cargo.toml'), 'utf8');
  const membersText = workspace.match(/members\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!membersText) throw new Error('No workspace members found in parts/Cargo.toml');
  const members = [...membersText.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const available = [];
  for (const member of members) {
    if (await exists(path.join(parts, member, 'Cargo.toml'))) available.push(member);
    else console.warn(`Warning: skipping missing part crate ${member}`);
  }
  await mkdir(target, { recursive: true });
  await mkdir(output, { recursive: true });
  let manifest = path.join(parts, 'Cargo.toml');
  let temporary;
  try {
    // Cargo rejects a workspace with a missing member before applying --exclude.
    // A temporary workspace lets present crates build during parallel development.
    if (available.length !== members.length && available.length) {
      temporary = await mkdtemp(path.join(target, 'partial-workspace-'));
      await writeFile(path.join(temporary, 'Cargo.toml'), workspace.replace(/members\s*=\s*\[[\s\S]*?\]/,
        `members = ${JSON.stringify(available)}`));
      for (const member of available) {
        const destination = path.join(temporary, member);
        await cp(path.join(parts, member), destination, { recursive: true,
          filter: (source) => !['target', '.git'].includes(path.basename(source)) });
        const crateManifest = path.join(destination, 'Cargo.toml');
        const text = await readFile(crateManifest, 'utf8');
        const sdk = path.join(root, 'vendor/esp-part-sdk/esp-part').replaceAll('\\', '/');
        await writeFile(crateManifest, text.replaceAll('../../vendor/esp-part-sdk/esp-part', sdk));
      }
      manifest = path.join(temporary, 'Cargo.toml');
    }
    if (available.length) {
      const result = spawnSync('cargo', ['build', '--manifest-path', manifest, '--target', 'wasm32-unknown-unknown', '--release'],
        { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Parts build failed (exit ${result.status})`);
      for (const member of available) {
        const text = await readFile(path.join(parts, member, 'Cargo.toml'), 'utf8');
        const name = text.match(/^name\s*=\s*"([^"]+)"/m)?.[1]?.replaceAll('-', '_');
        if (!name) throw new Error(`Missing package name for ${member}`);
        await cp(path.join(target, 'wasm32-unknown-unknown/release', `${name}.wasm`), path.join(output, `${name}.wasm`));
        console.log(`Published ${name}.wasm`);
      }
    }
  } finally {
    if (temporary && path.dirname(temporary) === target) await rm(temporary, { recursive: true, force: true });
  }
  await mkdir(boardsOutput, { recursive: true });
  const index = [];
  const entries = await readdir(path.join(root, 'boards'), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const source = path.join(root, 'boards', entry.name);
    if (!(await exists(path.join(source, 'profile.json')))) continue;
    const profile = JSON.parse(await readFile(path.join(source, 'profile.json'), 'utf8'));
    await cp(source, path.join(boardsOutput, entry.name), { recursive: true });
    index.push({ id: profile.id, name: profile.name, chip: profile.chip });
  }
  await writeFile(path.join(boardsOutput, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Published ${index.length} board profiles`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
