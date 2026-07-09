export const browserLikeHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

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
  { timeoutMs = 15000, headers = {}, insecureLocalhost = false, ...init } = {}
) => {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;
  const shouldIgnoreTls = insecureLocalhost && url.startsWith('https://') && isLocalhostUrl(url);

  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    if (shouldIgnoreTls) {
      const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

      try {
        return await fetch(url, {
          redirect: 'follow',
          headers: { ...browserLikeHeaders, ...headers },
          signal: controller?.signal,
          ...init
        });
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
        }
      }
    }

    return await fetch(url, {
      redirect: 'follow',
      headers: { ...browserLikeHeaders, ...headers },
      signal: controller?.signal,
      ...init
    });
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
