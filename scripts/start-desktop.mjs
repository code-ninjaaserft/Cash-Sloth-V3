import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// This is the interactive app, not a hidden background helper.
const child = spawn(electron, ['apps/desktop'], { env, stdio: 'inherit', windowsHide: false });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
