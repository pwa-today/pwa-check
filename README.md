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
You can also make warnings fail the run, ignore specific warning codes, emit JSON, or set a timeout for each request.

## Usage

Run the free checks against a URL when you want a straight answer instead of
guessing:

```bash
node bin/pwa-check.js https://example.com
```

The explicit free-check command produces the same result:

```bash
pwa-check check https://example.com
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
- `--ignore-warn <code>`: exclude a warning code from `--fail-on-warn`
- `--timeout <ms>`: cap each network request
- `--insecure-localhost`: allow HTTPS requests to localhost with an invalid certificate

In terminal output, warnings and failures include their code, priority, impact, suggested
fix, and documentation URL. Passing checks remain on one line.

### Warning Codes
Every result includes a stable code. Warning and failure codes also include `priority`,
`impact`, `fix`, and `documentation` fields in JSON output.

Use the code shown in JSON output with `--ignore-warn <code>` to exclude one warning
from `--fail-on-warn`.

## Paid runtime audits

Paying customers can run the hosted runtime checks with the explicit `audit`
command. A token never enables paid checks by itself.

Set the access token in the environment:

```bash
export PWA_AUDIT_TOKEN="..."
```

Then start an audit:

```bash
pwa-check audit https://example.com
```

The CLI creates one aggregate audit, waits for the background checks to
complete, prints the results, applies the quality gate, and returns:

- `0` when the audit and quality gate pass
- `1` when the quality gate fails
- `2` for authentication or configuration errors
- `3` for audit service errors or timeouts

Runtime audit flags:

- `--profile <quick|standard|full|custom>`
- `--include <check-id>`: include one or more comma-separated check IDs
- `--exclude <check-id>`: exclude one or more comma-separated check IDs
- `--project <project-id>`
- `--minimum-score <0-100>`
- `--fail-on <critical|high|medium|low>`
- `--config <file>`
- `--poll-interval <ms>`
- `--audit-timeout <ms>`
- `--api-url <url>`: override the default `https://api.pwa.today`
- `--idempotency-key <key>`
- `--json`

The token can only be supplied through `PWA_AUDIT_TOKEN`. The API URL and
idempotency key can also be set with `PWA_TODAY_API_URL` and
`PWA_TODAY_IDEMPOTENCY_KEY`.

### Audit configuration

The CLI automatically loads `pwa-check.yml`, `pwa-check.yaml`, or
`pwa-check.json` from the current directory. You can select another file with
`--config`.

```yaml
version: 1

audit:
  profile: standard
  exclude:
    - push-notifications
    - persistent-storage

qualityGate:
  minimumScore: 90
  failOn:
    - critical
    - high

reports:
  junit: reports/pwa-audit.xml
  json: reports/pwa-audit.json
```

Checks with additional inputs use the stable check ID under `audit.options`:

```yaml
audit:
  profile: full
  options:
    offline-navigation:
      series:
        - [/, /installation, /offline-support]
        - [/, /audit, /email-list]
      expectedSelectors:
        - main
        - h1
      requiredText:
        - Example

    push-notifications:
      payload:
        title: Runtime audit
        message: Test notification
    offline-request-retry:
      requestUrl: /api/messages
      method: POST
      requestBody:
        message: Test request
```

Stable runtime check IDs:

- `manifest`
- `offline`
- `offline-navigation`
- `service-worker-first-installation`
- `service-worker-handlers`
- `service-worker-update`
- `before-install-prompt`
- `persistent-storage`
- `offline-request-retry`
- `push-notifications`

`offline-request-retry` and `push-notifications` require check-specific options.
If their prerequisites are missing, the result is `not-applicable`.

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
