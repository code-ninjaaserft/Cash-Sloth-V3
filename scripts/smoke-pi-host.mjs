import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temporaryRoot = resolve(tmpdir());
const directory = await mkdtemp(join(temporaryRoot, 'cash-sloth-host-smoke-'));
const child = spawn(process.execPath, ['apps/pi-host/dist/main.mjs'], {
  env: { ...process.env, CASH_SLOTH_CHANNEL: 'development', CASH_SLOTH_DATA_ROOT: directory, CASH_SLOTH_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let diagnostics = '';
child.stderr.setEncoding('utf8').on('data', (data) => { diagnostics += data; });
let timer;
try {
  const address = await new Promise((resolveAddress, reject) => {
    timer = setTimeout(() => reject(new Error(`Host startup timeout. ${diagnostics}`)), 15_000);
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (data) => {
      output += data;
      const match = /listening at (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
      if (match) resolveAddress(match[1]);
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Host exited with ${code}. ${diagnostics}`)));
  });
  clearTimeout(timer);
  const response = await fetch(`${address}/api/system/info`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const info = await response.json();
  assert.equal(info.host, 'pi');
  assert.equal(info.channel, 'development');
  assert.equal(info.versions.node, process.versions.node);
  assert.equal(info.versions.electron, undefined);
  assert.match(info.sqliteVersion, /^\d+\.\d+\.\d+$/u);
  assert.deepEqual(await readdir(directory), ['development']);
  console.log('Built Node host smoke passed:', JSON.stringify(info));
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  assert.ok(resolve(directory).startsWith(temporaryRoot + sep), 'Cleanup must remain under the temporary root');
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
