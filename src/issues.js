const documentation = {
  ios: 'https://developer.apple.com/design/human-interface-guidelines/launching',
  manifest: 'https://w3c.github.io/manifest/',
  manifestIcons: 'https://web.dev/articles/add-manifest#icons',
  notifications:
    'https://notifications.spec.whatwg.org/#dom-serviceworkerregistration-shownotification',
  serviceWorker: 'https://w3c.github.io/ServiceWorker/',
  site: 'https://fetch.spec.whatwg.org/',
  viewport: 'https://html.spec.whatwg.org/multipage/semantics.html#meta-viewport'
};

const issue = ({ priority, impact, fix, documentation: documentationUrl }) => ({
  priority,
  impact,
  fix,
  documentation: documentationUrl
});

const manifestIssue = ({ impact, fix, priority = 'medium' }) =>
  issue({ priority, impact, fix, documentation: documentation.manifest });

const serviceWorkerIssue = ({ impact, fix, priority = 'medium' }) =>
  issue({ priority, impact, fix, documentation: documentation.serviceWorker });

const informational = Object.freeze({});

const formatIconSizes = sizes =>
  new Intl.ListFormat('en').format(sizes.map(size => size.replace('x', '×')));

export const issues = {
  'site.reachable': issue({
    priority: 'high',
    impact: 'The checker cannot inspect a site that it cannot retrieve.',
    fix: 'Verify the URL, DNS, TLS certificate, server availability, and access controls.',
    documentation: documentation.site
  }),
  'viewport.meta.missing': issue({
    priority: 'high',
    impact: 'The page may render at a desktop width or without safe-area support on mobile devices.',
    fix: 'Add a viewport meta tag with width=device-width, initial-scale=1, and viewport-fit=cover.',
    documentation: documentation.viewport
  }),
  'viewport.recommended-tokens': issue({
    priority: 'medium',
    impact: 'The page may scale or fit incorrectly on mobile and edge-to-edge displays.',
    fix: 'Include width=device-width, initial-scale=1, and viewport-fit=cover in the viewport meta tag.',
    documentation: documentation.viewport
  }),
  'ios.startup-images': informational,
  'ios.startup-images.missing': issue({
    priority: 'low',
    impact: 'Installed iOS apps may show a blank or generic launch screen.',
    fix: 'Add apple-touch-startup-image links for the iOS devices you support.',
    documentation: documentation.ios
  }),
  'ios.startup-images.mobile-web-app-capable': issue({
    priority: 'low',
    impact: 'iOS startup images may not be shown when the installed app launches.',
    fix: 'Add <meta name="apple-mobile-web-app-capable" content="yes"> until iOS 26.4 is your minimum supported version.',
    documentation: documentation.ios
  }),
  'ios.startup-images.portrait': issue({
    priority: 'low',
    impact: 'The launch experience may be unsuitable when the device is in portrait orientation.',
    fix: 'Add an apple-touch-startup-image link with a portrait media query.',
    documentation: documentation.ios
  }),
  'ios.startup-images.landscape': issue({
    priority: 'low',
    impact: 'The launch experience may be unsuitable when the device is in landscape orientation.',
    fix: 'Add an apple-touch-startup-image link with a landscape media query.',
    documentation: documentation.ios
  }),
  'manifest.scope': manifestIssue({
    impact: 'Navigation boundaries may be inferred differently than intended.',
    fix: 'Add an explicit scope member that contains the app routes.'
  }),
  'manifest.display': manifestIssue({
    impact: 'The installed app may open with unintended browser UI.',
    fix: 'Set display to "standalone", "fullscreen", "minimal-ui", or "browser"; standalone is usually preferred.',
    priority: 'high'
  }),
  'manifest.start-url': manifestIssue({
    impact: 'The browser may not know which page to open when the installed app launches.',
    fix: 'Add a valid start_url within the manifest scope.',
    priority: 'high'
  }),
  'manifest.description': manifestIssue({
    impact: 'Installation surfaces may lack useful information about the app.',
    fix: 'Add a concise description member to the manifest.',
    priority: 'low'
  }),
  'manifest.short-name': manifestIssue({
    impact: 'The app name may be missing or truncated on compact installation surfaces.',
    fix: 'Add a short_name of 15 characters or fewer.'
  }),
  'manifest.orientation': manifestIssue({
    impact: 'The installed app may open in an unintended orientation.',
    fix: 'Add an orientation member that matches the app experience.',
    priority: 'low'
  }),
  'manifest.theme-color': manifestIssue({
    impact: 'Browser and operating-system UI may not use the intended app color.',
    fix: 'Add a valid CSS color in theme_color.'
  }),
  'manifest.theme-color.valid': manifestIssue({
    impact: 'Browsers may ignore the theme color.',
    fix: 'Replace theme_color with a valid CSS color.'
  }),
  'manifest.background-color': manifestIssue({
    impact: 'The launch transition may use an unintended background color.',
    fix: 'Add a valid CSS color in background_color.'
  }),
  'manifest.background-color.valid': manifestIssue({
    impact: 'Browsers may ignore the launch background color.',
    fix: 'Replace background_color with a valid CSS color.'
  }),
  'manifest.screenshots': informational,
  'manifest.screenshots.missing': manifestIssue({
    impact: 'Installation dialogs may not be able to show a rich preview of the app.',
    fix: 'Add representative wide and narrow screenshots to the manifest.',
    priority: 'low'
  }),
  'manifest.screenshots.members': manifestIssue({
    impact: 'Invalid screenshots may be omitted from installation dialogs.',
    fix: 'Give every screenshot valid "src", "sizes", "type", and "form_factor" members.'
  }),
  'manifest.screenshots.types': manifestIssue({
    impact: 'Unsupported screenshot files may not appear in installation dialogs.',
    fix: 'Use PNG or JPEG images and declare the matching MIME type.'
  }),
  'manifest.screenshots.sizes': manifestIssue({
    impact: 'Screenshots outside supported dimensions may be ignored.',
    fix: 'Use screenshot dimensions between 320px and 3840px.'
  }),
  'manifest.screenshots.wide': manifestIssue({
    impact: 'Desktop installation dialogs may lack a suitable app preview.',
    fix: 'Add at least one screenshot with "form_factor" set to "wide".',
    priority: 'low'
  }),
  'manifest.screenshots.narrow': manifestIssue({
    impact: 'Mobile installation dialogs may lack a suitable app preview.',
    fix: 'Add at least one screenshot with "form_factor" set to "narrow".',
    priority: 'low'
  }),
  'manifest.screenshots.aspect-ratio': manifestIssue({
    impact: 'Installation surfaces may reject screenshots with inconsistent shapes.',
    fix: 'Keep screenshot aspect ratios within the supported 2.3 ratio limit.'
  }),
  'manifest.screenshots.count': manifestIssue({
    impact: 'Some screenshots may be ignored by installation surfaces.',
    fix: 'Limit the manifest to no more than eight screenshots.',
    priority: 'low'
  }),
  'manifest.screenshots.narrow-count': manifestIssue({
    impact: 'Some narrow screenshots may be ignored on mobile installation surfaces.',
    fix: 'Limit the manifest to no more than five narrow screenshots.',
    priority: 'low'
  }),
  'manifest.screenshots.reachable': manifestIssue({
    impact: 'An unreachable screenshot cannot be displayed during installation.',
    fix: 'Correct the screenshot URL and ensure it returns a successful image response.'
  }),
  'manifest.icons': informational,
  'manifest.icons.missing': manifestIssue({
    impact: 'The installed app may use a generic or generated icon.',
    fix: 'Add suitable PNG icons to the manifest icons array.',
    priority: 'high'
  }),
  'manifest.icons.members': manifestIssue({
    impact: 'Browsers may ignore incomplete icon declarations.',
    fix: 'Give manifest icons valid "src", "type", and "sizes" members.',
    priority: 'high'
  }),
  'manifest.icons.512': manifestIssue({
    impact: 'The app may not meet installation criteria or may use a poorly scaled icon.',
    fix: 'Add a PNG icon with at least 144px width and height to the manifest "icons" array.',
    priority: 'high'
  }),
  'manifest.icons.recommended-sizes': {
    ...manifestIssue({
      impact: 'Some devices may use a blurry or unsuitable installation icon.',
      fix: 'Add the recommended PNG icon sizes to the manifest "icons" array.',
      priority: 'high'
    }),
    fix: ({ missingSizes = [] }) =>
      missingSizes.length > 0
        ? `Add ${formatIconSizes(missingSizes)} PNG icons to the manifest "icons" array.`
        : 'Add the recommended PNG icon sizes to the manifest "icons" array.',
    documentation: documentation.manifestIcons
  },
  'manifest.icons.maskable': manifestIssue({
    impact: 'The app icon may be cropped or padded on platforms that apply icon masks.',
    fix: 'Provide maskable icons for the canonical icon sizes.'
  }),
  'manifest.icons.reachable': manifestIssue({
    impact: 'An unreachable icon cannot be used for installation or launch surfaces.',
    fix: 'Correct the icon URL and ensure it returns a successful image response.',
    priority: 'high'
  }),
  'manifest.installability': manifestIssue({
    impact: 'The app may not be offered for installation.',
    fix: 'Provide a name, supported display mode, start_url, suitable icon, and compatible related-app preference.',
    priority: 'high'
  }),
  'manifest.shortcuts': informational,
  'manifest.shortcuts.missing': manifestIssue({
    impact: 'Users will not get quick actions from the installed app icon.',
    fix: 'Add useful shortcuts to the manifest if the app has common entry points.',
    priority: 'low'
  }),
  'manifest.shortcuts.members': manifestIssue({
    impact: 'Invalid shortcuts may be ignored.',
    fix: 'Give every shortcut a non-empty "name" and "url".'
  }),
  'manifest.shortcuts.optional-members': manifestIssue({
    impact: 'Invalid optional shortcut labels or descriptions may be ignored.',
    fix: 'Use strings for shortcut "short_name" and "description" values.'
  }),
  'manifest.shortcuts.icons': manifestIssue({
    impact: 'Shortcut icons may be ignored.',
    fix: 'Give every shortcut icon valid "src" and "sizes" members.'
  }),
  'manifest.shortcuts.icons.reachable': manifestIssue({
    impact: 'An unreachable shortcut icon cannot be displayed.',
    fix: 'Correct the shortcut icon URL and ensure it returns a successful image response.'
  }),
  'manifest.share-target': informational,
  'manifest.share-target.missing': manifestIssue({
    impact: 'The installed app cannot receive content from the system share UI.',
    fix: 'Add a share_target member if receiving shared content is part of the app.',
    priority: 'low'
  }),
  'manifest.share-target.action': manifestIssue({
    impact: 'Shared content may be sent to an invalid or unsafe endpoint.',
    fix: 'Set share_target.action to a relative URL handled by the app.',
    priority: 'high'
  }),
  'manifest.share-target.method': manifestIssue({
    impact: 'The share target request cannot be dispatched with an unsupported method.',
    fix: 'Set share_target.method to "GET" or "POST".'
  }),
  'manifest.share-target.enctype': manifestIssue({
    impact: 'POST share payloads, especially files, may not be decoded correctly.',
    fix: 'Set share_target.enctype to "multipart/form-data" for POST requests.'
  }),
  'manifest.share-target.params': manifestIssue({
    impact: 'Unsupported share parameters may be discarded.',
    fix: 'Use only "title", "text", "url", and "files" in share_target.params.'
  }),
  'manifest.share-target.params-missing': manifestIssue({
    impact: 'The app has no mapping for incoming shared content.',
    fix: 'Add supported members to share_target.params.',
    priority: 'high'
  }),
  'manifest.share-target.files': manifestIssue({
    impact: 'Shared files may not be delivered to the app.',
    fix: 'Give each share file entry a "name" and valid "accept" value.'
  }),
  'manifest.file-handlers': manifestIssue({
    impact: 'The installed app may not be registered to open the intended files.',
    fix: 'Give each file handler a relative action and valid MIME-to-extension accept mappings.'
  }),
  'manifest.file-handlers.missing': manifestIssue({
    impact: 'The installed app cannot advertise support for opening files.',
    fix: 'Add file_handlers if opening files is part of the app.',
    priority: 'low'
  }),
  'manifest.handle-links': manifestIssue({
    impact: 'Navigation into the app may not follow the intended installed-app preference.',
    fix: 'Set handle_links to "preferred", "not-preferred", or "auto".',
    priority: 'low'
  }),
  'manifest.handle-links.missing': manifestIssue({
    impact: 'The app leaves link-handling behavior to platform defaults.',
    fix: 'Add handle_links if the app needs an explicit link-handling preference.',
    priority: 'low'
  }),
  'manifest.discovery.javascript-inline': manifestIssue({
    impact: 'Some installers and crawlers may not discover a manifest created at runtime.',
    fix: 'Add a manifest link directly to the HTML head.',
    priority: 'high'
  }),
  'manifest.discovery.javascript': manifestIssue({
    impact: 'Some installers and crawlers may not discover a manifest created by JavaScript.',
    fix: 'Add a manifest link directly to the HTML head.',
    priority: 'high'
  }),
  'manifest.discovery.dynamic-unresolved': manifestIssue({
    impact: 'The checker and some installation clients cannot resolve the runtime manifest URL.',
    fix: 'Add a static manifest link directly to the HTML head.',
    priority: 'high'
  }),
  'manifest.discovery.missing': manifestIssue({
    impact: 'The app cannot expose installation metadata without a discoverable manifest.',
    fix: 'Add a link rel="manifest" element to the HTML head.',
    priority: 'high'
  }),
  'manifest.discovery.found': informational,
  'manifest.json.valid': manifestIssue({
    impact: 'An unreadable or invalid manifest prevents browsers from using its installation metadata.',
    fix: 'Ensure the manifest URL is reachable and returns valid JSON.',
    priority: 'high'
  }),
  'service-worker.registration.dynamic-unresolved': serviceWorkerIssue({
    impact: 'The checker cannot inspect the registered worker and static tooling may miss it.',
    fix: 'Register the service worker with a statically discoverable script URL.'
  }),
  'service-worker.registration.missing': serviceWorkerIssue({
    impact: 'Offline behavior, background events, and other service-worker features are unavailable.',
    fix: 'Register a service worker from the application.',
    priority: 'high'
  }),
  'service-worker.registration.found': informational,
  'service-worker.install': informational,
  'service-worker.install.missing': serviceWorkerIssue({
    impact: 'The worker cannot perform explicit installation work.',
    fix: 'Add an "install" event handler when the app needs installation-time setup.'
  }),
  'service-worker.install.wait-until': serviceWorkerIssue({
    impact: 'Asynchronous installation work may be terminated before it completes.',
    fix: 'Pass the installation promise to event.waitUntil(...).',
    priority: 'high'
  }),
  'service-worker.install.skip-waiting': serviceWorkerIssue({
    impact: 'A newly installed worker may replace the current worker while pages still rely on it.',
    fix: 'Remove unconditional skipWaiting or coordinate the update with open clients.',
    priority: 'high'
  }),
  'service-worker.activate': informational,
  'service-worker.activate.missing': serviceWorkerIssue({
    impact: 'The worker cannot perform explicit activation or cache cleanup work.',
    fix: 'Add an "activate" event handler when the app needs activation-time work.'
  }),
  'service-worker.activate.wait-until': serviceWorkerIssue({
    impact: 'Asynchronous activation work may be terminated before it completes.',
    fix: 'Pass the activation promise to event.waitUntil(...).',
    priority: 'high'
  }),
  'service-worker.activate.clients-claim': serviceWorkerIssue({
    impact: 'The new worker may take control of pages that were loaded under an older version.',
    fix: 'Remove unconditional clients.claim or coordinate takeover with open clients.',
    priority: 'high'
  }),
  'service-worker.fetch': informational,
  'service-worker.fetch.missing': serviceWorkerIssue({
    impact: 'The worker cannot provide custom offline or request-handling behavior.',
    fix: 'Add a "fetch" event handler or Workbox route for requests the app should handle.',
    priority: 'high'
  }),
  'service-worker.cache': informational,
  'service-worker.cache.missing': serviceWorkerIssue({
    impact: 'The app may not load useful resources while offline.',
    fix: 'Cache the app shell or other essential assets in the service worker.',
    priority: 'high'
  }),
  'service-worker.push': informational,
  'service-worker.push.missing': serviceWorkerIssue({
    impact: 'The app cannot process incoming Web Push messages.',
    fix: 'Add a "push" event handler if the app uses push notifications.'
  }),
  'service-worker.push.wait-until': serviceWorkerIssue({
    impact: 'Asynchronous push processing may be terminated before it completes.',
    fix: 'Pass the push-processing promise to event.waitUntil(...).',
    priority: 'high'
  }),
  'service-worker.push.show-notification': issue({
    priority: 'high',
    impact: 'Push messages may arrive without displaying a notification to the user.',
    fix: 'Call registration.showNotification(...) in the "push" event handler and pass its promise to event.waitUntil(...).',
    documentation: documentation.notifications
  }),
  'service-worker.notificationclick': informational,
  'service-worker.notificationclick.missing': issue({
    priority: 'medium',
    impact: 'Users may be unable to open or focus the app by clicking a notification.',
    fix: 'Add a "notificationclick" handler that handles the intended user action.',
    documentation: documentation.notifications
  })
};
