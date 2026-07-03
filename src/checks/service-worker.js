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

export const hasFetchHandler = swCode => {
  return (
    /addEventListener\s*\(\s*['"`]fetch['"`]/.test(swCode) ||
    /onfetch\s*=/.test(swCode)
  );
};

export const cachesAssets = swCode => {
  return (
    /caches\.open\s*\(/.test(swCode) ||
    /cache\.addAll\s*\(/.test(swCode) ||
    /cache\.put\s*\(/.test(swCode)
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

  const swCode = await fetchText(serviceWorkerUrls[0]);

  results.push(
    hasFetchHandler(swCode)
      ? result('pass', 'Service worker has fetch event handler')
      : result('warn', 'Service worker has no fetch event handler')
  );

  results.push(
    cachesAssets(swCode)
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
