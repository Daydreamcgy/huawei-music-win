import electron from 'electron';
import { spawn } from 'node:child_process';
const args = [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'out/main/index.js'];
if (process.getuid?.() === 0) console.error('Root development process: host --no-sandbox is required. BrowserWindow sandbox remains enabled. Use a normal desktop user for acceptance.');
const child = spawn(electron, args, { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
