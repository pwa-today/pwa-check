import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectServiceWorkerSources,
  cachesAssets,
  checkServiceWorker,
  hasActivateHandler,
  hasFetchHandler,
  hasInstallHandler,
  hasPushHandler,
  pushHandlerShowsNotification,
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

test('findServiceWorkerUrls resolves generated urls from function calls', () => {
  const source = `
    this.workerUrl = async function() {
      var fileName = await config.get('workerFile') || 'worker.js';
      var absoluteUrl = window.location.origin + '/' + fileName;
      var url = new URL(absoluteUrl);
      return url.href;
    };
    var generatedUrl = await app.workerUrl();
    navigator.serviceWorker.register(generatedUrl);
  `;

  assert.deepEqual(findServiceWorkerUrls(source, 'https://example.com/app/'), [
    'https://example.com/worker.js'
  ]);
});

test('findServiceWorkerUrls resolves Workbox Window registrations', () => {
  const source = `
    import { Workbox } from 'workbox-window';
    const wb = new Workbox('/app/sw.js', { scope: '/app/' });
    wb.register();
  `;

  assert.deepEqual(findServiceWorkerUrls(source, 'https://example.com/app/'), [
    'https://example.com/app/sw.js'
  ]);
});

test('findServiceWorkerUrls resolves minified Workbox Window registrations', () => {
  const source = `
    import('./workbox-window.prod.es5.js')
      .then(({Workbox:e}) => new e('/ItemWorth/sw.js', { scope: '/ItemWorth/' }))
      .then(e => e.register());
  `;

  assert.deepEqual(findServiceWorkerUrls(source, 'https://example.com/ItemWorth/'), [
    'https://example.com/ItemWorth/sw.js'
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
  assert.equal(
    hasInstallHandler("self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); });"),
    true
  );
  assert.equal(
    hasActivateHandler("self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); });"),
    true
  );
  assert.equal(
    hasPushHandler("self.addEventListener('push', event => { event.waitUntil(Promise.resolve()); });"),
    true
  );
});

test('event handlers without waitUntil do not count for install activate or push', () => {
  assert.equal(hasInstallHandler("self.addEventListener('install', event => {});"), false);
  assert.equal(hasActivateHandler("self.addEventListener('activate', event => {});"), false);
  assert.equal(hasPushHandler("self.addEventListener('push', event => {});"), false);
});

test('push handlers show a notification', () => {
  assert.equal(
    pushHandlerShowsNotification(
      "self.addEventListener('push', event => { event.waitUntil(self.registration.showNotification('New message')); });"
    ),
    true
  );
  assert.equal(
    pushHandlerShowsNotification(
      "const pushHandler = event => { return registration.showNotification('New message'); }; self.addEventListener('push', pushHandler); self.addEventListener('message', event => console.log(event));"
    ),
    true
  );
  assert.equal(
    pushHandlerShowsNotification(
      "self.addEventListener('push', event => self.registration.showNotification('New message'));"
    ),
    true
  );
  assert.equal(
    pushHandlerShowsNotification(
      "self.registration.showNotification('Outside handler'); self.addEventListener('push', event => {});"
    ),
    false
  );
});

test('minified handler parameter names still count when waitUntil is called', () => {
  assert.equal(
    hasInstallHandler("self.addEventListener('install', function(e) { e.waitUntil(Promise.resolve()); });"),
    true
  );
  assert.equal(
    hasActivateHandler("self.addEventListener('activate', async function(e) { e.waitUntil(Promise.resolve()); });"),
    true
  );
  assert.equal(
    hasPushHandler("self.addEventListener('push', async e => { e.waitUntil(Promise.resolve()); });"),
    true
  );
});

test('named handler variables still count when waitUntil is called', () => {
  assert.equal(
    hasInstallHandler("const installHandler = e => { e.waitUntil(Promise.resolve()); }; self.addEventListener('install', installHandler);"),
    true
  );
  assert.equal(
    hasActivateHandler("const activateHandler = function(e) { e.waitUntil(Promise.resolve()); }; self.addEventListener('activate', activateHandler);"),
    true
  );
});

test('checkServiceWorker reports push handlers without waitUntil separately', async () => {
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
        "if('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.addEventListener('push', event => { console.log(event); });",
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
          entry.message === 'Service worker has push event handler'
      )
    );
    assert.ok(
      results.some(
        entry =>
          entry.status === 'warn' &&
          entry.code === 'service-worker.push.wait-until' &&
          entry.message === 'Service worker has push event handler, but it does not call waitUntil'
      )
    );
    assert.deepEqual(
      results.find(entry => entry.code === 'service-worker.push.show-notification'),
      {
        status: 'warn',
        message:
          'Service worker has push event handler, but it does not call showNotification',
        code: 'service-worker.push.show-notification',
        priority: 'high',
        impact:
          'Push messages may arrive without displaying a notification to the user.',
        fix: 'Call registration.showNotification(...) in the "push" event handler and pass its promise to event.waitUntil(...).',
        documentation:
          'https://notifications.spec.whatwg.org/#dom-serviceworkerregistration-shownotification'
      }
    );
    assert.ok(
      !results.some(
        entry =>
          entry.status === 'warn' &&
          entry.message === 'Service worker has no push event handler'
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker warns when notificationclick is missing', async () => {
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
        "if('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('push', event => { event.waitUntil(Promise.resolve()); });",
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
          entry.code === 'service-worker.notificationclick.missing' &&
          entry.message === 'Service worker has no notificationclick event handler'
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker warns when install uses skipWaiting and activate uses clients.claim', async () => {
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
        "if('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); self.skipWaiting(); }); self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); self.clients.claim(); });",
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

    assert.ok(results.some(entry => entry.status === 'warn' && entry.message === 'Service worker install handler uses self.skipWaiting(), this may break existing pages'));
    assert.ok(results.some(entry => entry.status === 'warn' && entry.message === 'Service worker activate handler uses self.clients.claim(), this may break existing pages'));
    assert.ok(results.some(entry => entry.code === 'service-worker.install.skip-waiting'));
    assert.ok(results.some(entry => entry.code === 'service-worker.activate.clients-claim'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has install event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker install handler calls waitUntil'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has activate event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker activate handler calls waitUntil'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker does not warn when skipWaiting is outside the install handler', async () => {
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
        "if('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js'); }",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.skipWaiting(); self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); });",
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
      !results.some(
        entry =>
          entry.code === 'service-worker.install.skip-waiting'
      )
    );
    assert.ok(
      results.some(
        entry =>
          entry.status === 'pass' &&
          entry.message === 'Service worker install handler calls waitUntil'
      )
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test('checkServiceWorker runs subsequent checks for Workbox Window registrations', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/ItemWorth/assets/index.js') {
      return new Response(
        "import('./workbox-window.prod.es5.js').then(({Workbox:e}) => new e('/ItemWorth/sw.js', { scope: '/ItemWorth/' })).then(e => e.register());",
        { status: 200 }
      );
    }

    if (url === 'https://example.com/ItemWorth/sw.js') {
      return new Response(
        "self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('fetch', () => {}); caches.open('v1');",
        { status: 200 }
      );
    }

    return new Response('', { status: 404 });
  };

  try {
    const results = await checkServiceWorker(
      '<html><head><script src="/ItemWorth/assets/index.js"></script></head><body></body></html>',
      'https://example.com/ItemWorth/'
    );

    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker registration found: https://example.com/ItemWorth/sw.js'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has fetch event handler'));
    assert.ok(!results.some(entry => entry.code === 'service-worker.registration.missing'));
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
        "self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('fetch', () => {}); self.addEventListener('push', event => { event.waitUntil(self.registration.showNotification('New message')); }); self.addEventListener('notificationclick', () => {}); caches.open('v1');",
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
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has install event handler' && entry.code === 'service-worker.install'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker install handler calls waitUntil'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has activate event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker activate handler calls waitUntil'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has fetch event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker appears to cache assets'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has push event handler'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker push handler calls waitUntil'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker push handler calls showNotification'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has notificationclick event handler'));
    assert.ok(!results.some(entry => entry.message.includes('does not expose a static URL')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkServiceWorker falls back to conventional sw.js when registration is generated', async () => {
  const originalFetch = global.fetch;

  global.fetch = async url => {
    if (url === 'https://example.com/sw.js') {
      return new Response(
        "self.addEventListener('install', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('activate', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('fetch', () => {}); self.addEventListener('push', event => { event.waitUntil(Promise.resolve()); }); self.addEventListener('notificationclick', () => {}); self.__WB_DISABLE_DEV_LOGS = true; caches.open('v1');",
        { status: 200 }
      );
    }

    return new Response('', { status: 404 });
  };

  try {
    const results = await checkServiceWorker(
      '<html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>',
      'https://example.com/'
    );

    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker registration found: https://example.com/sw.js'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker install handler calls waitUntil'));
    assert.ok(results.some(entry => entry.status === 'pass' && entry.message === 'Service worker has fetch event handler'));
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
