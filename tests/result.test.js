import assert from 'node:assert/strict';
import test from 'node:test';

import { result } from '../src/utils/result.js';

test('result enriches a known warning with issue details', () => {
  assert.deepEqual(
    result(
      'warn',
      'Manifest is missing recommended icon sizes: 384x384, 1024x1024',
      'manifest.icons.recommended-sizes',
      { missingSizes: ['384x384', '1024x1024'] }
    ),
    {
      status: 'warn',
      message: 'Manifest is missing recommended icon sizes: 384x384, 1024x1024',
      code: 'manifest.icons.recommended-sizes',
      priority: 'high',
      impact: 'Some devices may use a blurry or unsuitable installation icon.',
      fix: 'Add 384×384 and 1024×1024 PNG icons to the manifest "icons" array.',
      documentation: 'https://web.dev/articles/add-manifest#icons'
    }
  );
});

test('result requires a known issue code', () => {
  assert.throws(
    () => result('warn', 'Missing code'),
    /Result code is required for: Missing code/
  );
  assert.throws(
    () => result('warn', 'Unknown warning', 'unknown.warning'),
    /Unknown result code: unknown.warning/
  );
});

test('result does not add remediation details to passing results', () => {
  assert.deepEqual(
    result(
      'pass',
      'Manifest includes recommended icons',
      'manifest.icons.recommended-sizes'
    ),
    {
      status: 'pass',
      message: 'Manifest includes recommended icons',
      code: 'manifest.icons.recommended-sizes'
    }
  );
});
