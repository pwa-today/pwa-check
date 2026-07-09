import { checkManifest } from './checks/manifest.js';
import { checkIosSplashScreens } from './checks/ios-splash-screens.js';
import { checkServiceWorker } from './checks/service-worker.js';
import { checkViewport } from './checks/viewport.js';
import { fetchText } from './utils/fetch-text.js';
import { result } from './utils/result.js';
import { normalizeUrl } from './utils/url.js';

export const summarizeResults = results => {
  return results.reduce(
    (summary, entry) => {
      summary[entry.status] = (summary[entry.status] ?? 0) + 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
};

export const shouldFailResults = (results, { failOnWarn = false, ignoreWarnCodes = [] } = {}) => {
  const ignoredWarnCodes = new Set(ignoreWarnCodes);

  return results.some(result => {
    if (result.status === 'fail') {
      return true;
    }

    if (!failOnWarn || result.status !== 'warn') {
      return false;
    }

    return !result.code || !ignoredWarnCodes.has(result.code);
  });
};

export const checkPwa = async (inputUrl, options = {}) => {
  const results = [];
  const pageUrl = normalizeUrl(inputUrl);
  const fetchOptions = { timeoutMs: options.timeoutMs };

  let html;

  try {
    html = await fetchText(pageUrl, fetchOptions);
    results.push(result('pass', 'Site is reachable'));
  } catch (error) {
    results.push(result('fail', `Could not fetch site: ${error.message}`));
    return results;
  }

  results.push(...await checkManifest(html, pageUrl, fetchOptions));
  results.push(...await checkViewport(html, pageUrl));
  results.push(...await checkIosSplashScreens(html, pageUrl, fetchOptions));
  results.push(...await checkServiceWorker(html, pageUrl, fetchOptions));

  return results;
};
