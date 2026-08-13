import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadAuditConfig
} from '../src/audit-config.js';

test('loads the default YAML audit configuration', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-config-')
  );

  await writeFile(
    path.join(directory, 'pwa-check.yml'),
    [
      'version: 1',
      'audit:',
      '  profile: quick',
      'qualityGate:',
      '  minimumScore: 95',
      ''
    ].join('\n')
  );

  const config = await loadAuditConfig({
    cwd: directory
  });

  assert.equal(config.audit.profile, 'quick');
  assert.equal(config.qualityGate.minimumScore, 95);
});

test('rejects unsupported configuration versions', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-config-')
  );
  const filename = path.join(directory, 'audit.yml');

  await writeFile(filename, 'version: 2\n');

  await assert.rejects(
    loadAuditConfig({
      filename
    }),
    /version must be 1/
  );
});
