import { fetchText, fetchWithTimeout } from '../utils/fetch-text.js';
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

export const loadManifest = async (manifestUrl, fetchOptions = {}) => {
  return JSON.parse(await fetchText(manifestUrl, fetchOptions));
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

const isAssetReachable = async (assetUrl, fetchOptions = {}) => {
  try {
    const response = await fetchWithTimeout(assetUrl, fetchOptions);
    return response.ok;
  } catch {
    return false;
  }
};

const checkAssetReachabilityBatch = async (
  results,
  label,
  code,
  assets,
  baseUrl,
  fetchOptions = {}
) => {
  if (!baseUrl) {
    return;
  }

  const tasks = assets
    .filter(assetUrl => typeof assetUrl === 'string' && assetUrl.length > 0)
    .map(async assetUrl => {
      const resolvedUrl = resolveUrl(baseUrl, assetUrl);
      const reachable = await isAssetReachable(resolvedUrl, fetchOptions);

      return reachable
        ? result('pass', `${label} is reachable: ${resolvedUrl}`, code)
        : result('warn', `${label} is not reachable: ${resolvedUrl}`, code);
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

const hasManifestInstallabilityCriteria = manifest => {
  const hasName =
    (typeof manifest.short_name === 'string' && manifest.short_name.length > 0) ||
    (typeof manifest.name === 'string' && manifest.name.length > 0);
  const hasDisplay = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'].includes(
    manifest.display
  );
  const hasStartUrl = typeof manifest.start_url === 'string' && manifest.start_url.length > 0;
  const hasPreferRelatedApplications =
    manifest.prefer_related_applications === undefined ||
    manifest.prefer_related_applications === false;

  const hasInstallableIcon = Array.isArray(manifest.icons)
    ? manifest.icons.some(icon =>
        typeof icon?.sizes === 'string' &&
        icon.sizes.split(/\s+/).some(size => {
          const parsed = parseSize(size);

          return parsed && parsed.width >= 144 && parsed.height >= 144;
        })
      )
    : false;

  return (
    hasName &&
    hasDisplay &&
    hasStartUrl &&
    hasPreferRelatedApplications &&
    hasInstallableIcon
  );
};

const cssNamedColors = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen'
]);

const isValidColorValue = value => {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  const hexColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
  const rgbColor =
    /^rgb\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
  const modernRgbColor =
    /^rgb\(\s*(?:\d{1,3}\s+){2}\d{1,3}(?:\s*\/\s*(?:0|1|0?\.\d+))?\s*\)$/i;

  return (
    hexColor.test(normalized) ||
    rgbColor.test(normalized) ||
    modernRgbColor.test(normalized) ||
    cssNamedColors.has(normalized)
  );
};

export const checkManifestMembers = async (manifest, manifestUrl = null, fetchOptions = {}) => {
  const results = [];

  results.push(
    manifest.scope
      ? result('pass', 'Manifest has scope member', 'manifest.scope')
      : result('warn', 'Manifest does not have scope member', 'manifest.scope')
  );

  if (typeof manifest.display === 'string' && manifest.display.length > 0) {
    const allowedDisplays = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];

    results.push(
      allowedDisplays.includes(manifest.display)
        ? result('pass', `Manifest display is valid: ${manifest.display}`, 'manifest.display')
        : result(
            'warn',
            'Manifest display must be standalone, fullscreen, minimal-ui, or browser; standalone is recommended',
            'manifest.display'
          )
    );
  } else {
    results.push(result('warn', 'Manifest does not have display member', 'manifest.display'));
  }

  results.push(
    manifest.start_url
      ? result('pass', `Manifest has start_url member: ${manifest.start_url}`, 'manifest.start-url')
      : result('warn', 'Manifest does not have start_url member', 'manifest.start-url')
  );

  results.push(
    manifest.description
      ? result('pass', 'Manifest has description member', 'manifest.description')
      : result('warn', 'Manifest does not have description member', 'manifest.description')
  );

  if (typeof manifest.short_name === 'string' && manifest.short_name.length > 0) {
    if (manifest.short_name.length > 15) {
      results.push(
        result(
          'warn',
          `Manifest short_name is too long (${manifest.short_name.length} characters); recommended maximum is 15`,
          'manifest.short-name'
        )
      );
    } else {
      results.push(
        result(
          'pass',
          `Manifest short_name length is acceptable (${manifest.short_name.length} characters)`,
          'manifest.short-name'
        )
      );
    }
  } else {
    results.push(result('warn', 'Manifest does not have short_name member', 'manifest.short-name'));
  }

  results.push(
    manifest.orientation
      ? result('pass', `Manifest has orientation member: ${manifest.orientation}`, 'manifest.orientation')
      : result('warn', 'Manifest does not have orientation member', 'manifest.orientation')
  );

  if (typeof manifest.theme_color === 'string' && manifest.theme_color.length > 0) {
    results.push(result('pass', `Manifest has theme_color member: ${manifest.theme_color}`, 'manifest.theme-color'));
    results.push(
      isValidColorValue(manifest.theme_color)
        ? result('pass', `Manifest theme_color is a valid color: ${manifest.theme_color}`, 'manifest.theme-color.valid')
        : result('warn', 'Manifest theme_color must be a valid color', 'manifest.theme-color.valid')
    );
  } else {
    results.push(result('warn', 'Manifest does not have theme_color member', 'manifest.theme-color'));
  }

  if (typeof manifest.background_color === 'string' && manifest.background_color.length > 0) {
    results.push(
      result('pass', `Manifest has background_color member: ${manifest.background_color}`, 'manifest.background-color')
    );
    results.push(
      isValidColorValue(manifest.background_color)
        ? result(
            'pass',
            `Manifest background_color is a valid color: ${manifest.background_color}`,
            'manifest.background-color.valid'
          )
        : result('warn', 'Manifest background_color must be a valid color', 'manifest.background-color.valid')
    );
  } else {
    results.push(result('warn', 'Manifest does not have background_color member', 'manifest.background-color'));
  }

  if (Array.isArray(manifest.screenshots) && manifest.screenshots.length > 0) {
    results.push(result('pass', 'Manifest defines screenshots', 'manifest.screenshots'));

    const screenshotMembers = ['src', 'sizes', 'type', 'form_factor'];
    const hasRequiredScreenshotFields = manifest.screenshots.every(
      screenshot =>
        screenshot &&
        screenshotMembers.every(member => Object.prototype.hasOwnProperty.call(screenshot, member))
    );

    results.push(
      hasRequiredScreenshotFields
        ? result('pass', 'Manifest screenshots include src, sizes, type, and form_factor', 'manifest.screenshots.members')
        : result('warn', 'Manifest screenshots do not consistently include src, sizes, type, and form_factor', 'manifest.screenshots.members')
    );

    const invalidScreenshotTypes = manifest.screenshots.filter(
      screenshot => !['image/png', 'image/jpg', 'image/jpeg'].includes(screenshot?.type)
    );

    results.push(
      invalidScreenshotTypes.length === 0
        ? result('pass', 'Manifest screenshots use supported image types', 'manifest.screenshots.types')
        : result('warn', 'Manifest screenshots use unsupported image types', 'manifest.screenshots.types')
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
        ? result('pass', 'Manifest screenshots use valid sizes between 320px and 3840px', 'manifest.screenshots.sizes')
        : result('warn', 'Manifest screenshots include sizes outside 320px to 3840px', 'manifest.screenshots.sizes')
    );

    const wideScreenshots = manifest.screenshots.filter(
      screenshot => screenshot?.form_factor === 'wide'
    );
    const narrowScreenshots = manifest.screenshots.filter(
      screenshot => screenshot?.form_factor === 'narrow'
    );

    results.push(
      wideScreenshots.length > 0
        ? result('pass', 'Manifest includes at least one wide screenshot', 'manifest.screenshots.wide')
        : result('warn', 'Manifest does not include a wide screenshot', 'manifest.screenshots.wide')
    );

    results.push(
      narrowScreenshots.length > 0
        ? result('pass', 'Manifest includes at least one narrow screenshot', 'manifest.screenshots.narrow')
        : result('warn', 'Manifest does not include a narrow screenshot', 'manifest.screenshots.narrow')
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
        ? result('pass', 'Manifest screenshots keep aspect ratios within the 2.3 limit', 'manifest.screenshots.aspect-ratio')
        : result('warn', 'Manifest screenshots have aspect ratios outside the 2.3 limit', 'manifest.screenshots.aspect-ratio')
    );

    results.push(
      manifest.screenshots.length <= 8
        ? result('pass', 'Manifest has no more than 8 screenshots', 'manifest.screenshots.count')
        : result('warn', 'Manifest defines more than 8 screenshots', 'manifest.screenshots.count')
    );

    results.push(
      narrowScreenshots.length <= 5
        ? result('pass', 'Manifest has no more than 5 narrow screenshots', 'manifest.screenshots.narrow-count')
        : result('warn', 'Manifest defines more than 5 narrow screenshots', 'manifest.screenshots.narrow-count')
    );

    await checkAssetReachabilityBatch(
      results,
      'Manifest screenshot',
      'manifest.screenshots.reachable',
      manifest.screenshots.map(screenshot => screenshot?.src),
      manifestUrl,
      fetchOptions
    );
  } else {
    results.push(result('warn', 'Manifest does not define screenshots', 'manifest.screenshots.missing'));
  }

  if (Array.isArray(manifest.icons) && manifest.icons.length > 0) {
    results.push(result('pass', 'Manifest defines icons', 'manifest.icons'));

    const hasRequiredIconFields = manifest.icons.some(
      icon => icon && icon.src && icon.type && icon.sizes
    );

    results.push(
      hasRequiredIconFields
        ? result('pass', 'Manifest icons include src, type, and sizes', 'manifest.icons.members')
        : result('warn', 'Manifest icons do not consistently include src, type, and sizes', 'manifest.icons.members')
    );

    const iconSizes = manifest.icons
      .map(icon => icon && icon.sizes)
      .filter(Boolean);

    const missingRecommendedSizes = ['192x192', '384x384', '1024x1024'].filter(
      size => !iconSizes.some(sizes => sizes.includes(size))
    );

    results.push(
      iconSizes.some(sizes => sizes.includes('512x512'))
        ? result('pass', 'Manifest includes a 512x512 icon', 'manifest.icons.512')
        : result('warn', 'Manifest does not include a 512x512 icon', 'manifest.icons.512')
    );

    if (missingRecommendedSizes.length === 0) {
      results.push(
        result('pass', 'Manifest includes recommended 192x192, 384x384, and 1024x1024 icons', 'manifest.icons.recommended-sizes')
      );
    } else {
      results.push(
        result(
          'warn',
          `Manifest is missing recommended icon sizes: ${missingRecommendedSizes.join(', ')}`,
          'manifest.icons.recommended-sizes',
          { missingSizes: missingRecommendedSizes }
        )
      );
    }

    const canonicalIconSizes = ['192x192', '384x384', '512x512', '1024x1024'];
    const missingMaskableSizes = canonicalIconSizes.filter(size => {
      return !manifest.icons.some(
        icon =>
          icon &&
          icon.purpose === 'maskable' &&
          typeof icon.sizes === 'string' &&
          icon.sizes.split(/\s+/).includes(size)
      );
    });

    results.push(
      missingMaskableSizes.length === 0
        ? result('pass', 'Manifest includes maskable icons for each icon size', 'manifest.icons.maskable')
        : result(
            'warn',
            `Manifest is missing maskable icons for these sizes: ${missingMaskableSizes.join(', ')}`,
            'manifest.icons.maskable'
          )
    );

    await checkAssetReachabilityBatch(
      results,
      'Manifest icon',
      'manifest.icons.reachable',
      manifest.icons.map(icon => icon?.src),
      manifestUrl,
      fetchOptions
    );
  } else {
    results.push(result('warn', 'Manifest does not define icons', 'manifest.icons.missing'));
  }

  results.push(
    hasManifestInstallabilityCriteria(manifest)
      ? result('pass', 'PWA meets installability criteria', 'manifest.installability')
      : result('warn', 'PWA does not meet installability criteria', 'manifest.installability')
  );

  if (Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0) {
    results.push(result('pass', 'Manifest defines shortcuts', 'manifest.shortcuts'));

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
        ? result('pass', 'Manifest shortcuts include name and url', 'manifest.shortcuts.members')
        : result('warn', 'Manifest shortcuts do not consistently include name and url', 'manifest.shortcuts.members')
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
        ? result('pass', 'Manifest shortcuts optionally include short_name and description', 'manifest.shortcuts.optional-members')
        : result('warn', 'Manifest shortcuts include invalid short_name or description values', 'manifest.shortcuts.optional-members')
    );

    const shortcutsWithIcons = manifest.shortcuts.filter(shortcut => Array.isArray(shortcut?.icons));
    if (shortcutsWithIcons.length > 0) {
      const hasValidShortcutIcons = shortcutsWithIcons.every(shortcut =>
        hasValidShortcutIconSizes(shortcut.icons)
      );

      results.push(
        hasValidShortcutIcons
        ? result('pass', 'Manifest shortcut icons include src and sizes', 'manifest.shortcuts.icons')
        : result('warn', 'Manifest shortcut icons do not consistently include src and sizes', 'manifest.shortcuts.icons')
      );

      for (const shortcut of shortcutsWithIcons) {
        await checkAssetReachabilityBatch(
          results,
          'Manifest shortcut icon',
          'manifest.shortcuts.icons.reachable',
          shortcut.icons.map(icon => icon?.src),
          manifestUrl,
          fetchOptions
        );
      }
    }
  } else {
    results.push(result('warn', 'Manifest does not define shortcuts', 'manifest.shortcuts.missing'));
  }

  if (manifest.share_target && typeof manifest.share_target === 'object') {
    results.push(result('pass', 'Manifest defines share_target', 'manifest.share-target'));

    const shareTarget = manifest.share_target;
    const isRelativeAction =
      typeof shareTarget.action === 'string' &&
      shareTarget.action.length > 0 &&
      !/^https?:\/\//i.test(shareTarget.action);

    results.push(
      isRelativeAction
        ? result('pass', 'Manifest share_target action is a relative URL', 'manifest.share-target.action')
        : result('warn', 'Manifest share_target action is missing or is not a relative URL', 'manifest.share-target.action')
    );

    const hasValidMethod =
      typeof shareTarget.method === 'string' &&
      ['GET', 'POST'].includes(shareTarget.method.toUpperCase());

    results.push(
      hasValidMethod
        ? result('pass', `Manifest share_target method is valid: ${shareTarget.method.toUpperCase()}`, 'manifest.share-target.method')
        : result('warn', 'Manifest share_target method must be GET or POST', 'manifest.share-target.method')
    );

    if (String(shareTarget.method).toUpperCase() === 'POST') {
      results.push(
        shareTarget.enctype === 'multipart/form-data'
          ? result('pass', 'Manifest share_target enctype is multipart/form-data', 'manifest.share-target.enctype')
          : result('warn', 'Manifest share_target enctype must be multipart/form-data when method is POST', 'manifest.share-target.enctype')
      );
    }

    if (shareTarget.params && typeof shareTarget.params === 'object') {
      const allowedParamKeys = ['title', 'text', 'url', 'files'];
      const invalidParamKeys = Object.keys(shareTarget.params).filter(
        key => !allowedParamKeys.includes(key)
      );

      results.push(
        invalidParamKeys.length === 0
          ? result('pass', 'Manifest share_target params contain supported members', 'manifest.share-target.params')
          : result('warn', `Manifest share_target params contain unsupported members: ${invalidParamKeys.join(', ')}`, 'manifest.share-target.params')
      );

      if (Array.isArray(shareTarget.params.files) && shareTarget.params.files.length > 0) {
        const hasValidFiles = hasValidShareTargetFiles(shareTarget.params.files);

        results.push(
          hasValidFiles
            ? result('pass', 'Manifest share_target files include name and accept', 'manifest.share-target.files')
            : result('warn', 'Manifest share_target files do not consistently include valid name and accept values', 'manifest.share-target.files')
        );
      }
    } else {
      results.push(result('warn', 'Manifest share_target does not define params', 'manifest.share-target.params-missing'));
    }
  } else {
    results.push(result('warn', 'Manifest does not define share_target', 'manifest.share-target.missing'));
  }

  if (Array.isArray(manifest.file_handlers) && manifest.file_handlers.length > 0) {
    results.push(result('pass', 'Manifest defines file_handlers', 'manifest.file-handlers'));

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
        ? result('pass', 'Manifest file_handlers include a relative action and valid accept mappings', 'manifest.file-handlers')
        : result('warn', 'Manifest file_handlers do not consistently include a relative action and valid accept mappings', 'manifest.file-handlers')
    );
  } else {
    results.push(result('warn', 'Manifest does not define file_handlers', 'manifest.file-handlers.missing'));
  }

  if (typeof manifest.handle_links === 'string' && manifest.handle_links.length > 0) {
    results.push(
      ['preferred', 'not-preferred', 'auto'].includes(manifest.handle_links)
        ? result('pass', `Manifest handle_links is valid: ${manifest.handle_links}`, 'manifest.handle-links')
        : result('warn', 'Manifest handle_links must be preferred, not-preferred, or auto', 'manifest.handle-links')
    );
  } else {
    results.push(result('warn', 'Manifest does not define handle_links', 'manifest.handle-links.missing'));
  }

  return results;
};

export const checkManifest = async (html, pageUrl, fetchOptions = {}) => {
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
            'Web App Manifest is only discoverable in inline JavaScript; link it in the HTML head for better install detection',
            'manifest.discovery.javascript-inline'
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
        const scriptSource = await fetchText(scriptUrl, fetchOptions);
        const scriptManifestUrl = findManifestUrlInScript(scriptSource, scriptUrl);

        if (scriptManifestUrl) {
          manifestUrl = scriptManifestUrl;
          results.push(
            result(
              'warn',
              'Web App Manifest is only discoverable in JavaScript; link it in the HTML head for better install detection',
              'manifest.discovery.javascript'
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
          'Web App Manifest appears to be injected by JavaScript, but could not be resolved statically. This may prevent the app from being installed on some devices',
          'manifest.discovery.dynamic-unresolved'
        )
      );
      return results;
    }

    results.push(result('fail', 'No Web App Manifest found in HTML or scripts', 'manifest.discovery.missing'));
    return results;
  }

  if (manifestUrl) {
    results.push(result('pass', `Manifest found: ${manifestUrl}`, 'manifest.discovery.found'));
  }

  try {
    const manifest = await loadManifest(manifestUrl, fetchOptions);
    results.push(result('pass', 'Manifest is valid JSON', 'manifest.json.valid'));
    results.push(...await checkManifestMembers(manifest, manifestUrl, fetchOptions));
  } catch (error) {
    results.push(result('fail', `Could not read manifest: ${error.message}`, 'manifest.json.valid'));
  }

  return results;
};
