import test from 'node:test';
import assert from 'node:assert/strict';
import { electronBypassRules, proxyConfigurationProblem, proxyRules, readProxySettings } from '../src/main/proxy.mjs';

test('proxy settings respect scheme-specific env and bypass list', () => {
  const settings = readProxySettings({
    HTTP_PROXY: 'http://proxy.example:8080',
    HTTPS_PROXY: 'http://secure-proxy.example:8443',
    NO_PROXY: 'localhost, .internal.example,127.0.0.1',
  });
  assert.equal(settings.http, 'http://proxy.example:8080');
  assert.equal(settings.https, 'http://secure-proxy.example:8443');
  assert.equal(settings.bypass, 'localhost,.internal.example,127.0.0.1');
  assert.equal(proxyRules(settings), 'http=http://proxy.example:8080;https=http://secure-proxy.example:8443');
});

test('invalid and unsupported proxy schemes are ignored without echoing values', () => {
  const settings = readProxySettings({
    HTTPS_PROXY: 'socks5://proxy.example:1080',
    HTTP_PROXY: 'not a proxy',
    ALL_PROXY: 'http://fallback.example:3128',
  });
  assert.equal(settings.http, 'http://fallback.example:3128');
  assert.equal(settings.https, 'http://fallback.example:3128');
  assert.equal(proxyRules(settings), 'http=http://fallback.example:3128;https=http://fallback.example:3128');
  assert.deepEqual(readProxySettings({ HTTPS_PROXY: 'http://user:secret@proxy.example:8080' }), {});
});

test('no proxy environment means no explicit Electron proxy rules', () => {
  const settings = readProxySettings({});
  assert.deepEqual(settings, {});
  assert.equal(proxyRules(settings), undefined);
});

test('Electron bypass rules normalize domain suffixes and discard unsupported CIDR entries', () => {
  assert.equal(electronBypassRules('localhost,127.0.0.1,::1,10.0.0.0/8,.internal.example'),
    'localhost,127.0.0.1,::1,*.internal.example');
  assert.equal(electronBypassRules('*'), '*');
  assert.equal(electronBypassRules('localhost,*'), '*');
});

test('proxy configuration problems are classified without exposing proxy values', () => {
  assert.equal(proxyConfigurationProblem({}), undefined);
  assert.equal(proxyConfigurationProblem({ HTTPS_PROXY: 'socks5://private-proxy:1080' }), 'unsupported');
  assert.equal(proxyConfigurationProblem({ HTTPS_PROXY: 'not a proxy' }), 'invalid');
  assert.equal(proxyConfigurationProblem({ HTTPS_PROXY: 'http://private-user:private-pass@proxy.example:8080' }), 'credentials');
  assert.equal(proxyConfigurationProblem({
    HTTPS_PROXY: 'socks5://ignored-proxy:1080', HTTP_PROXY: 'http://usable-proxy:8080',
  }), undefined);
});
