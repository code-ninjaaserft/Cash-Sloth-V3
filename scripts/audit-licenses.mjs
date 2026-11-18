import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Read-only dependency inspection; it never changes vendor files or downloads code.
const auditDate = process.argv[2] ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/u.test(auditDate)) throw new Error('Expected an ISO audit date.');
const packages = new Map();
const warnings = [];
const noticePattern = /^(?:licen[cs]e|copying|notice|copyright)/iu;
async function notice(file) {
  const bytes = await readFile(file);
  return { file: file.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
for (const entry of await readdir('node_modules/.pnpm', { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  const modules = join('node_modules/.pnpm', entry.name, 'node_modules');
  let children;
  try { children = await readdir(modules, { withFileTypes: true }); }
  catch (error) { warnings.push({ file: modules.replaceAll('\\', '/'), issue: 'Package directory unreadable', code: error.code ?? 'UNKNOWN' }); continue; }
  const candidates = [];
  for (const child of children) {
    if (child.name.startsWith('@')) {
      for (const scoped of await readdir(join(modules, child.name))) candidates.push(join(modules, child.name, scoped));
    } else if (child.name !== '.bin') candidates.push(join(modules, child.name));
  }
  for (const directory of candidates) {
    let metadata;
    try { metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') warnings.push({ file: join(directory, 'package.json').replaceAll('\\', '/'), issue: 'Package metadata unreadable or invalid', code: error.code ?? 'UNKNOWN' });
      continue;
    }
    if (!metadata.name || !metadata.version) continue;
    const key = `${metadata.name}@${metadata.version}`;
    if (packages.has(key)) continue;
    const names = await readdir(directory);
    const notices = [];
    for (const name of names.filter((value) => noticePattern.test(value)).sort()) {
      try { notices.push(await notice(join(directory, name))); }
      catch (error) { warnings.push({ file: join(directory, name).replaceAll('\\', '/'), issue: 'Notice unreadable or requires directory review', code: error.code ?? 'UNKNOWN' }); }
    }
    packages.set(key, {
      name: metadata.name, version: metadata.version,
      declaredLicense: metadata.license ?? metadata.licenses ?? 'UNKNOWN',
      repository: metadata.repository ?? null, notices,
      metadataFile: join(directory, 'package.json').replaceAll('\\', '/'),
    });
  }
}
const inventory = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const licenseCounts = {};
for (const entry of inventory) {
  const license = typeof entry.declaredLicense === 'string' ? entry.declaredLicense : JSON.stringify(entry.declaredLicense);
  licenseCounts[license] = (licenseCounts[license] ?? 0) + 1;
}
const bundledElectronNotices = [];
for (const file of ['node_modules/electron/dist/LICENSE', 'node_modules/electron/dist/LICENSES.chromium.html']) {
  try { bundledElectronNotices.push(await notice(file)); }
  catch (error) { warnings.push({ file, issue: 'Expected Electron runtime notice unavailable', code: error.code ?? 'UNKNOWN' }); }
}
const report = {
  auditDate, platform: process.platform, architecture: process.arch,
  scope: 'Installed pnpm package metadata and top-level notice files, plus Electron runtime notices; preliminary, not a complete distribution clearance or cross-platform SBOM.',
  packageCount: inventory.length, licenseCounts, bundledElectronNotices,
  warnings,
  packagesWithoutTopLevelNotice: inventory.filter((entry) => entry.notices.length === 0).map((entry) => `${entry.name}@${entry.version}`),
  packages: inventory,
};
await mkdir('docs/licensing', { recursive: true });
await writeFile('docs/licensing/third-party-inventory.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ packageCount: report.packageCount, licenseCounts, packagesWithoutTopLevelNotice: report.packagesWithoutTopLevelNotice, electronRuntimeNoticeCount: bundledElectronNotices.length, warnings }, null, 2));
