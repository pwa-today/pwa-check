import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSafePublicFetch,
  UnsafeUrlError
} from '../src/utils/public-fetch.js';

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
