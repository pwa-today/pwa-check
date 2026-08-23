import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getScopedAuthenticationHeaders,
  parseAuthentication
} from '../src/authentication.js';

test('applies authentication only to the audited origin', () => {
  const authentication = parseAuthentication(JSON.stringify({
    headers: { authorization: 'Bearer audit-token' },
    cookies: [{ name: 'session', value: 'cookie-value' }]
  }));

  assert.deepEqual(
    getScopedAuthenticationHeaders(
      'https://app.example.com/manifest.webmanifest',
      'https://app.example.com',
      authentication
    ),
    {
      authorization: 'Bearer audit-token',
      cookie: 'session=cookie-value'
    }
  );
  assert.deepEqual(
    getScopedAuthenticationHeaders(
      'https://cdn.example.com/asset.js',
      'https://app.example.com',
      authentication
    ),
    {}
  );
});

test('rejects unsupported authentication fields', () => {
  assert.throws(
    () => parseAuthentication(JSON.stringify({
      headers: { 'x-api-key': 'secret' }
    })),
    /Authentication must contain/
  );
});
