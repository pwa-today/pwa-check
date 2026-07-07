import { fetchText } from '../utils/fetch-text.js';
import { findScriptUrls } from '../utils/find-script-urls.js';
import { result } from '../utils/result.js';

const resolveStartupImageExpression = (source, expression) => {
  const trimmedExpression = expression.trim().replace(/[),;]+$/, '');

  const quotedMatch = trimmedExpression.match(/^['"]([^'"]+)['"]$/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  const orParts = trimmedExpression.split('||').map(part => part.trim()).filter(Boolean);
  if (orParts.length > 1) {
    for (const part of orParts) {
      const resolved = resolveStartupImageExpression(source, part);
      if (resolved) return resolved;
    }
    return null;
  }

  const identifierMatch = trimmedExpression.match(/^[A-Za-z_$][\w$]*$/);
  if (identifierMatch) {
    const identifier = identifierMatch[0];
    const declarationMatch = source.match(
      new RegExp(
        String.raw`(?:const|let|var)\s+${identifier}\s*=\s*['"]([^'"]+)['"]`
      )
    );

    if (declarationMatch) {
      return declarationMatch[1];
    }
  }

  const memberExpressionMatch = trimmedExpression.match(
    /^[A-Za-z_$][\w$]*\.(mediaString|media)$/i
  );
  if (memberExpressionMatch) {
    const propertyName = memberExpressionMatch[1];
    const declarationMatch = source.match(
      new RegExp(
        String.raw`(?:const|let|var)?[\s\S]{0,80}\b${propertyName}\s*=\s*['"]([^'"]+)['"]`
      )
    );

    if (declarationMatch) {
      return declarationMatch[1];
    }
  }

  return null;
};

const hasStartupImage = source => {
  return /apple-touch-startup-image/i.test(source);
};

const hasPortraitStartupImage = source => {
  if (!hasStartupImage(source)) return false;

  const mediaMatch = source.match(
    /media\s*[:=]\s*([^,\n}]+)|media\s*=\s*([^,\n}]+)/i
  );

  if (mediaMatch) {
    const mediaExpression = mediaMatch[1] || mediaMatch[2];
    const media = resolveStartupImageExpression(source, mediaExpression) || mediaExpression;

    if (/orientation\s*[:=]\s*['"]?portrait['"]?/i.test(media)) {
      return true;
    }
  }

  return /orientation\s*[:=]\s*['"]?portrait['"]?/i.test(source);
};

const hasLandscapeStartupImage = source => {
  if (!hasStartupImage(source)) return false;

  const mediaMatch = source.match(
    /media\s*[:=]\s*([^,\n}]+)|media\s*=\s*([^,\n}]+)/i
  );

  if (mediaMatch) {
    const mediaExpression = mediaMatch[1] || mediaMatch[2];
    const media = resolveStartupImageExpression(source, mediaExpression) || mediaExpression;

    if (/orientation\s*[:=]\s*['"]?landscape['"]?/i.test(media)) {
      return true;
    }
  }

  return /orientation\s*[:=]\s*['"]?landscape['"]?/i.test(source);
};

const findInlineScriptSources = html => {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
};

export const checkIosSplashScreens = async (html, pageUrl, fetchOptions = {}) => {
  const results = [];
  const scriptUrls = findScriptUrls(html, pageUrl);
  const sources = [{ source: html, isHtml: true }];
  const inlineScripts = findInlineScriptSources(html);

  for (const inlineScript of inlineScripts) {
    sources.push({
      source: inlineScript,
      isHtml: false
    });
  }

  for (const scriptUrl of scriptUrls) {
    try {
      sources.push({
        source: await fetchText(scriptUrl, fetchOptions),
        isHtml: false
      });
    } catch {}
  }

  const sourceWithStartupImage = sources.find(entry => hasStartupImage(entry.source));

  if (!sourceWithStartupImage) {
    results.push(result('warn', 'No iOS startup image links found'));
    return results;
  }

  const hasPortrait = sources.some(entry => hasPortraitStartupImage(entry.source));
  const hasLandscape = sources.some(entry => hasLandscapeStartupImage(entry.source));

  results.push(result('pass', 'iOS startup image links found'));

  results.push(
    hasPortrait
      ? result('pass', 'iOS startup image includes a portrait variant')
      : result('warn', 'iOS startup image does not include a portrait variant')
  );

  results.push(
    hasLandscape
      ? result('pass', 'iOS startup image includes a landscape variant')
      : result('warn', 'iOS startup image does not include a landscape variant')
  );

  return results;
};
