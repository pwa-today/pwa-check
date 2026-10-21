import {getDocumentBaseUrl, resolveUrl} from './url.js';

export const findScriptUrls = (html, pageUrl) => {
  const matches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)];

  const baseUrl = getDocumentBaseUrl(html, pageUrl);

  return matches.map(match => resolveUrl(baseUrl, match[1]));
};
