import { result } from '../utils/result.js';

const findViewportMeta = html => {
  const match = html.match(
    /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );

  if (match) return match[1];

  const reversedMatch = html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']viewport["'][^>]*>/i
  );

  return reversedMatch ? reversedMatch[1] : null;
};

const hasRequiredViewportContent = content => {
  if (typeof content !== 'string') return false;

  const tokens = content
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);

  const hasInitialScale = tokens.some(token => /^initial-scale=1(?:\.0+)?$/i.test(token));

  return (
    tokens.includes('width=device-width') &&
    hasInitialScale &&
    tokens.includes('viewport-fit=cover')
  );
};

const getMissingViewportTokens = content => {
  if (typeof content !== 'string') {
    return ['width=device-width', 'initial-scale=1', 'viewport-fit=cover'];
  }

  const tokens = content
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);

  const hasInitialScale = tokens.some(token => /^initial-scale=1(?:\.0+)?$/i.test(token));

  return [
    tokens.includes('width=device-width') ? null : 'width=device-width',
    hasInitialScale ? null : 'initial-scale=1',
    tokens.includes('viewport-fit=cover') ? null : 'viewport-fit=cover'
  ].filter(Boolean);
};

export const checkViewport = async html => {
  const results = [];
  const viewportContent = findViewportMeta(html);

  if (!viewportContent) {
    results.push(result('warn', 'No viewport meta tag found'));
    return results;
  }

  results.push(
    hasRequiredViewportContent(viewportContent)
      ? result('pass', 'Viewport meta tag is configured for PWA display')
      : result(
          'warn',
          `Viewport meta tag is missing recommended tokens: ${getMissingViewportTokens(viewportContent).join(', ')}`
        )
  );

  return results;
};
