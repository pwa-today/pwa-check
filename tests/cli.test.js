import assert from 'node:assert/strict';
import {
  mkdtemp
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseArgs,
  runCli
} from '../src/cli.js';

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
};

test('keeps a URL-only invocation as a free check', () => {
  const options = parseArgs([
    '--json',
    'https://example.com'
  ]);

  assert.equal(options.command, 'check');
  assert.equal(options.url, 'https://example.com');
  assert.equal(options.json, true);
});

test('parses the explicit audit command', () => {
  const options = parseArgs([
    'audit',
    '--profile',
    'custom',
    '--include',
    'manifest,offline',
    'https://example.com'
  ]);

  assert.equal(options.command, 'audit');
  assert.equal(options.profile, 'custom');
  assert.deepEqual(options.include, [
    'manifest',
    'offline'
  ]);
});

test('requires the audit token', async () => {
  let stderr = '';
  const exitCode = await runCli([
    'audit',
    'https://example.com'
  ], {
    environment: {},
    stderr: (value) => {
      stderr += value;
    }
  });

  assert.equal(exitCode, 2);
  assert.match(stderr, /PWA_AUDIT_TOKEN/);
});

test('returns the quality-gate exit code for a completed audit', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-cli-')
  );
  const responses = [
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      url: 'https://example.com/',
      status: 'completed',
      score: 75,
      qualityGate: {
        passed: false
      }
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      results: []
    })
  ];
  let stdout = '';
  const exitCode = await runCli([
    'audit',
    '--json',
    'https://example.com'
  ], {
    environment: {
      PWA_AUDIT_TOKEN: 'token-value'
    },
    cwd: directory,
    fetchFunction: async () => responses.shift(),
    stdout: (value) => {
      stdout += value;
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(JSON.parse(stdout).audit.auditId, 'audit-123');
});
