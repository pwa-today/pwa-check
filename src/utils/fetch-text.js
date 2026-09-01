export const browserLikeHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9'
};

import {
  getScopedAuthenticationHeaders
} from '../authentication.js';

const isLocalhostUrl = url => {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

export const fetchWithTimeout = async (
  url,
  {
    timeoutMs = 15000,
    headers = {},
    insecureLocalhost = false,
    authentication = null,
    fetchFunction = fetch,
    ...init
  } = {}
) => {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;
  const shouldIgnoreTls = insecureLocalhost && url.startsWith('https://') && isLocalhostUrl(url);

  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  const origin = authentication ? new URL(url).origin : null;
  const fetchWithAuthentication = async (requestUrl) => {
    const requestHeaders = {
      ...browserLikeHeaders,
      ...headers,
      ...getScopedAuthenticationHeaders(requestUrl, origin, authentication)
    };

    if (!authentication) {
      return await fetchFunction(requestUrl, {
        redirect: 'follow',
        headers: requestHeaders,
        signal: controller?.signal,
        ...init
      });
    }

    let response;
    let currentUrl = requestUrl;

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetchFunction(currentUrl, {
        redirect: 'manual',
        headers: {
          ...browserLikeHeaders,
          ...headers,
          ...getScopedAuthenticationHeaders(currentUrl, origin, authentication)
        },
        signal: controller?.signal,
        ...init
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get('location');

      if (!location || redirects === 5) {
        return response;
      }

      currentUrl = new URL(location, currentUrl).href;
    }

    return response;
  };

  try {
    if (shouldIgnoreTls) {
      const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

      try {
        return await fetchWithAuthentication(url);
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
        }
      }
    }

    return await fetchWithAuthentication(url);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const fetchText = async (url, options = {}) => {
  const response = await fetchWithTimeout(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
};
