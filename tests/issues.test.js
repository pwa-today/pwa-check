import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { issues } from '../src/issues.js';

const sourceFiles = [
  '../src/checker.js',
  '../src/checks/ios-splash-screens.js',
  '../src/checks/manifest.js',
  '../src/checks/service-worker.js',
  '../src/checks/viewport.js'
];

test('every check code has exactly one issue catalog entry', async () => {
  const sources = await Promise.all(
    sourceFiles.map(sourceFile => readFile(new URL(sourceFile, import.meta.url), 'utf8'))
  );
  const usedCodes = [
    ...new Set(
      sources.flatMap(source =>
        [...source.matchAll(
          /'((?:site|viewport|ios|manifest|service-worker)\.[a-z0-9.-]+)'/g
        )].map(match => match[1])
      )
    )
  ].sort();
  const catalogCodes = Object.keys(issues).sort();

  assert.deepEqual(catalogCodes, usedCodes);
});

test('every actionable issue has complete remediation metadata', () => {
  Object.entries(issues)
    .filter(([, metadata]) => Object.keys(metadata).length > 0)
    .forEach(([code, metadata]) => {
      assert.ok(['low', 'medium', 'high'].includes(metadata.priority), code);
      assert.ok(
        typeof metadata.impact === 'string' || typeof metadata.impact === 'function',
        code
      );
      assert.ok(
        typeof metadata.fix === 'string' || typeof metadata.fix === 'function',
        code
      );
      assert.match(metadata.documentation, /^https:\/\//, code);
    });
});
