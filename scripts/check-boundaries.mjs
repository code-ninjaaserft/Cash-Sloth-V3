import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { resolve, relative, sep } from 'node:path';
import ts from 'typescript';

const allowed = {
  domain: [],
  contracts: [],
  application: ['domain', 'contracts'],
  'infrastructure-sqlite': ['domain', 'application', 'contracts'],
  platform: ['application', 'contracts'],
  ui: ['contracts', 'i18n', 'domain'],
  i18n: [],
  desktop: ['domain', 'application', 'contracts', 'infrastructure-sqlite', 'platform'],
  'pos-ui': ['contracts', 'ui', 'i18n'],
  'customer-display': ['contracts', 'ui', 'i18n'],
  'pi-host': ['domain', 'application', 'contracts', 'infrastructure-sqlite', 'platform'],
};
const portable = new Set(['domain', 'application', 'contracts', 'ui', 'i18n', 'pos-ui', 'customer-display']);
const externalAllowed = {
  domain: [], application: [], contracts: ['zod'],
  'infrastructure-sqlite': ['drizzle-orm'], platform: [],
  ui: ['react'], i18n: [], desktop: ['electron'],
  'pos-ui': ['react', 'react-dom'], 'customer-display': [], 'pi-host': [],
};
const builtin = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/u, '')]));
const roots = [];
for (const parent of ['apps', 'packages']) {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(resolve(parent, entry.name));
  }
}
const errors = [];
const graph = new Map();
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(item.name)) continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:ts|tsx)$/u.test(item.name) && !/\.(?:test|spec)\.ts$/u.test(item.name)) files.push(path);
  }
  return files;
}
for (const root of roots) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const name = manifest.name.replace('@cash-sloth/', '');
  if (!(name in allowed)) { errors.push(`Unknown module: ${name}`); continue; }
  const dependencies = Object.keys(manifest.dependencies ?? {});
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const devDependencies = Object.keys(manifest.devDependencies ?? {});
  const workspaceDependencies = dependencies.filter((dep) => dep.startsWith('@cash-sloth/'));
  graph.set(name, [...new Set([...dependencies, ...peers, ...devDependencies])].filter((dep) => dep.startsWith('@cash-sloth/')).map((dep) => dep.replace('@cash-sloth/', '')));
  for (const dep of graph.get(name)) {
    if (!allowed[name].includes(dep)) errors.push(`${name} cannot depend on ${dep}`);
  }
  for (const file of await walk(root)) {
    const ast = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function inspect(node) {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
        else errors.push(`${relative('.', file)}: computed module loading is not allowed`);
      }
      if (specifier) {
        if (portable.has(name) && (specifier.startsWith('node:') || builtin.has(specifier) || specifier === 'electron' || /(?:sqlite|drizzle)/u.test(specifier))) errors.push(`${name}: forbidden platform import ${specifier}`);
        if (specifier.startsWith('@cash-sloth/')) {
          const dep = specifier.split('/')[1];
          if (!allowed[name].includes(dep) || !workspaceDependencies.includes(`@cash-sloth/${dep}`)) errors.push(`${name}: forbidden or undeclared import ${specifier}`);
        }
        if (!specifier.startsWith('.') && !specifier.startsWith('@cash-sloth/') && !specifier.startsWith('node:') && !builtin.has(specifier)) {
          const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
          const sourceFile = relative(root, file).startsWith(`src${sep}`);
          // Electron itself is supplied by the host executable, a dev dependency.
          const declarations = sourceFile && !(name === 'desktop' && packageName === 'electron')
            ? [...dependencies, ...peers] : [...dependencies, ...peers, ...devDependencies];
          if (!declarations.includes(packageName)) errors.push(`${name}: undeclared external import ${specifier}`);
          if (sourceFile && !externalAllowed[name].includes(packageName)) errors.push(`${name}: forbidden framework/driver import ${specifier}`);
        }
        if (specifier.startsWith('.')) {
          const target = resolve(file, '..', specifier);
          const brandingRoot = resolve('assets/branding') + sep;
          const brandingAsset = ['desktop', 'pos-ui'].includes(name) && target.startsWith(brandingRoot) && /\.(?:json|png|ico)$/u.test(target);
          if (target !== root && !target.startsWith(root + sep) && !brandingAsset) errors.push(`${name}: cross-package relative import ${specifier}`);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
  }
}
function visit(name, ancestors = []) {
  if (ancestors.includes(name)) { errors.push(`Dependency cycle: ${[...ancestors, name].join(' -> ')}`); return; }
  for (const dep of graph.get(name) ?? []) visit(dep, [...ancestors, name]);
}
for (const name of graph.keys()) visit(name);
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Architecture boundaries passed (${graph.size} modules; no cycles).`);
