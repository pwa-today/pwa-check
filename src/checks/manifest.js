import { fetchText } from '../utils/fetch-text.js';
import { result } from '../utils/result.js';
import { resolveUrl } from '../utils/url.js';

export const findManifestUrl = (html, pageUrl) => {
  const match = html.match(
    /<link[^>]+rel=["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i
  );

  if (!match) return null;

  const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);

  if (!hrefMatch) return null;

  return resolveUrl(pageUrl, hrefMatch[1]);
};

export const checkManifest = async (html, pageUrl) => {
  const results = [];
  const manifestUrl = findManifestUrl(html, pageUrl);

  if (!manifestUrl) {
    results.push(result('fail', 'No Web App Manifest found'));
    return results;
  }

  results.push(result('pass', `Manifest found: ${manifestUrl}`));

  try {
    const manifestText = await fetchText(manifestUrl);
    const manifest = JSON.parse(manifestText);

    results.push(result('pass', 'Manifest is valid JSON'));

    results.push(
      Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0
        ? result('pass', 'Manifest defines screenshots')
        : result('warn', 'Manifest does not define screenshots')
    );

    results.push(
      manifest.scope
        ? result('pass', 'Manifest has scope member')
        : result('warn', 'Manifest does not have scope member')
    );

    results.push(
      manifest.display
        ? result('pass', `Manifest has display member: ${manifest.display}`)
        : result('warn', 'Manifest does not have display member')
    );
  } catch (error) {
    results.push(result('fail', `Could not read manifest: ${error.message}`));
  }

  return results;
};
