export const browserLikeHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

export const fetchWithTimeout = async (
  url,
  { timeoutMs = 15000, headers = {}, ...init } = {}
) => {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;

  if (controller) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
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
