import assert from 'node:assert/strict';
import test from 'node:test';

import { MockAgent } from 'undici';

import {
  createSafePublicFetch,
  UnsafeUrlError
} from '../src/utils/public-fetch.js';

test('uses the default package fetch with an Undici dispatcher', async () => {
  const dispatcher = new MockAgent();
  const pool = dispatcher.get('https://example.com');

  dispatcher.disableNetConnect();
  pool.intercept({ path: '/', method: 'GET' }).reply(200, 'PWA check');

  const safeFetch = createSafePublicFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    createDispatcher: () => dispatcher
  });
  const response = await safeFetch('https://example.com/');

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'PWA check');
});

test('allows the default request budget required for repeated script analysis', async () => {
  const safeFetch = createSafePublicFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchFunction: async () => new Response('PWA check')
  });

  await Promise.all(
    Array.from({ length: 120 }, () => safeFetch('https://example.com/'))
  );

  await assert.rejects(
    safeFetch('https://example.com/'),
    /too many remote resources/
  );
});

test('rejects a private generic-check target before requesting it', async () => {
  const safeFetch = createSafePublicFetch({
    fetchFunction: async () => assert.fail('The private target must not be requested.')
  });

  await assert.rejects(
    safeFetch('http://127.0.0.1/'),
    UnsafeUrlError
  );
});

test('rejects a redirect from a public target to a private target', async () => {
  const safeFetch = createSafePublicFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchFunction: async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/' }
    })
  });

  await assert.rejects(
    safeFetch('https://example.com/'),
    UnsafeUrlError
  );
});
