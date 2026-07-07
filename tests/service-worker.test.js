import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectServiceWorkerSources,
  cachesAssets,
  checkServiceWorker,
  hasActivateHandler,
  hasFetchHandler,
  hasInstallHandler,
  findServiceWorkerImportUrls,
  findServiceWorkerDependencyUrls,
  findServiceWorkerUrls
} from '../src/checks/service-worker.js';

test('findServiceWorkerImportUrls resolves importScripts urls', () => {
  const source = "importScripts('/workbox-9c191d2f.js', './extra.js');";

  assert.deepEqual(findServiceWorkerImportUrls(source, 'https://example.com/sw.js'), [
    'https://example.com/workbox-9c191d2f.js',
    'https://example.com/extra.js'
  ]);
});

test('findServiceWorkerDependencyUrls resolves define dependencies', () => {
  const source = 'define(["exports", "./workbox-9c191d2f"], function (e) { return e; });';

  assert.deepEqual(findServiceWorkerDependencyUrls(source, 'https://example.com/sw.js'), [
    'https://example.com/workbox-9c191d2f.js'
  ]);
});

test('findServiceWorkerUrls resolves string variables and new URL expressions', () => {
  const source = `
    const swUrl = '/sw.js';
    const moduleSwUrl = new URL('./module-sw.js', import.meta.url).href;
    navigator.serviceWorker.register(swUrl);
    navigator.serviceWorker.register(moduleSwUrl);
  `;

  assert.deepEqual(findServiceWorkerUrls(source, 'https://example.com/app/'), [
    'https://example.com/sw.js',
    'https://example.com/app/module-sw.js'
  ]);
});

test('collectServiceWorkerSources follows importScripts recursively', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/sw.js') {
      return new Response("importScripts('/workbox-9c191d2f.js');", { status: 200 });
    }

    if (url === 'https://example.com/workbox-9c191d2f.js') {
      return new Response("self.addEventListener('fetch', event => {});", { status: 200 });
    }

    return new Response('', { status: 404 });
  };

  try {
    const sources = await collectServiceWorkerSources('https://example.com/sw.js');

    assert.equal(sources.length, 2);
    assert.equal(sources[0].baseUrl, 'https://example.com/sw.js');
    assert.equal(sources[1].baseUrl, 'https://example.com/workbox-9c191d2f.js');
  } finally {
    global.fetch = originalFetch;
  }
});

test('collectServiceWorkerSources follows define dependencies recursively', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/sw.js') {
      return new Response('define(["exports", "./workbox-9c191d2f"], function (e) { return e; });', {
        status: 200
      });
    }

    if (url === 'https://example.com/workbox-9c191d2f.js') {
      return new Response('workbox.precaching.precacheAndRoute([]);', { status: 200 });
    }

    return new Response('', { status: 404 });
  };

  try {
    const sources = await collectServiceWorkerSources('https://example.com/sw.js');

    assert.equal(sources.length, 2);
    assert.equal(sources[0].baseUrl, 'https://example.com/sw.js');
    assert.equal(sources[1].baseUrl, 'https://example.com/workbox-9c191d2f.js');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Workbox routing APIs count as fetch handling', () => {
  assert.equal(
    hasFetchHandler("workbox.routing.registerRoute(({request}) => request.destination === 'image', new workbox.strategies.CacheFirst());"),
    true
  );
  assert.equal(
    hasFetchHandler("workbox.precaching.precacheAndRoute(self.__WB_MANIFEST);"),
    true
  );
});

test('Workbox precache helpers count as caching assets', () => {
  assert.equal(
    cachesAssets('class O { precache() {} addToCacheList() {} }'),
    true
  );
  assert.equal(
    cachesAssets('workbox.precaching.precacheAndRoute(self.__WB_MANIFEST);'),
    true
  );
});

test('Workbox precache controller class counts as caching assets', () => {
  const source = `
    class O {
      constructor() {}
      precache(t){ this.addToCacheList(t); }
      addToCacheList(t){ return t; }
    }
  `;

  assert.equal(cachesAssets(source), true);
});

test('plain service worker listeners still count', () => {
  assert.equal(hasFetchHandler("self.addEventListener('fetch', event => {});"), true);
  assert.equal(hasInstallHandler("self.addEventListener('install', event => {});"), true);
  assert.equal(hasActivateHandler("self.addEventListener('activate', event => {});"), true);
});

test('checkServiceWorker follows generated Workbox service worker chains', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/') {
      return new Response(
        '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
        { status: 200 }
      );
    }

    if (url === 'https://example.com/registerSW.js') {
      return new Response(
        "if('serviceWorker' in navigator) {navigator.serviceWorker.register('/sw.js', { scope: '/' })}",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        'define(["exports", "./workbox-9c191d2f"], function (e) { "use strict"; self.skipWaiting(), e.clientsClaim(), e.precacheAndRoute([]); });',
        { status: 200 }
      );
    }

    if (url === 'https://example.com/workbox-9c191d2f.js') {
      return new Response(
        'class O { precache(t){ this.addToCacheList(t); } addToCacheList(t){ return t; } }',
        { status: 200 }
      );
    }

    return new Response('', { status: 404 });
  };

  try {
    const results = await checkServiceWorker(
      '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
      'https://example.com/'
    );

    assert.ok(
      results.some(
        entry =>
          entry.status === 'pass' &&
          entry.message === 'Service worker appears to cache assets'
      )
    );
    assert.ok(
      !results.some(
        entry =>
          entry.status === 'warn' &&
          entry.message === 'Service worker does not appear to cache assets'
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker runs subsequent checks when registration url is resolved from code', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/') {
      return new Response(
        '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
        { status: 200 }
      );
    }

    if (url === 'https://example.com/registerSW.js') {
      return new Response(
        "const swUrl = new URL('./sw.js', import.meta.url).href; if('serviceWorker' in navigator) { navigator.serviceWorker.register(swUrl); }",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.addEventListener('install', () => {}); self.addEventListener('activate', () => {}); self.addEventListener('fetch', () => {}); self.addEventListener('push', () => {}); self.addEventListener('notificationclick', () => {}); caches.open('v1');",
        { status: 200 }
      );
    }

    return new Response('', { status: 404 });
  };

  try {
    const results = await checkServiceWorker(
      '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
      'https://example.com/'
    );

    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker registration found: https://example.com/sw.js'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has install event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has activate event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has fetch event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker appears to cache assets'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has push event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has notificationclick event handler'));
    assert.ok(!results.some(entry => entry.message.includes('does not expose a static URL')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker reports when a registration is present but no static url can be recovered', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/') {
      return new Response(
        '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
        { status: 200 }
      );
    }

    if (url === 'https://example.com/registerSW.js') {
      return new Response(
        "navigator.serviceWorker.register(getRegistrationUrl());",
        { status: 200 }
      );
    }

    return new Response('', { status: 404 });
  };

  try {
    const results = await checkServiceWorker(
      '<html><head><script src="/registerSW.js"></script></head><body></body></html>',
      'https://example.com/'
    );

    assert.ok(
      results.some(
        entry =>
          entry.status === 'warn' &&
          entry.message ===
            'Service worker registration is present, but the script does not expose a static URL; subsequent service worker checks could not be run'
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
});
