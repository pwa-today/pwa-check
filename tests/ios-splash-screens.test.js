import assert from 'node:assert/strict';
import test from 'node:test';

import { checkIosSplashScreens } from '../src/checks/ios-splash-screens.js';

const pageUrl = 'https://example.com/';
const startupImage = '<link rel="apple-touch-startup-image" href="/startup.png">';

test('requires the legacy mobile-web-app-capable meta tag with iOS startup images', async () => {
  const results = await checkIosSplashScreens(startupImage, pageUrl);
  const metaResult = results.find((entry) => {
    return entry.code === 'ios.startup-images.mobile-web-app-capable';
  });

  assert.equal(metaResult.status, 'warn');
});

test('passes the mobile-web-app-capable check when the meta tag is present', async () => {
  const results = await checkIosSplashScreens(
    `${startupImage}<meta name="apple-mobile-web-app-capable" content="yes">`,
    pageUrl
  );
  const metaResult = results.find((entry) => {
    return entry.code === 'ios.startup-images.mobile-web-app-capable';
  });

  assert.equal(metaResult.status, 'pass');
});

test('omits the mobile-web-app-capable check when no iOS startup images exist', async () => {
  const results = await checkIosSplashScreens('<title>PWA</title>', pageUrl);

  assert.equal(
    results.some((entry) => {
      return entry.code === 'ios.startup-images.mobile-web-app-capable';
    }),
    false
  );
});
