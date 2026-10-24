import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';
import { _electron as playwright } from 'playwright-core';

const proxyRequests = [];
const blockedMediaRequests = [];
const mediaServer = http.createServer((request, response) => {
  blockedMediaRequests.push(request.url);
  response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': '44' });
  response.end(Buffer.alloc(44));
});
const proxy = http.createServer((request, response) => {
  proxyRequests.push({ method: request.method, url: request.url });
});
proxy.on('connect', (request, socket) => {
  proxyRequests.push({ method: 'CONNECT', url: request.url });
  socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
});
await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve));
const mediaPort = mediaServer.address().port;
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const { port } = proxy.address();
const proxyUrl = `http://127.0.0.1:${port}`;
let app;
const profileDir = await mkdtemp(join(tmpdir(), 'music-electron-proxy-profile-'));

try {
  app = await playwright.launch({
    executablePath: electron,
    args: ['--no-sandbox', `--user-data-dir=${profileDir}`, 'out/main/index.js'],
    env: {
      ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: '',
      NO_PROXY: 'localhost,.internal.example,127.0.0.1,10.0.0.0/8',
      http_proxy: '', https_proxy: '', all_proxy: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 10000,
  });
  const window = await app.firstWindow();
  const resolution = await app.evaluate(async ({ session }) => Promise.all([
    session.defaultSession.resolveProxy('https://audio-target.dbankcdn.cn/__proxy_probe__'),
    session.defaultSession.resolveProxy('http://api.internal.example/probe'),
    session.defaultSession.resolveProxy('http://localhost/probe'),
  ]));
  assert.ok(resolution[0].includes(`127.0.0.1:${port}`), `CDN request did not use configured proxy: ${JSON.stringify(resolution)}`);
  assert.match(resolution[1], /DIRECT/, `NO_PROXY domain exception was not honored: ${JSON.stringify(resolution)}`);
  assert.match(resolution[2], /DIRECT/, `localhost must remain direct: ${JSON.stringify(resolution)}`);
  const failures = [];
  window.on('pageerror', error => failures.push(error.message));
  window.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  const result = await window.evaluate(async () => {
    const image = new Image();
    const failed = new Promise(resolve => { image.onerror = () => resolve(true); });
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('proxy request timeout')), 5000));
    image.src = 'https://audio-target.dbankcdn.cn/__proxy_probe__';
    return Promise.race([failed, timer]);
  });
  assert.equal(result, true);
  assert.ok(proxyRequests.some(request => request.method === 'CONNECT' && request.url === 'audio-target.dbankcdn.cn:443'), JSON.stringify({ proxyRequests, failures }));
  const page = await app.firstWindow();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setBypassCSP', { enabled: true });
  const blocked = await page.evaluate(async url => {
    const audio = new Audio(url);
    const failed = new Promise(resolve => audio.addEventListener('error', () => resolve(true), { once: true }));
    audio.load();
    return Promise.race([failed, new Promise((_, reject) => setTimeout(() => reject(new Error('blocked media request timeout')), 5000))]);
  }, `http://127.0.0.1:${mediaPort}/blocked.wav`);
  assert.equal(blocked, true);
  assert.deepEqual(blockedMediaRequests, [], 'disallowed media request reached local server');
  console.log('Electron Chromium proxy route and main-process media allowlist passed: HTTPS reached the local proxy, while disallowed localhost HTTP media was blocked before network delivery. TLS checks remained enabled.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    try {
      proxy.closeAllConnections();
      mediaServer.closeAllConnections();
      if (mediaServer.listening) {
        const closed = once(mediaServer, 'close');
        mediaServer.close();
        await closed;
      }
      if (proxy.listening) {
        const closed = once(proxy, 'close');
        proxy.close();
        await closed;
      }
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  }
}
