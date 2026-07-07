# pwa-check

Is your web app actually ready to be installed, work offline, and behave like a real PWA?

Let `pwa-check` check your app for you.

It scans the HTML, manifest, scripts, and service worker, then points straight at the gaps that will hurt installability or offline behavior.

## What it checks

### Web App Manifest

`pwa-check` finds a Web App Manifest in the HTML or in JavaScript that injects it dynamically, then checks the pieces that matter for installability:

- `scope`
- `display`
- `start_url`
- `description`
- `short_name`
- `orientation`
- `icons`
- `screenshots`
- `shortcuts`
- `share_target`
- `file_handlers`
- `handle_links`

It also checks whether referenced icons, screenshots, and shortcut icons are reachable, because broken assets make a PWA look unfinished.

### Viewport meta tag

It checks for the viewport configuration a polished PWA should have:

- `width=device-width`
- `initial-scale=1`
- `viewport-fit=cover`

If tokens are missing, the warning tells you exactly what is wrong.

### iOS startup images

It checks whether the app defines iOS splash screens using `apple-touch-startup-image` links, so the first launch does not feel half-built.

These can be present in the HTML or injected by JavaScript.

### Service worker

It checks whether the app registers a service worker and whether the worker does the work a PWA needs:

- `install` handler
- `activate` handler
- `fetch` handler
- `push` handler
- `notificationclick` handler
- caching behavior

It also supports Workbox-style service workers, including generated wrappers that load additional modules and precache assets.

## Output

The CLI prints a list of results with one of three statuses:

- `pass`
- `warn`
- `fail`

The process exits with a non-zero status if any `fail` result is found, so it fits cleanly into CI and local checks.
You can also make warnings fail the run, emit JSON, or set a timeout for each request.

## Usage

Run it against a URL when you want a straight answer instead of guessing:

```bash
node bin/pwa-check.js https://example.com
```

or install it as a CLI tool:

```bash
npm i @pwa-today/pwa-check
```
then run:

```bash
npx pwa-check https://example.com
```

If you install the package globally:

```bash
npm i -g @pwa-today/pwa-check
```
or link it:

```bash
npm link @pwa-today/pwa-check
```

you can run it directly:

```bash
pwa-check https://example.com
```

Flags:

- `--json`: emit machine-readable output
- `--fail-on-warn`: treat warnings as failures
- `--timeout <ms>`: cap each network request

## Testing

Run the test suite with:

```bash
npm test
```

## License

ISC. See [`LICENSE`](LICENSE).

## Notes

- The checker uses heuristics for dynamic behavior, such as manifests or service workers injected by JavaScript.
- A `warn` result means the app might still work, but it is leaving quality on the table.
- A `fail` result means the app is missing a required piece and should not be treated as install-ready.
