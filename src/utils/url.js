export const resolveUrl = (baseUrl, possiblyRelativeUrl) => {
  return new URL(possiblyRelativeUrl, baseUrl).href;
};

export const getDocumentBaseUrl = (html, pageUrl) => {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const href = baseTag?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];

  return href ? resolveUrl(pageUrl, href) : pageUrl;
};

export const normalizeUrl = inputUrl => {
  return inputUrl.startsWith('http')
    ? inputUrl
    : `https://${inputUrl}`;
};
