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
  const trimmedExpression = expression.trim().replace(/[;,]+$/, '');

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

const looksLikeServiceWorker = source => {
  return (
    hasEventHandler(source, 'install') ||
    hasEventHandler(source, 'activate') ||
    hasEventHandler(source, 'fetch') ||
    hasEventHandler(source, 'push') ||
    hasEventHandler(source, 'notificationclick') ||
    /\bworkbox:/.test(source) ||
    /\bprecacheAndRoute\s*\(/.test(source)
  );
};

const findConventionalServiceWorkerUrl = async (pageUrl, fetchOptions = {}) => {
  const candidates = ['/sw.js', '/service-worker.js'].map(path => resolveUrl(pageUrl, path));

  for (const candidate of candidates) {
    try {
      const source = await fetchText(candidate, fetchOptions);

      if (looksLikeServiceWorker(source)) {
        return candidate;
      }
    } catch {}
  }

  return null;
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

const hasEventHandler = (swCode, eventName) => {
  return (
    new RegExp(String.raw`addEventListener\s*\(\s*['"\`]${eventName}['"\`]`).test(swCode) ||
    new RegExp(String.raw`on${eventName}\s*=`).test(swCode)
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

const getBalancedBlock = (source, startIndex) => {
  if (source[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inSingle) {
      if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex + 1, index);
      }
    }
  }

  return null;
};

const hasWaitUntilInHandlerSource = handlerSource => {
  if (!handlerSource) {
    return false;
  }

  const bodyPatterns = [
    /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{([\s\S]*)\}$/,
    /^(?:async\s+)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{([\s\S]*)\}$/,
    /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*)\}$/,
    /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([^;]+)$/,
    /^(?:async\s+)?\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*([^;]+)$/,
    /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*([^;]+)$/
  ];

  for (const pattern of bodyPatterns) {
    const match = handlerSource.trim().match(pattern);
    const eventParam = match?.[1];
    const body = match?.[2] || '';
    if (eventParam && new RegExp(String.raw`\b${eventParam}\.waitUntil\s*\(`).test(body)) {
      return true;
    }
  }

  return false;
};

const hasPatternInHandlerSource = (handlerSource, pattern) => {
  if (!handlerSource) {
    return false;
  }

  const trimmedHandlerSource = handlerSource.trim();
  const blockMatch = trimmedHandlerSource.match(
    /^(?:async\s+)?(?:function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*[A-Za-z_$][\w$]*\s*\)|\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*(?:=>)?\s*\{([\s\S]*)\}$/
  );

  if (blockMatch) {
    return pattern.test(blockMatch[1] || '');
  }

  const expressionMatch = trimmedHandlerSource.match(
    /^(?:async\s+)?(?:\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*([\s\S]+)$/
  );

  return expressionMatch ? pattern.test(expressionMatch[1] || '') : false;
};

const resolveNamedHandlerSource = (swCode, handlerName, beforeIndex) => {
  const declarationRegex = new RegExp(
    String.raw`(?:const|let|var)\s+${handlerName}\s*=`,
    'g'
  );
  let declarationIndex = -1;

  for (const match of swCode.slice(0, beforeIndex).matchAll(declarationRegex)) {
    declarationIndex = match.index ?? -1;
  }

  if (declarationIndex < 0) {
    return null;
  }

  let cursor = declarationIndex;
  while (cursor < swCode.length && swCode[cursor] !== '=') {
    cursor += 1;
  }

  if (swCode[cursor] !== '=') {
    return null;
  }

  cursor += 1;
  while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
    cursor += 1;
  }

  const start = cursor;
  const source = swCode.slice(start);

  if (source.startsWith('async')) {
    cursor += 'async'.length;
    while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
      cursor += 1;
    }
  }

  if (swCode.startsWith('function', cursor)) {
    const bodyStart = swCode.indexOf('{', cursor);
    if (bodyStart === -1) {
      return null;
    }

    const body = getBalancedBlock(swCode, bodyStart);
    if (body === null) {
      return null;
    }

    const end = bodyStart + body.length + 2;
    return swCode.slice(start, end).trim();
  }

  const arrowIndex = swCode.indexOf('=>', cursor);
  if (arrowIndex === -1) {
    return null;
  }

  const bodyStart = arrowIndex + 2;
  let bodyCursor = bodyStart;
  while (bodyCursor < swCode.length && /\s/.test(swCode[bodyCursor])) {
    bodyCursor += 1;
  }

  if (swCode[bodyCursor] === '{') {
    const body = getBalancedBlock(swCode, bodyCursor);
    if (body === null) {
      return null;
    }

    const end = bodyCursor + body.length + 2;
    return swCode.slice(start, end).trim();
  }

  const tail = swCode.slice(bodyCursor).match(/^[^;\n]+/);
  if (!tail) {
    return null;
  }

  return swCode.slice(start, bodyCursor + tail[0].length).trim();
};

const parseEventHandler = (swCode, eventName) => {
  const callPatterns = [
    new RegExp(String.raw`addEventListener\s*\(\s*['"\`]${eventName}['"\`]\s*,`, 'g'),
    new RegExp(String.raw`on${eventName}\s*=`, 'g')
  ];

  for (const callPattern of callPatterns) {
    for (const match of swCode.matchAll(callPattern)) {
      let cursor = match.index + match[0].length;

      while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
        cursor += 1;
      }

      if (swCode.startsWith('async', cursor)) {
        cursor += 5;
        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }
      }

      let eventParam = null;
      let bodyStart = null;
      let isFunctionSyntax = false;

      if (swCode.startsWith('function', cursor)) {
        isFunctionSyntax = true;
        cursor += 'function'.length;

        while (cursor < swCode.length && /[A-Za-z_$\s]/.test(swCode[cursor])) {
          if (swCode[cursor] === '(') {
            break;
          }
          cursor += 1;
        }

        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        if (swCode[cursor] !== '(') {
          continue;
        }

        cursor += 1;

        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        const paramMatch = swCode.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
        if (!paramMatch) {
          continue;
        }

        eventParam = paramMatch[1];
        cursor += eventParam.length;
      } else {
        if (swCode[cursor] === '(') {
          cursor += 1;

          while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
            cursor += 1;
          }

          const paramMatch = swCode.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
          if (!paramMatch) {
            continue;
          }

          eventParam = paramMatch[1];
          cursor += eventParam.length;

          while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
            cursor += 1;
          }

          if (swCode[cursor] !== ')') {
            continue;
          }

          cursor += 1;
        } else {
          const paramMatch = swCode.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
          if (!paramMatch) {
            continue;
          }

          eventParam = paramMatch[1];
          cursor += eventParam.length;

          while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
            cursor += 1;
          }

          if (!swCode.startsWith('=>', cursor)) {
            const handlerSource = resolveNamedHandlerSource(swCode, eventParam, match.index ?? 0);
            if (handlerSource && hasWaitUntilInHandlerSource(handlerSource)) {
              return true;
            }

            continue;
          }
        }
      }

      if (isFunctionSyntax) {
        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        if (swCode[cursor] !== ')') {
          continue;
        }

        cursor += 1;

        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        bodyStart = cursor;
        if (swCode[cursor] !== '{') {
          continue;
        }
      } else {
        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        if (!swCode.startsWith('=>', cursor)) {
          continue;
        }

        cursor += 2;

        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }

        bodyStart = cursor;
      }

      if (swCode[bodyStart] === '{') {
        const body = getBalancedBlock(swCode, bodyStart);
        if (body && new RegExp(String.raw`\b${eventParam}\.waitUntil\s*\(`).test(body)) {
          return true;
        }
        continue;
      }

      const bodyMatch = swCode.slice(bodyStart).match(/^[^;]+/);
      if (bodyMatch && new RegExp(String.raw`\b${eventParam}\.waitUntil\s*\(`).test(bodyMatch[0])) {
        return true;
      }
    }
  }

  return false;
};

const hasEventWaitUntil = (swCode, eventName) => {
  return parseEventHandler(swCode, eventName);
};

const hasEventPattern = (swCode, eventName, pattern) => {
  const callPatterns = [
    new RegExp(String.raw`addEventListener\s*\(\s*['"\`]${eventName}['"\`]\s*,`, 'g'),
    new RegExp(String.raw`on${eventName}\s*=`, 'g')
  ];

  for (const callPattern of callPatterns) {
    for (const match of swCode.matchAll(callPattern)) {
      let cursor = match.index + match[0].length;

      while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
        cursor += 1;
      }

      if (swCode.startsWith('async', cursor)) {
        cursor += 5;
        while (cursor < swCode.length && /\s/.test(swCode[cursor])) {
          cursor += 1;
        }
      }

      let handlerSource = null;

      if (swCode.startsWith('function', cursor)) {
        const bodyStart = swCode.indexOf('{', cursor);
        if (bodyStart === -1) {
          continue;
        }

        const body = getBalancedBlock(swCode, bodyStart);
        if (body === null) {
          continue;
        }

        handlerSource = swCode.slice(cursor, bodyStart + body.length + 2).trim();
      } else {
        const handlerNameMatch = swCode.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
        let arrowIndex = -1;

        if (handlerNameMatch) {
          let afterHandlerName = cursor + handlerNameMatch[1].length;
          while (afterHandlerName < swCode.length && /\s/.test(swCode[afterHandlerName])) {
            afterHandlerName += 1;
          }

          if (swCode.startsWith('=>', afterHandlerName)) {
            arrowIndex = afterHandlerName;
          } else {
            handlerSource = resolveNamedHandlerSource(swCode, handlerNameMatch[1], match.index ?? 0);
          }
        } else if (swCode[cursor] === '(') {
          arrowIndex = swCode.indexOf('=>', cursor);
        }

        if (arrowIndex !== -1) {
          const bodyStart = arrowIndex + 2;
          let bodyCursor = bodyStart;

          while (bodyCursor < swCode.length && /\s/.test(swCode[bodyCursor])) {
            bodyCursor += 1;
          }

          if (swCode[bodyCursor] === '{') {
            const body = getBalancedBlock(swCode, bodyCursor);
            if (body === null) {
              continue;
            }

            handlerSource = swCode.slice(cursor, bodyCursor + body.length + 2).trim();
          } else {
            const tail = swCode.slice(bodyCursor).match(/^[^;\n]+/);
            if (!tail) {
              continue;
            }

            handlerSource = swCode.slice(cursor, bodyCursor + tail[0].length).trim();
          }
        }
      }

      if (hasPatternInHandlerSource(handlerSource, pattern)) {
        return true;
      }
    }
  }

  return false;
};

export const hasInstallHandler = swCode => {
  return (
    hasEventWaitUntil(swCode, 'install') ||
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
    hasEventWaitUntil(swCode, 'activate') ||
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
    hasEventWaitUntil(swCode, 'push')
  );
};

export const pushHandlerShowsNotification = swCode => {
  return hasEventPattern(swCode, 'push', /\.showNotification\s*\(/);
};

const usesInstallSkipWaiting = swCode => {
  return hasEventPattern(swCode, 'install', /\bself\.skipWaiting\s*\(/);
};

const usesActivateClientsClaim = swCode => {
  return hasEventPattern(swCode, 'activate', /\bself\.clients\.claim\s*\(/);
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
    const conventionalServiceWorkerUrl = await findConventionalServiceWorkerUrl(
      pageUrl,
      fetchOptions
    );

    if (conventionalServiceWorkerUrl) {
      serviceWorkerUrls.push(conventionalServiceWorkerUrl);
    }

    if (serviceWorkerUrls.length === 0 && hasRegistrationHint) {
      results.push(
        result(
          'warn',
          'Service worker registration is present, but the script does not expose a static URL; subsequent service worker checks could not be run',
          'service-worker.registration.dynamic-unresolved'
        )
      );

      return results;
    }
  }

  if (serviceWorkerUrls.length === 0) {
    results.push(result('fail', 'No service worker registration found', 'service-worker.registration.missing'));
    return results;
  }

  results.push(
    result('pass', `Service worker registration found: ${serviceWorkerUrls[0]}`, 'service-worker.registration.found')
  );

  const swSources = await collectServiceWorkerSources(serviceWorkerUrls[0], new Set(), fetchOptions);
  const swCode = swSources.map(({ source }) => source).join('\n');
  const hasCacheHandling = swSources.some(({ source }) => cachesAssets(source)) || cachesAssets(swCode);

  const installHandlerPresent = hasEventHandler(swCode, 'install') || hasInstallHandler(swCode);
  const installHandlerCallsWaitUntil = hasInstallHandler(swCode);

  results.push(
    installHandlerPresent
      ? result('pass', 'Service worker has install event handler', 'service-worker.install')
      : result('warn', 'Service worker has no install event handler', 'service-worker.install.missing')
  );

  if (installHandlerPresent) {
    results.push(
      installHandlerCallsWaitUntil
        ? result('pass', 'Service worker install handler calls waitUntil', 'service-worker.install.wait-until')
        : result('warn', 'Service worker has install event handler, but it does not call waitUntil', 'service-worker.install.wait-until')
    );

    if (usesInstallSkipWaiting(swCode)) {
      results.push(result('warn', 'Service worker install handler uses self.skipWaiting(), this may break existing pages', 'service-worker.install.skip-waiting'));
    }
  }

  const activateHandlerPresent = hasEventHandler(swCode, 'activate') || hasActivateHandler(swCode);
  const activateHandlerCallsWaitUntil = hasActivateHandler(swCode);

  results.push(
    activateHandlerPresent
      ? result('pass', 'Service worker has activate event handler', 'service-worker.activate')
      : result('warn', 'Service worker has no activate event handler', 'service-worker.activate.missing')
  );

  if (activateHandlerPresent) {
    results.push(
      activateHandlerCallsWaitUntil
        ? result('pass', 'Service worker activate handler calls waitUntil', 'service-worker.activate.wait-until')
        : result('warn', 'Service worker has activate event handler, but it does not call waitUntil', 'service-worker.activate.wait-until')
    );

    if (usesActivateClientsClaim(swCode)) {
      results.push(result('warn', 'Service worker activate handler uses self.clients.claim(), this may break existing pages', 'service-worker.activate.clients-claim'));
    }
  }

  results.push(
    hasFetchHandler(swCode)
      ? result('pass', 'Service worker has fetch event handler', 'service-worker.fetch')
      : result('warn', 'Service worker has no fetch event handler', 'service-worker.fetch.missing')
  );

  results.push(
    hasCacheHandling
      ? result('pass', 'Service worker appears to cache assets', 'service-worker.cache')
      : result('warn', 'Service worker does not appear to cache assets', 'service-worker.cache.missing')
  );

  const pushHandlerPresent = hasEventHandler(swCode, 'push') || hasPushHandler(swCode);
  const pushHandlerCallsWaitUntil = hasPushHandler(swCode);
  const pushHandlerCallsShowNotification = pushHandlerShowsNotification(swCode);

  results.push(
    pushHandlerPresent
      ? result('pass', 'Service worker has push event handler', 'service-worker.push')
      : result('warn', 'Service worker has no push event handler', 'service-worker.push.missing')
  );

  if (pushHandlerPresent) {
    results.push(
      pushHandlerCallsWaitUntil
        ? result('pass', 'Service worker push handler calls waitUntil', 'service-worker.push.wait-until')
        : result('warn', 'Service worker has push event handler, but it does not call waitUntil', 'service-worker.push.wait-until')
    );

    results.push(
      pushHandlerCallsShowNotification
        ? result('pass', 'Service worker push handler calls showNotification', 'service-worker.push.show-notification')
        : result('warn', 'Service worker has push event handler, but it does not call showNotification', 'service-worker.push.show-notification')
    );
  }

  results.push(
    hasNotificationClickHandler(swCode)
      ? result('pass', 'Service worker has notificationclick event handler', 'service-worker.notificationclick')
      : result('warn', 'Service worker has no notificationclick event handler', 'service-worker.notificationclick.missing')
  );

  return results;
};
