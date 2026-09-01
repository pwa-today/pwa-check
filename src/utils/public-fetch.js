import { lookup as defaultLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Agent, fetch } from 'undici';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_MAX_RESOURCE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT = 15_000;

export class UnsafeUrlError extends Error {
  constructor(message = 'The URL must resolve to a public HTTPS address.') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const ipv4Number = (address) => {
  return address.split('.').reduce((value, part) => {
    return (value * 256) + Number(part);
  }, 0) >>> 0;
};

const inIpv4Range = (address, network, prefix) => {
  const mask = prefix === 0
    ? 0
    : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
};

const isPublicIpv4 = (address) => {
  const blockedRanges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ];

  return !blockedRanges.some(([network, prefix]) => {
    return inIpv4Range(address, network, prefix);
  });
};

const normalizeIpv6 = (address) => address.toLowerCase().split('%')[0];
const urlHostname = (url) => url.hostname.replace(/^\[|\]$/g, '');

const isPublicIpv6 = (address) => {
  const normalized = normalizeIpv6(address);
  const [firstPart, secondPart = '0'] = normalized.split(':');
  const first = Number.parseInt(firstPart, 16);
  const second = Number.parseInt(secondPart || '0', 16);

  if (normalized.startsWith('::ffff:')) {
    return false;
  }

  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !(first === 0x2001 && second <= 0x01ff) &&
    !normalized.startsWith('2001:db8:') &&
    !normalized.startsWith('2002:') &&
    first !== 0x3fff
  );
};

export const isPublicIpAddress = (address) => {
  const family = isIP(address);

  if (family === 4) {
    return isPublicIpv4(address);
  }

  if (family === 6) {
    return isPublicIpv6(address);
  }

  return false;
};

export const normalizePublicHttpsUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('A URL is required.');
  }

  if (value.length > 2048) {
    throw new TypeError('The URL must not exceed 2048 characters.');
  }

  let url;

  try {
    url = new URL(value);
  }
  catch {
    throw new TypeError('The URL must be a valid HTTPS URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new TypeError(
      'The URL must use HTTPS without credentials or a custom port.'
    );
  }

  const hostname = urlHostname(url);

  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new UnsafeUrlError();
  }

  url.hash = '';

  return url.href;
};

export const normalizePublicHttpUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('A URL is required.');
  }

  let url;

  try {
    url = new URL(value);
  }
  catch {
    throw new TypeError('The URL must be a valid HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('The URL must use HTTP or HTTPS without credentials.');
  }

  const hostname = urlHostname(url);

  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new UnsafeUrlError();
  }

  url.hash = '';

  return url.href;
};

export const resolvePublicAddress = async (
  url,
  {
    lookup = defaultLookup
  } = {}
) => {
  const normalizedUrl = normalizePublicHttpUrl(url);
  const hostname = urlHostname(new URL(normalizedUrl));
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, {
        all: true,
        verbatim: true
      });

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new UnsafeUrlError();
  }

  return {
    url: normalizedUrl,
    address: addresses[0]
  };
};

const readLimitedBody = async (
  response,
  {
    maximumBytes,
    remainingBytes
  }
) => {
  const contentLength = Number(response.headers.get('content-length'));

  if (
    Number.isFinite(contentLength) &&
    (contentLength > maximumBytes || contentLength > remainingBytes)
  ) {
    await response.body?.cancel();
    throw new Error('The remote resource is too large.');
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > maximumBytes || size > remainingBytes) {
        await reader.cancel();
        throw new Error('The remote resource is too large.');
      }

      chunks.push(value);
    }
  }
  finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;

  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return body;
};

const createPinnedLookup = ({ address, family }) => {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }

    callback(null, address, family);
  };
};

export const createSafePublicFetch = ({
  fetchFunction = fetch,
  lookup = defaultLookup,
  allowedMethods = ['GET', 'HEAD'],
  createDispatcher = (address) => new Agent({
    connect: {
      lookup: createPinnedLookup(address)
    }
  }),
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxRequests = DEFAULT_MAX_REQUESTS,
  maxResourceBytes = DEFAULT_MAX_RESOURCE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  requestTimeout = DEFAULT_REQUEST_TIMEOUT
} = {}) => {
  let requestCount = 0;
  let totalBytes = 0;

  const safeFetch = async (input, init = {}, redirectCount = 0) => {
    const method = (init.method ?? 'GET').toUpperCase();

    if (!allowedMethods.includes(method)) {
      throw new UnsafeUrlError(
        `Only ${allowedMethods.join(', ')} requests are allowed.`
      );
    }

    requestCount += 1;

    if (requestCount > maxRequests) {
      throw new Error('The audit requested too many remote resources.');
    }

    const target = await resolvePublicAddress(
      input instanceof Request ? input.url : String(input),
      { lookup }
    );
    const dispatcher = createDispatcher(target.address);
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error('The remote request timed out.'));
    }, requestTimeout);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetchFunction(target.url, {
        ...init,
        method,
        signal,
        redirect: 'manual',
        dispatcher
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');

        if (location) {
          await response.body?.cancel();

          if (redirectCount >= maxRedirects) {
            throw new Error('The remote resource redirected too many times.');
          }

          const redirectUrl = new URL(location, target.url).href;

          return await safeFetch(redirectUrl, {
            ...init,
            method: response.status === 303 ? 'GET' : method
          }, redirectCount + 1);
        }
      }

      const body = method === 'HEAD'
        ? new Uint8Array()
        : await readLimitedBody(response, {
            maximumBytes: maxResourceBytes,
            remainingBytes: maxTotalBytes - totalBytes
          });

      totalBytes += body.byteLength;

      const headers = new Headers(response.headers);

      headers.delete('content-encoding');
      headers.delete('content-length');

      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    finally {
      clearTimeout(timeoutId);
      await dispatcher.close?.();
    }
  };

  return safeFetch;
};
