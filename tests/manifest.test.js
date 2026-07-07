import assert from 'node:assert/strict';
import test from 'node:test';

import { checkManifestMembers, findManifestUrl, loadManifest } from '../src/checks/manifest.js';

const getMessage = (results, status) =>
  results.find(entry => entry.status === status)?.message;

const hasResult = (results, status, message) =>
  results.some(entry => entry.status === status && entry.message === message);

const createValidManifest = () => ({
  scope: '/',
  display: 'standalone',
  start_url: '/',
  theme_color: '#42b5f4',
  background_color: 'purple',
  description: 'Example app',
  short_name: 'Example',
  orientation: 'any',
  screenshots: [
    {
      src: '/screenshots/home-wide.png',
      sizes: '1280x720',
      type: 'image/png',
      form_factor: 'wide'
    },
    {
      src: '/screenshots/home-narrow.png',
      sizes: '720x1280',
      type: 'image/jpeg',
      form_factor: 'narrow'
    }
  ],
  icons: [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable'
    },
    {
      src: '/icons/icon-384.png',
      sizes: '384x384',
      type: 'image/png',
      purpose: 'maskable'
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    },
    {
      src: '/icons/icon-1024.png',
      sizes: '1024x1024',
      type: 'image/png',
      purpose: 'maskable'
    }
  ],
  shortcuts: [
    {
      name: 'Open',
      url: '/open',
      icons: [{ src: '/icons/open.png', sizes: '96x96' }]
    }
  ],
  share_target: {
    action: '/share',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [{ name: 'files', accept: ['image/png', '.png'] }]
    }
  },
  file_handlers: [
    {
      action: '/open-file',
      accept: {
        'image/png': '.png',
        'image/*': ['.jpg', '.jpeg']
      }
    }
  ],
  handle_links: 'preferred'
});

test('findManifestUrl resolves manifest href from html', () => {
  const html = '<html><head><link rel="manifest" href="/manifest.json"></head></html>';

  assert.equal(
    findManifestUrl(html, 'https://example.com/app/'),
    'https://example.com/manifest.json'
  );
});

test('loadManifest parses fetched manifest json', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    new Response(JSON.stringify({ name: 'Test App' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

  try {
    assert.deepEqual(await loadManifest('https://example.com/manifest.json'), {
      name: 'Test App'
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('checkManifestMembers accepts a valid manifest', async () => {
  const results = await checkManifestMembers(createValidManifest());

  assert.equal(getMessage(results, 'warn'), undefined);
  assert.equal(getMessage(results, 'fail'), undefined);
  assert.ok(hasResult(results, 'pass', 'Manifest has scope member'));
  assert.ok(hasResult(results, 'pass', 'Manifest display is valid: standalone'));
  assert.ok(hasResult(results, 'pass', 'Manifest has start_url member: /'));
  assert.ok(hasResult(results, 'pass', 'Manifest has description member'));
  assert.ok(hasResult(results, 'pass', 'Manifest has theme_color member: #42b5f4'));
  assert.ok(hasResult(results, 'pass', 'Manifest theme_color is a valid color: #42b5f4'));
  assert.ok(hasResult(results, 'pass', 'Manifest has background_color member: purple'));
  assert.ok(hasResult(results, 'pass', 'Manifest background_color is a valid color: purple'));
  assert.ok(hasResult(results, 'pass', 'Manifest short_name length is acceptable (7 characters)'));
  assert.ok(hasResult(results, 'pass', 'Manifest has orientation member: any'));
  assert.ok(hasResult(results, 'pass', 'Manifest defines screenshots'));
  assert.ok(hasResult(results, 'pass', 'Manifest defines icons'));
  assert.ok(hasResult(results, 'pass', 'Manifest includes maskable icons for each icon size'));
  assert.ok(hasResult(results, 'pass', 'PWA meets installability criteria'));
  assert.ok(hasResult(results, 'pass', 'Manifest defines shortcuts'));
  assert.ok(hasResult(results, 'pass', 'Manifest defines share_target'));
  assert.ok(hasResult(results, 'pass', 'Manifest defines file_handlers'));
  assert.ok(hasResult(results, 'pass', 'Manifest handle_links is valid: preferred'));
});

test('scope member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.scope;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not have scope member'));
});

test('display member must be one of the allowed values', async () => {
  const manifest = createValidManifest();
  manifest.display = 'windowed';

  const results = await checkManifestMembers(manifest);

  assert.ok(
    hasResult(
      results,
      'warn',
      'Manifest display must be standalone, fullscreen, minimal-ui, or browser; standalone is recommended'
    )
  );
});

test('start_url member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.start_url;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not have start_url member'));
});

test('description member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.description;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not have description member'));
});

test('theme_color member is required and must be a valid color', async () => {
  const manifest = createValidManifest();
  delete manifest.theme_color;

  let results = await checkManifestMembers(manifest);
  assert.ok(hasResult(results, 'warn', 'Manifest does not have theme_color member'));

  manifest.theme_color = 'not-a-color';
  results = await checkManifestMembers(manifest);
  assert.ok(hasResult(results, 'warn', 'Manifest theme_color must be a valid color'));
});

test('background_color member is required and must be a valid color', async () => {
  const manifest = createValidManifest();
  delete manifest.background_color;

  let results = await checkManifestMembers(manifest);
  assert.ok(hasResult(results, 'warn', 'Manifest does not have background_color member'));

  manifest.background_color = 'not-a-color';
  results = await checkManifestMembers(manifest);
  assert.ok(hasResult(results, 'warn', 'Manifest background_color must be a valid color'));
});

test('short_name member should not exceed 15 characters', async () => {
  const manifest = createValidManifest();
  manifest.short_name = 'abcdefghijklmnop';

  const results = await checkManifestMembers(manifest);

  assert.ok(
    hasResult(
      results,
      'warn',
      'Manifest short_name is too long (16 characters); recommended maximum is 15'
    )
  );
});

test('installability criteria require an allowed display mode', async () => {
  const manifest = createValidManifest();
  manifest.display = 'browserish';

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'PWA does not meet installability criteria'));
});

test('installability criteria require 192px and 512px icons', async () => {
  const manifest = createValidManifest();
  manifest.icons = [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png'
    }
  ];

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'PWA does not meet installability criteria'));
});

test('icons should include maskable purpose for each icon size', async () => {
  const manifest = createValidManifest();
  manifest.icons[0].purpose = undefined;

  const results = await checkManifestMembers(manifest);

  assert.ok(
    hasResult(results, 'warn', 'Manifest is missing maskable icons for these sizes: 192x192')
  );
});

test('icons should require maskable purpose for canonical icon sizes only', async () => {
  const manifest = createValidManifest();
  manifest.icons.push({
    src: '/icons/icon-128.png',
    sizes: '128x128',
    type: 'image/png'
  });

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'pass', 'Manifest includes maskable icons for each icon size'));
});

test('installability criteria allow prefer_related_applications only when false or absent', async () => {
  const manifest = createValidManifest();
  manifest.prefer_related_applications = true;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'PWA does not meet installability criteria'));
});

test('orientation member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.orientation;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not have orientation member'));
});

test('screenshots member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.screenshots;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not define screenshots'));
});

test('icons member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.icons;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not define icons'));
});

test('shortcuts member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.shortcuts;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not define shortcuts'));
});

test('share_target member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.share_target;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not define share_target'));
});

test('file_handlers member is required', async () => {
  const manifest = createValidManifest();
  delete manifest.file_handlers;

  const results = await checkManifestMembers(manifest);

  assert.ok(hasResult(results, 'warn', 'Manifest does not define file_handlers'));
});

test('handle_links member must use a supported value', async () => {
  const manifest = createValidManifest();
  manifest.handle_links = 'maybe';

  const results = await checkManifestMembers(manifest);

  assert.ok(
    hasResult(results, 'warn', 'Manifest handle_links must be preferred, not-preferred, or auto')
  );
});
