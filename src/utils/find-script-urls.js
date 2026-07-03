import {resolveUrl} from './url.js';

export const findScriptUrls = (html, pageUrl) => {
  const matches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)];

  return matches.map(match => resolveUrl(pageUrl, match[1]));
};
