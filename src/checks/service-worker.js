import { fetchText } from '../utils/fetch-text.js';
import { result } from '../utils/result.js';
import { resolveUrl } from '../utils/url.js';
import { findScriptUrls } from '../utils/find-script-urls.js';

export const findServiceWorkerUrls = (html, pageUrl, resolveBaseUrl = pageUrl) => {
  const matches = [
    ...html.matchAll(
      /navigator\.serviceWorker\.register\s*\(\s*((?:new\s+URL\s*\([\s\S]{0,200}?\)\.href)|(?:['"][^'"]+['"])|(?:[A-Za-z_$][\w$]*))/g
    )
  ];

  return matches
    .map(match =>
      resolveServiceWorkerRegistrationUrl(html, resolveBaseUrl, match[1], match.index ?? 0)
    )
    .filter(Boolean);
};

const resolveServiceWorkerRegistrationUrl = (source, pageUrl, expression, index = 0) => {
  const trimmedExpression = expression.trim().replace(/[),;]+$/, '');

  const quotedMatch = trimmedExpression.match(/^['"`]([^'"`]+)['"`]$/);
  if (quotedMatch) {
    return resolveUrl(pageUrl, quotedMatch[1]);
  }

  const functionCallMatch = trimmedExpression.match(
    /^(?:await\s+)?(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\(\s*\)$/
  );
  if (functionCallMatch) {
    const resolvedFunctionUrl = resolveServiceWorkerFunctionUrl(
      source,
      pageUrl,
      functionCallMatch[1]
    );

    if (resolvedFunctionUrl) {
      return resolvedFunctionUrl;
    }
  }

  const identifierMatch = trimmedExpression.match(/^[A-Za-z_$][\w$]*$/);
  if (identifierMatch) {
    const identifier = identifierMatch[0];
    const declarationSource = source.slice(0, index);
    const declarationRegex = new RegExp(
      String.raw`(?:const|let|var)\s+${identifier}\s*=\s*([^\n;]+)`,
      'g'
    );
    let declarationMatch = null;

    for (const match of declarationSource.matchAll(declarationRegex)) {
      declarationMatch = match;
    }

    if (declarationMatch) {
      const resolvedDeclaration = resolveServiceWorkerRegistrationUrl(
        declarationSource,
        pageUrl,
        declarationMatch[1].trim(),
        declarationMatch.index ?? 0
      );

      if (resolvedDeclaration) {
        return resolvedDeclaration;
      }
    }

    const newUrlMatch = source.match(
      new RegExp(
        String.raw`(?:const|let|var)\s+${identifier}\s*=\s*new\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)\.href`
      )
    );

    if (newUrlMatch) {
      return resolveUrl(pageUrl, newUrlMatch[2]);
    }
  }

  const newUrlMatch = trimmedExpression.match(
    /^new\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)\.href$/
  );
  if (newUrlMatch) {
    return resolveUrl(pageUrl, newUrlMatch[2]);
  }

  return null;
};

const resolveServiceWorkerFunctionUrl = (source, pageUrl, functionName) => {
  const functionMatch = source.match(
    new RegExp(
      String.raw`(?:this\.)?${functionName}\s*=\s*async\s+function\s*\(\)\s*\{([\s\S]*?)\};`
    )
  );

  if (!functionMatch) {
    return null;
  }

  const body = functionMatch[1];

  const directUrlMatch = body.match(
    /return\s+window\.location\.origin\s*\+\s*["']\/([^"']+)["']/
  );
  if (directUrlMatch) {
    return resolveUrl(pageUrl, `/${directUrlMatch[1]}`);
  }

  const literalVariableMatch = body.match(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"`]+)['"]/
  );
  if (literalVariableMatch) {
    const variableName = literalVariableMatch[1];
    const literalPath = literalVariableMatch[2];
    const usesLiteralVariable = new RegExp(
      String.raw`window\.location\.origin\s*\+\s*["']\/["']\s*\+\s*${variableName}\b`
    ).test(body);

    if (usesLiteralVariable) {
      return resolveUrl(pageUrl, `/${literalPath}`);
    }
  }

  const defaultPathMatch = body.match(/\|\|\s*["']([^"']+)["']/);
  const builtOriginMatch = body.match(
    /window\.location\.origin\s*\+\s*["']\/["']\s*\+\s*[A-Za-z_$][\w$]*/
  );
  const returnsHref = /return\s+[A-Za-z_$][\w$]*\.href/.test(body);

  if (defaultPathMatch && builtOriginMatch && returnsHref) {
    return resolveUrl(pageUrl, `/${defaultPathMatch[1]}`);
  }

  return null;
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

export const collectServiceWorkerSources = async (
  entryUrl,
  seen = new Set(),
  fetchOptions = {}
) => {
  if (!entryUrl || seen.has(entryUrl)) {
    return [];
  }

  seen.add(entryUrl);

  const source = await fetchText(entryUrl, fetchOptions);
  const sources = [{ source, baseUrl: entryUrl }];
  const importUrls = [
    ...findServiceWorkerImportUrls(source, entryUrl),
    ...findServiceWorkerDependencyUrls(source, entryUrl)
  ];

  for (const importUrl of importUrls) {
    try {
      sources.push(...await collectServiceWorkerSources(importUrl, seen, fetchOptions));
    } catch {}
  }

  return sources;
};

export const checkServiceWorker = async (html, pageUrl, fetchOptions = {}) => {
  const results = [];

  const scriptUrls = findScriptUrls(html, pageUrl);
  const sources = [{ source: html, baseUrl: pageUrl }];

  for (const scriptUrl of scriptUrls) {
    try {
      sources.push({
        source: await fetchText(scriptUrl, fetchOptions),
        baseUrl: scriptUrl
      });
    } catch {}
  }

  const serviceWorkerUrls = sources.flatMap(({ source }) =>
    findServiceWorkerUrls(source, pageUrl, pageUrl)
  );

  if (serviceWorkerUrls.length === 0) {
    const hasRegistrationHint = sources.some(({ source }) =>
      hasServiceWorkerRegistrationHint(source)
    );

    if (hasRegistrationHint) {
      results.push(
        result(
          'warn',
          'Service worker registration is present, but the script does not expose a static URL; subsequent service worker checks could not be run'
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

  const swSources = await collectServiceWorkerSources(serviceWorkerUrls[0], new Set(), fetchOptions);
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
