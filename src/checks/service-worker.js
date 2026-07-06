import { fetchText } from '../utils/fetch-text.js';
import { result } from '../utils/result.js';
import { resolveUrl } from '../utils/url.js';
import { findScriptUrls } from '../utils/find-script-urls.js';

export const findServiceWorkerUrls = (html, pageUrl) => {
  const matches = [...html.matchAll(
    /navigator\.serviceWorker\.register\s*\(\s*['"`]([^'"`]+)['"`]/g
  )];

  return matches.map(match => resolveUrl(pageUrl, match[1]));
};

const hasServiceWorkerRegistrationHint = source => {
  return /navigator\.serviceWorker\.register\s*\(/i.test(source);
};

export const findServiceWorkerImportUrls = (source, baseUrl) => {
  const importMatches = [...source.matchAll(/importScripts\s*\(([\s\S]*?)\)\s*;?/gi)];

  return importMatches.flatMap(match => {
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(urlMatch =>
      resolveUrl(baseUrl, urlMatch[1])
    );
  });
};

export const findServiceWorkerDependencyUrls = (source, baseUrl) => {
  const defineMatches = [...source.matchAll(/define\s*\(\s*\[([^\]]+)\]/gi)];

  return defineMatches.flatMap(match => {
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)]
      .map(urlMatch => urlMatch[1])
      .filter(dep => dep !== 'exports' && dep !== 'module')
      .map(dep => resolveUrl(baseUrl, dep.endsWith('.js') ? dep : `${dep}.js`));
  });
};

const isWorkboxFetchHandler = swCode => {
  return (
    /(?:workbox\.(?:routing\.registerRoute|precaching\.precacheAndRoute)\s*\()/.test(swCode) ||
    /\b(?:registerRoute|precacheAndRoute)\s*\(/.test(swCode) ||
    /\bworkbox\.routing\.setDefaultHandler\s*\(/.test(swCode) ||
    /\bworkbox\.routing\.registerNavigationRoute\s*\(/.test(swCode)
  );
};

export const hasFetchHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]fetch['"`]/.test(swCode) ||
    /onfetch\s*=/.test(swCode) ||
    isWorkboxFetchHandler(swCode)
  );
};

const isWorkboxInstallHandler = swCode => {
  return (
    /\b(?:workbox\.core\.)?skipWaiting\s*\(/.test(swCode) ||
    /\bworkbox\.precaching\.cleanupOutdatedCaches\s*\(/.test(swCode)
  );
};

export const hasInstallHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]install['"`]/.test(swCode) ||
    /oninstall\s*=/.test(swCode) ||
    isWorkboxInstallHandler(swCode)
  );
};

const isWorkboxActivateHandler = swCode => {
  return (
    /\b(?:workbox\.core\.)?clientsClaim\s*\(/.test(swCode) ||
    /\bworkbox\.precaching\.cleanupOutdatedCaches\s*\(/.test(swCode)
  );
};

export const hasActivateHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]activate['"`]/.test(swCode) ||
    /onactivate\s*=/.test(swCode) ||
    isWorkboxActivateHandler(swCode)
  );
};

export const cachesAssets = swCode => {
  return (
    /caches\.open\s*\(/.test(swCode) ||
    /cache\.addAll\s*\(/.test(swCode) ||
    /cache\.put\s*\(/.test(swCode) ||
    /\b(?:precache|addToCacheList)\s*\(/.test(swCode) ||
    /class\s+[A-Za-z_$][\w$]*\s*\{[\s\S]{0,2000}?\bprecache\s*\(/.test(swCode) ||
    /class\s+[A-Za-z_$][\w$]*\s*\{[\s\S]{0,2000}?\baddToCacheList\s*\(/.test(swCode) ||
    /\bworkbox\.precaching\.precacheAndRoute\s*\(/.test(swCode)
  );
};

export const hasPushHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]push['"`]/.test(swCode) ||
    /onpush\s*=/.test(swCode)
  );
};

export const hasNotificationClickHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]notificationclick['"`]/.test(swCode) ||
    /onnotificationclick\s*=/.test(swCode)
  );
};

export const collectServiceWorkerSources = async (entryUrl, seen = new Set()) => {
  if (!entryUrl || seen.has(entryUrl)) {
    return [];
  }

  seen.add(entryUrl);

  const source = await fetchText(entryUrl);
  const sources = [{ source, baseUrl: entryUrl }];
  const importUrls = [
    ...findServiceWorkerImportUrls(source, entryUrl),
    ...findServiceWorkerDependencyUrls(source, entryUrl)
  ];

  for (const importUrl of importUrls) {
    try {
      sources.push(...await collectServiceWorkerSources(importUrl, seen));
    } catch {}
  }

  return sources;
};

export const checkServiceWorker = async (html, pageUrl) => {
  const results = [];

  const scriptUrls = findScriptUrls(html, pageUrl);
  const sources = [
    { source: html, baseUrl: pageUrl }
  ];

  for (const scriptUrl of scriptUrls) {
    try {
      sources.push({
        source: await fetchText(scriptUrl),
        baseUrl: scriptUrl
      });
    } catch {}
  }

  const serviceWorkerUrls = sources.flatMap(({ source, baseUrl }) =>
    findServiceWorkerUrls(source, baseUrl)
  );

  if (serviceWorkerUrls.length === 0) {
    const hasRegistrationHint = sources.some(({ source }) =>
      hasServiceWorkerRegistrationHint(source)
    );

    if (hasRegistrationHint) {
      results.push(
        result(
          'pass',
          'Service worker registration is present, but the script does not expose a static URL'
        )
      );

      return results;
    }
  }

  if (serviceWorkerUrls.length === 0) {
    results.push(result('fail', 'No service worker registration found'));
    return results;
  }

  results.push(
    result('pass', `Service worker registration found: ${serviceWorkerUrls[0]}`)
  );

  const swSources = await collectServiceWorkerSources(serviceWorkerUrls[0]);
  const swCode = swSources.map(({ source }) => source).join('\n');
  const hasCacheHandling = swSources.some(({ source }) => cachesAssets(source)) || cachesAssets(swCode);

  results.push(
    hasInstallHandler(swCode)
      ? result('pass', 'Service worker has install event handler')
      : result('warn', 'Service worker has no install event handler')
  );

  results.push(
    hasActivateHandler(swCode)
      ? result('pass', 'Service worker has activate event handler')
      : result('warn', 'Service worker has no activate event handler')
  );

  results.push(
    hasFetchHandler(swCode)
      ? result('pass', 'Service worker has fetch event handler')
      : result('warn', 'Service worker has no fetch event handler')
  );

  results.push(
    hasCacheHandling
      ? result('pass', 'Service worker appears to cache assets')
      : result('warn', 'Service worker does not appear to cache assets')
  );

  results.push(
    hasPushHandler(swCode)
      ? result('pass', 'Service worker has push event handler')
      : result('warn', 'Service worker has no push event handler')
  );

  results.push(
    hasNotificationClickHandler(swCode)
      ? result('pass', 'Service worker has notificationclick event handler')
      : result('warn', 'Service worker has no notificationclick event handler')
  );

  return results;
};
