import { fetchText } from '../utils/fetch-text.js';
import { findScriptUrls } from '../utils/find-script-urls.js';
import { result } from '../utils/result.js';
import { resolveUrl } from '../utils/url.js';

export const findManifestUrl = (source, pageUrl) => {
  const match = source.match(
    /<link[^>]+rel=["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i
  );

  if (!match) return null;

  const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);

  if (!hrefMatch) return null;

  return resolveUrl(pageUrl, hrefMatch[1]);
};

export const loadManifest = async manifestUrl => {
  return JSON.parse(await fetchText(manifestUrl));
};

const findManifestUrlInScript = (source, pageUrl) => {
  const htmlLinkMatch = source.match(
    /<link[^>]+rel=["'][^"']*\bmanifest\b[^"']*["'][^>]*>/i
  );

  if (htmlLinkMatch) {
    const hrefMatch = htmlLinkMatch[0].match(/href=["']([^"']+)["']/i);

    if (hrefMatch) {
      return resolveUrl(pageUrl, hrefMatch[1]);
    }
  }

  const objectLiteralMatch = source.match(
    /(?:node|createElement)\s*\(\s*['"]link['"]\s*,\s*\{[\s\S]{0,1000}?rel\s*:\s*['"]manifest['"][\s\S]{0,1000}?href\s*:\s*([^,}\n]+)[\s\S]{0,1000}?\}/i
  );

  if (objectLiteralMatch) {
    const resolved = resolveManifestHrefExpression(
      source,
      pageUrl,
      objectLiteralMatch[1]
    );

    if (resolved) {
      return resolved;
    }
  }

  const assignmentMatch = source.match(
    /(?:\.rel\s*=\s*['"]manifest['"]|setAttribute\(\s*['"]rel['"]\s*,\s*['"]manifest['"]\s*\)|rel\s*:\s*['"]manifest['"])[\s\S]{0,1000}?(?:\.href\s*=\s*([^;\n]+)|setAttribute\(\s*['"]href['"]\s*,\s*([^)\n]+)\)|href\s*:\s*([^,}\n]+))/i
  );

  if (!assignmentMatch) return null;

  const href = assignmentMatch[1] || assignmentMatch[2] || assignmentMatch[3];

  return href ? resolveManifestHrefExpression(source, pageUrl, href) : null;
};

const isLikelyManifestUrl = url => {
  try {
    const parsed = new URL(url);
    return /(?:manifest|webmanifest)\.(?:json|webmanifest)$|(?:manifest|webmanifest)$|\.json$|\.webmanifest$/i.test(
      parsed.pathname
    );
  } catch {
    return false;
  }
};

const resolveManifestHrefExpression = (source, pageUrl, expression) => {
  const trimmedExpression = expression.trim().replace(/[),;]+$/, '');

  const quotedMatch = trimmedExpression.match(/^['"]([^'"]+)['"]$/);
  if (quotedMatch) {
    const url = resolveUrl(pageUrl, quotedMatch[1]);
    return isLikelyManifestUrl(url) ? url : null;
  }

  const orParts = trimmedExpression.split('||').map(part => part.trim()).filter(Boolean);
  if (orParts.length > 1) {
    for (const part of orParts) {
      const resolved = resolveManifestHrefExpression(source, pageUrl, part);
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
      const url = resolveUrl(pageUrl, declarationMatch[1]);
      return isLikelyManifestUrl(url) ? url : null;
    }
  }

  const propertyAssignmentMatch = trimmedExpression.match(
    /^(?:[A-Za-z_$][\w$]*\.)?href\s*=\s*['"]([^'"]+)['"]$/
  );
  if (propertyAssignmentMatch) {
    const url = resolveUrl(pageUrl, propertyAssignmentMatch[1]);
    return isLikelyManifestUrl(url) ? url : null;
  }

  return null;
};

const hasManifestInjectionHint = source => {
  return (
    /rel\s*[:=]\s*['"]manifest['"]/i.test(source) &&
    (
      /createElement\s*\(\s*['"]link['"]\s*\)/i.test(source) ||
      /setAttribute\s*\(\s*['"]rel['"]\s*,\s*['"]manifest['"]\s*\)/i.test(source) ||
      /utils\.node\s*\(\s*['"]link['"]\s*,\s*\{[\s\S]{0,500}?rel\s*:\s*['"]manifest['"]/i.test(source) ||
      /appendChild\s*\(/i.test(source) ||
      /querySelector\s*\(\s*['"]head['"]\s*\)/i.test(source)
    )
  );
};

const findInlineScriptSources = html => {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
};

const parseSize = size => {
  const match = typeof size === 'string' && size.match(/^(\d+)x(\d+)$/);

  if (!match) return null;

  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
};

const hasValidShortcutIconSizes = icons => {
  return icons.every(
    icon =>
      icon &&
      typeof icon.src === 'string' &&
      icon.src.length > 0 &&
      typeof icon.sizes === 'string' &&
      /^\d+x\d+$/i.test(icon.sizes)
  );
};

const hasValidShareTargetFiles = files => {
  return files.every(
    file =>
      file &&
      typeof file.name === 'string' &&
      file.name.length > 0 &&
      Array.isArray(file.accept) &&
      file.accept.every(
        accept =>
          typeof accept === 'string' &&
          accept.length > 0 &&
          (/^[a-z0-9-]+\/[a-z0-9-+.]+$/i.test(accept) || /^\.[a-z0-9]+$/i.test(accept))
      )
  );
};

const hasValidFileHandlersAccept = accept => {
  if (!accept || typeof accept !== 'object' || Array.isArray(accept)) {
    return false;
  }

  return Object.entries(accept).every(([mimeType, extensions]) => {
    const hasValidMimeType = /^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/i.test(mimeType);
    const hasValidExtensions =
      typeof extensions === 'string'
        ? /^\.[a-z0-9]+$/i.test(extensions)
        : Array.isArray(extensions) &&
          extensions.length > 0 &&
          extensions.every(
            extension => typeof extension === 'string' && /^\.[a-z0-9]+$/i.test(extension)
          );

    return hasValidMimeType && hasValidExtensions;
  });
};

const isAssetReachable = async assetUrl => {
  try {
    const response = await fetch(assetUrl, { redirect: 'follow' });
    return response.ok;
  } catch {
    return false;
  }
};

const checkAssetReachabilityBatch = async (results, label, assets, baseUrl) => {
  if (!baseUrl) {
    return;
  }

  const tasks = assets
    .filter(assetUrl => typeof assetUrl === 'string' && assetUrl.length > 0)
    .map(async assetUrl => {
      const resolvedUrl = resolveUrl(baseUrl, assetUrl);
      const reachable = await isAssetReachable(resolvedUrl);

      return reachable
        ? result('pass', `${label} is reachable: ${resolvedUrl}`)
        : result('warn', `${label} is not reachable: ${resolvedUrl}`);
    });

  const settled = await Promise.allSettled(tasks);

  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      results.push(entry.value);
    }
  }
};

const screenshotAspectRatio = screenshot => {
  const parsedSizes =
    typeof screenshot?.sizes === 'string'
      ? screenshot.sizes.split(/\s+/).map(parseSize).filter(Boolean)
      : [];

  if (parsedSizes.length === 0) return null;

  const [{ width, height }] = parsedSizes;
  return Math.max(width, height) / Math.min(width, height);
};

export const checkManifestMembers = async (manifest, manifestUrl = null) => {
  const results = [];

  results.push(
    manifest.scope
      ? result('pass', 'Manifest has scope member')
      : result('warn', 'Manifest does not have scope member')
  );

  if (typeof manifest.display === 'string' && manifest.display.length > 0) {
    const allowedDisplays = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];

    results.push(
      allowedDisplays.includes(manifest.display)
        ? result('pass', `Manifest display is valid: ${manifest.display}`)
        : result(
            'warn',
            'Manifest display must be standalone, fullscreen, minimal-ui, or browser; standalone is recommended'
          )
    );
  } else {
    results.push(result('warn', 'Manifest does not have display member'));
  }

  results.push(
    manifest.start_url
      ? result('pass', `Manifest has start_url member: ${manifest.start_url}`)
      : result('warn', 'Manifest does not have start_url member')
  );

  results.push(
    manifest.description
      ? result('pass', 'Manifest has description member')
      : result('warn', 'Manifest does not have description member')
  );

  if (typeof manifest.short_name === 'string' && manifest.short_name.length > 0) {
    if (manifest.short_name.length > 15) {
      results.push(
        result(
          'warn',
          `Manifest short_name is too long (${manifest.short_name.length} characters); recommended maximum is 15`
        )
      );
    } else {
      results.push(
        result(
          'pass',
          `Manifest short_name length is acceptable (${manifest.short_name.length} characters)`
        )
      );
    }
  } else {
    results.push(result('warn', 'Manifest does not have short_name member'));
  }

  results.push(
    manifest.orientation
      ? result('pass', `Manifest has orientation member: ${manifest.orientation}`)
      : result('warn', 'Manifest does not have orientation member')
  );

  if (Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0) {
    results.push(result('pass', 'Manifest defines screenshots'));

    const screenshotMembers = ['src', 'sizes', 'type', 'form_factor'];
    const hasRequiredScreenshotFields = manifest.screenshots.every(
      screenshot =>
        screenshot &&
        screenshotMembers.every(member => Object.prototype.hasOwnProperty.call(screenshot, member))
    );

    results.push(
      hasRequiredScreenshotFields
        ? result('pass', 'Manifest screenshots include src, sizes, type, and form_factor')
        : result('warn', 'Manifest screenshots do not consistently include src, sizes, type, and form_factor')
    );

    const invalidScreenshotTypes = manifest.screenshots.filter(
      screenshot => !['image/png', 'image/jpg', 'image/jpeg'].includes(screenshot?.type)
    );

    results.push(
      invalidScreenshotTypes.length === 0
        ? result('pass', 'Manifest screenshots use supported image types')
        : result('warn', 'Manifest screenshots use unsupported image types')
    );

    const invalidScreenshotSizes = manifest.screenshots.filter(screenshot => {
      const parsedSizes =
        typeof screenshot?.sizes === 'string'
          ? screenshot.sizes.split(/\s+/).map(parseSize)
          : [];

      return (
        parsedSizes.length === 0 ||
        parsedSizes.some(
          size =>
            !size ||
            size.width < 320 ||
            size.width > 3840 ||
            size.height < 320 ||
            size.height > 3840
        )
      );
    });

    results.push(
      invalidScreenshotSizes.length === 0
        ? result('pass', 'Manifest screenshots use valid sizes between 320px and 3840px')
        : result('warn', 'Manifest screenshots include sizes outside 320px to 3840px')
    );

    const wideScreenshots = manifest.screenshots.filter(
      screenshot => screenshot?.form_factor === 'wide'
    );
    const narrowScreenshots = manifest.screenshots.filter(
      screenshot => screenshot?.form_factor === 'narrow'
    );

    results.push(
      wideScreenshots.length > 0
        ? result('pass', 'Manifest includes at least one wide screenshot')
        : result('warn', 'Manifest does not include a wide screenshot')
    );

    results.push(
      narrowScreenshots.length > 0
        ? result('pass', 'Manifest includes at least one narrow screenshot')
        : result('warn', 'Manifest does not include a narrow screenshot')
    );

    const invalidAspectGroups = [wideScreenshots, narrowScreenshots].filter(screenshots => {
      if (screenshots.length === 0) return false;

      const ratios = screenshots
        .map(screenshotAspectRatio)
        .filter(ratio => typeof ratio === 'number' && Number.isFinite(ratio));

      if (ratios.length === 0) return true;

      const minRatio = Math.min(...ratios);
      const maxRatio = Math.max(...ratios);

      return maxRatio / minRatio > 2.3;
    });

    results.push(
      invalidAspectGroups.length === 0
        ? result('pass', 'Manifest screenshots keep aspect ratios within the 2.3 limit')
        : result('warn', 'Manifest screenshots have aspect ratios outside the 2.3 limit')
    );

    results.push(
      manifest.screenshots.length <= 8
        ? result('pass', 'Manifest has no more than 8 screenshots')
        : result('warn', 'Manifest defines more than 8 screenshots')
    );

    results.push(
      narrowScreenshots.length <= 5
        ? result('pass', 'Manifest has no more than 5 narrow screenshots')
        : result('warn', 'Manifest defines more than 5 narrow screenshots')
    );

    await checkAssetReachabilityBatch(
      results,
      'Manifest screenshot',
      manifest.screenshots.map(screenshot => screenshot?.src),
      manifestUrl
    );
  } else {
    results.push(result('warn', 'Manifest does not define screenshots'));
  }

  if (Array.isArray(manifest.icons) && manifest.icons.length > 0) {
    results.push(result('pass', 'Manifest defines icons'));

    const hasRequiredIconFields = manifest.icons.some(
      icon => icon && icon.src && icon.type && icon.sizes
    );

    results.push(
      hasRequiredIconFields
        ? result('pass', 'Manifest icons include src, type, and sizes')
        : result('warn', 'Manifest icons do not consistently include src, type, and sizes')
    );

    const iconSizes = manifest.icons
      .map(icon => icon && icon.sizes)
      .filter(Boolean);

    const missingRecommendedSizes = ['192x192', '384x384', '1024x1024'].filter(
      size => !iconSizes.some(sizes => sizes.includes(size))
    );

    results.push(
      iconSizes.some(sizes => sizes.includes('512x512'))
        ? result('pass', 'Manifest includes a 512x512 icon')
        : result('warn', 'Manifest does not include a 512x512 icon')
    );

    if (missingRecommendedSizes.length === 0) {
      results.push(
        result('pass', 'Manifest includes recommended 192x192, 384x384, and 1024x1024 icons')
      );
    } else {
      results.push(
        result(
          'warn',
          `Manifest is missing recommended icon sizes: ${missingRecommendedSizes.join(', ')}`
        )
      );
    }

    const hasMaskableIcon = manifest.icons.some(
      icon =>
        icon &&
        icon.purpose === 'maskable' &&
        typeof icon.sizes === 'string' &&
        icon.sizes.includes('512x512')
    );

    results.push(
      hasMaskableIcon
        ? result('pass', 'Manifest includes a 512x512 maskable icon')
        : result('warn', 'Manifest does not include a 512x512 maskable icon')
    );

    await checkAssetReachabilityBatch(
      results,
      'Manifest icon',
      manifest.icons.map(icon => icon?.src),
      manifestUrl
    );
  } else {
    results.push(result('warn', 'Manifest does not define icons'));
  }

  if (Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0) {
    results.push(result('pass', 'Manifest defines shortcuts'));

    const hasRequiredShortcutMembers = manifest.shortcuts.every(
      shortcut =>
        shortcut &&
        typeof shortcut.name === 'string' &&
        shortcut.name.length > 0 &&
        typeof shortcut.url === 'string' &&
        shortcut.url.length > 0
    );

    results.push(
      hasRequiredShortcutMembers
        ? result('pass', 'Manifest shortcuts include name and url')
        : result('warn', 'Manifest shortcuts do not consistently include name and url')
    );

    const optionalShortcutMembersPresent = manifest.shortcuts.every(shortcut => {
      if (!shortcut) return false;

      const optionalKeys = ['short_name', 'description'];
      return optionalKeys.every(key => {
        return (
          shortcut[key] === undefined ||
          typeof shortcut[key] === 'string'
        );
      });
    });

    results.push(
      optionalShortcutMembersPresent
        ? result('pass', 'Manifest shortcuts optionally include short_name and description')
        : result('warn', 'Manifest shortcuts include invalid short_name or description values')
    );

    const shortcutsWithIcons = manifest.shortcuts.filter(shortcut => Array.isArray(shortcut?.icons));
    if (shortcutsWithIcons.length > 0) {
      const hasValidShortcutIcons = shortcutsWithIcons.every(shortcut =>
        hasValidShortcutIconSizes(shortcut.icons)
      );

      results.push(
        hasValidShortcutIcons
        ? result('pass', 'Manifest shortcut icons include src and sizes')
        : result('warn', 'Manifest shortcut icons do not consistently include src and sizes')
      );

      for (const shortcut of shortcutsWithIcons) {
        await checkAssetReachabilityBatch(
          results,
          'Manifest shortcut icon',
          shortcut.icons.map(icon => icon?.src),
          manifestUrl
        );
      }
    }
  } else {
    results.push(result('warn', 'Manifest does not define shortcuts'));
  }

  if (manifest.share_target && typeof manifest.share_target === 'object') {
    results.push(result('pass', 'Manifest defines share_target'));

    const shareTarget = manifest.share_target;
    const isRelativeAction =
      typeof shareTarget.action === 'string' &&
      shareTarget.action.length > 0 &&
      !/^https?:\/\//i.test(shareTarget.action);

    results.push(
      isRelativeAction
        ? result('pass', 'Manifest share_target action is a relative URL')
        : result('warn', 'Manifest share_target action is missing or is not a relative URL')
    );

    const hasValidMethod =
      typeof shareTarget.method === 'string' &&
      ['GET', 'POST'].includes(shareTarget.method.toUpperCase());

    results.push(
      hasValidMethod
        ? result('pass', `Manifest share_target method is valid: ${shareTarget.method.toUpperCase()}`)
        : result('warn', 'Manifest share_target method must be GET or POST')
    );

    if (String(shareTarget.method).toUpperCase() === 'POST') {
      results.push(
        shareTarget.enctype === 'multipart/form-data'
          ? result('pass', 'Manifest share_target enctype is multipart/form-data')
          : result('warn', 'Manifest share_target enctype must be multipart/form-data when method is POST')
      );
    }

    if (shareTarget.params && typeof shareTarget.params === 'object') {
      const allowedParamKeys = ['title', 'text', 'url', 'files'];
      const invalidParamKeys = Object.keys(shareTarget.params).filter(
        key => !allowedParamKeys.includes(key)
      );

      results.push(
        invalidParamKeys.length === 0
          ? result('pass', 'Manifest share_target params contain supported members')
          : result('warn', `Manifest share_target params contain unsupported members: ${invalidParamKeys.join(', ')}`)
      );

      if (Array.isArray(shareTarget.params.files) && shareTarget.params.files.length > 0) {
        const hasValidFiles = hasValidShareTargetFiles(shareTarget.params.files);

        results.push(
          hasValidFiles
            ? result('pass', 'Manifest share_target files include name and accept')
            : result('warn', 'Manifest share_target files do not consistently include valid name and accept values')
        );
      }
    } else {
      results.push(result('warn', 'Manifest share_target does not define params'));
    }
  } else {
    results.push(result('warn', 'Manifest does not define share_target'));
  }

  if (Array.isArray(manifest.file_handlers) && manifest.file_handlers.length > 0) {
    results.push(result('pass', 'Manifest defines file_handlers'));

    const hasValidFileHandlers = manifest.file_handlers.every(
      fileHandler =>
        fileHandler &&
        typeof fileHandler.action === 'string' &&
        fileHandler.action.length > 0 &&
        !/^https?:\/\//i.test(fileHandler.action) &&
        hasValidFileHandlersAccept(fileHandler.accept)
    );

    results.push(
      hasValidFileHandlers
        ? result('pass', 'Manifest file_handlers include a relative action and valid accept mappings')
        : result('warn', 'Manifest file_handlers do not consistently include a relative action and valid accept mappings')
    );
  } else {
    results.push(result('warn', 'Manifest does not define file_handlers'));
  }

  if (typeof manifest.handle_links === 'string' && manifest.handle_links.length > 0) {
    results.push(
      ['preferred', 'not-preferred', 'auto'].includes(manifest.handle_links)
        ? result('pass', `Manifest handle_links is valid: ${manifest.handle_links}`)
        : result('warn', 'Manifest handle_links must be preferred, not-preferred, or auto')
    );
  } else {
    results.push(result('warn', 'Manifest does not define handle_links'));
  }

  return results;
};

export const checkManifest = async (html, pageUrl) => {
  const results = [];
  const scriptUrls = findScriptUrls(html, pageUrl);
  let manifestUrl = findManifestUrl(html, pageUrl);
  const inlineScripts = findInlineScriptSources(html);
  let manifestInjectedInScript = false;

  if (!manifestUrl) {
    for (const inlineScript of inlineScripts) {
      const scriptManifestUrl = findManifestUrlInScript(inlineScript, pageUrl);

      if (scriptManifestUrl) {
        manifestUrl = scriptManifestUrl;
        results.push(
          result(
            'warn',
            'Web App Manifest is only discoverable in inline JavaScript; link it in the HTML head for better install detection'
          )
        );

        break;
      }

      if (hasManifestInjectionHint(inlineScript)) {
        manifestInjectedInScript = true;
      }
    }
  }

  if (!manifestUrl) {
    for (const scriptUrl of scriptUrls) {
      try {
        const scriptSource = await fetchText(scriptUrl);
        const scriptManifestUrl = findManifestUrlInScript(scriptSource, scriptUrl);

        if (scriptManifestUrl) {
          manifestUrl = scriptManifestUrl;
          results.push(
            result(
              'warn',
              'Web App Manifest is only discoverable in JavaScript; link it in the HTML head for better install detection'
            )
          );

          break;
        }

        if (hasManifestInjectionHint(scriptSource)) {
          manifestInjectedInScript = true;
        }
      } catch {}
    }
  }

  if (!manifestUrl) {
    if (manifestInjectedInScript) {
      results.push(
        result(
          'warn',
          'Web App Manifest appears to be injected by JavaScript, but could not be resolved statically. This may prevent the app from being installed on some devices'
        )
      );
      return results;
    }

    results.push(result('fail', 'No Web App Manifest found in HTML or scripts'));
    return results;
  }

  if (manifestUrl) {
    results.push(result('pass', `Manifest found: ${manifestUrl}`));
  }

  try {
    const manifest = await loadManifest(manifestUrl);
    results.push(result('pass', 'Manifest is valid JSON'));
    results.push(...await checkManifestMembers(manifest, manifestUrl));
  } catch (error) {
    results.push(result('fail', `Could not read manifest: ${error.message}`));
  }

  return results;
};
