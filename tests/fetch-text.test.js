import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchText } from '../src/utils/fetch-text.js';

test('fetchText sends browser-like headers', async () => {
  const originalFetch = global.fetch;
  let capturedOptions;

  global.fetch = async (url, options) => {
    capturedOptions = options;

    return new Response('ok', {
      status: 200
    });
  };

  try {
    await fetchText('https://example.com/');

    assert.equal(capturedOptions.redirect, 'follow');
    assert.equal('user-agent' in capturedOptions.headers, false);
    assert.equal(
      capturedOptions.headers.accept,
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchText times out when the request takes too long', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    return await new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  };

  try {
    await assert.rejects(
      fetchText('https://example.com/', { timeoutMs: 1 }),
      /Request timed out after 1ms/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchText can ignore tls errors for localhost when requested', async () => {
  const originalFetch = global.fetch;
  const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  let capturedTlsSetting;

  global.fetch = async () => {
    capturedTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    return new Response('ok', {
      status: 200
    });
  };

  try {
    await fetchText('https://localhost:8800/', { insecureLocalhost: true });

    assert.equal(capturedTlsSetting, '0');
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalTlsSetting);
  } finally {
    global.fetch = originalFetch;

    if (originalTlsSetting === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
    }
  }
});
