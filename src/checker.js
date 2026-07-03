import { checkManifest } from './checks/manifest.js';
import { checkIosSplashScreens } from './checks/ios-splash-screens.js';
import { checkServiceWorker } from './checks/service-worker.js';
import { fetchText } from './utils/fetch-text.js';
import { result } from './utils/result.js';
import { normalizeUrl } from './utils/url.js';

export const checkPwa = async inputUrl => {
  const results = [];
  const pageUrl = normalizeUrl(inputUrl);

  let html;

  try {
    html = await fetchText(pageUrl);
    results.push(result('pass', 'Site is reachable'));
  } catch (error) {
    results.push(result('fail', `Could not fetch site: ${error.message}`));
    return results;
  }

  results.push(...await checkManifest(html, pageUrl));
  results.push(...await checkIosSplashScreens(html, pageUrl));
  results.push(...await checkServiceWorker(html, pageUrl));

  return results;
};
