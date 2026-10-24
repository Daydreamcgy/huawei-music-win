import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

function validProxy(value) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname
      && !parsed.username && !parsed.password ? parsed.origin : undefined;
  } catch { return undefined; }
}

export function readProxySettings(env = process.env) {
  const httpProxy = validProxy(env.HTTP_PROXY ?? env.http_proxy)
    ?? validProxy(env.ALL_PROXY ?? env.all_proxy)
    ?? validProxy(env.HTTPS_PROXY ?? env.https_proxy);
  const httpsProxy = validProxy(env.HTTPS_PROXY ?? env.https_proxy)
    ?? validProxy(env.ALL_PROXY ?? env.all_proxy)
    ?? validProxy(env.HTTP_PROXY ?? env.http_proxy);
  const bypass = environmentValueFrom(env, 'NO_PROXY', 'no_proxy');
  return Object.fromEntries(Object.entries({
    http: httpProxy,
    https: httpsProxy,
    bypass: bypass?.split(',').map(item => item.trim()).filter(Boolean).join(','),
  }).filter(([, value]) => value));
}

function environmentValueFrom(env, ...names) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function proxyRules(settings) {
  const rules = new Set();
  if (settings.http) rules.add(`http=${settings.http}`);
  if (settings.https) rules.add(`https=${settings.https}`);
  return rules.size ? [...rules].join(';') : undefined;
}

export function electronBypassRules(value) {
  if (!value) return undefined;
  if (value.split(',').some(entry => entry.trim() === '*')) return '*';
  const rules = new Set();
  for (const entry of value.split(',')) {
    const item = entry.trim();
    if (!item) continue;
    if (item.startsWith('.')) {
      const domain = item.slice(1);
      if (/^[a-zA-Z0-9.-]+$/.test(domain)) rules.add(`*.${domain}`);
    } else if (!item.includes('/') && /^[a-zA-Z0-9.:[\]-]+$/.test(item)) {
      rules.add(item);
    }
  }
  return rules.size ? [...rules].join(',') : undefined;
}

export function applyNodeProxy(settings = readProxySettings()) {
  if (settings.http || settings.https) {
    setGlobalDispatcher(new EnvHttpProxyAgent({
      httpProxy: settings.http,
      httpsProxy: settings.https,
      noProxy: settings.bypass,
    }));
  }
}

export function unsupportedProxyScheme(env = process.env) {
  const candidates = [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy]
    .filter(Boolean);
  return candidates.some(value => {
    try { return !['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
  });
}

export function proxyConfigurationProblem(env = process.env) {
  const candidates = [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy]
    .filter(value => typeof value === 'string' && value.trim());
  if (!candidates.length) return undefined;
  if (candidates.some(value => {
    try {
      const parsed = new URL(value);
      return !!parsed.username || !!parsed.password;
    } catch { return false; }
  })) return 'credentials';
  const effective = readProxySettings(env);
  if (effective.http || effective.https) return undefined;
  return unsupportedProxyScheme(env) ? 'unsupported' : 'invalid';
}
