import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile
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
    '--application',
    'example.com',
    'https://example.com'
  ]);

  assert.equal(options.command, 'audit');
  assert.equal(options.profile, 'custom');
  assert.equal(options.applicationId, 'example.com');
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

test('sends failOnWarnings from the audit configuration', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-cli-')
  );
  await writeFile(
    path.join(directory, 'pwa-check.yml'),
    [
      'version: 1',
      'qualityGate:',
      '  failOnWarnings: true',
      ''
    ].join('\n')
  );
  const requests = [];
  const responses = [
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      score: 100,
      qualityGate: {
        passed: true
      }
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      results: []
    })
  ];

  await runCli([
    'audit',
    '--json',
    'https://example.com'
  ], {
    environment: {
      PWA_AUDIT_TOKEN: 'token-value'
    },
    cwd: directory,
    fetchFunction: async (url, options) => {
      requests.push({
        url,
        options
      });
      return responses.shift();
    },
    stdout: () => {}
  });

  const auditRequest = requests.find(({ url }) => {
    return url.endsWith('/v1/audits');
  });
  const auditBody = JSON.parse(auditRequest.options.body);

  assert.equal(auditBody.qualityGate.failOnWarnings, true);
});

test('sends explicitly allowed browser origins from the audit configuration', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-cli-')
  );
  const requests = [];

  await writeFile(
    path.join(directory, 'pwa-check.yml'),
    [
      'version: 1',
      'audit:',
      '  allowedOrigins:',
      '    - https://cdn.example.com',
      ''
    ].join('\n')
  );

  await runCli([
    'audit',
    '--json',
    'https://example.com'
  ], {
    environment: {
      PWA_AUDIT_TOKEN: 'token-value'
    },
    cwd: directory,
    fetchFunction: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 202,
        json: async () => ({
          auditId: 'audit-123',
          status: 'completed',
          results: []
        })
      };
    },
    stdout: () => {}
  });

  const auditRequest = requests.find(({ url }) => {
    return url.endsWith('/v1/audits');
  });

  assert.deepEqual(
    JSON.parse(auditRequest.options.body).allowedOrigins,
    ['https://cdn.example.com']
  );
});

test('creates a queued audit before orchestrating its deployment', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-cli-')
  );

  await writeFile(
    path.join(directory, 'pwa-check.yml'),
    [
      'version: 1',
      'audit:',
      '  profile: custom',
      '  include:',
      '    - service-worker-deployment',
      '  options:',
      '    service-worker-deployment:',
      '      deploymentTimeout: 900000',
      '      command:',
      '        - ./deploy.sh',
      ''
    ].join('\n')
  );

  const requests = [];
  const responses = [
    jsonResponse({
      testId: 'test-123',
      deploymentToken: 'deployment-token',
      statusUrl: '/checks/serviceworker-deployment/test-123',
      completionUrl: '/checks/serviceworker-deployment/test-123/complete'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      state: 'baseline-ready'
    }),
    jsonResponse({
      state: 'deployment-reported'
    }, 202),
    jsonResponse({
      state: 'completed',
      result: {
        status: 'passed',
        message: 'Deployment passed.'
      }
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      url: 'https://example.com/',
      status: 'completed',
      score: 100,
      qualityGate: {
        passed: true
      }
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      results: []
    })
  ];
  let commandCalled = false;
  let requestCountWhenCommandCalled;
  const exitCode = await runCli([
    'audit',
    '--json',
    'https://example.com'
  ], {
    environment: {
      PWA_AUDIT_TOKEN: 'token-value',
      BITBUCKET_COMMIT: 'abc123'
    },
    cwd: directory,
    fetchFunction: async (url, options) => {
      requests.push({
        url,
        options
      });
      return responses.shift();
    },
    runCommand: async ({ command }) => {
      commandCalled = true;
      requestCountWhenCommandCalled = requests.length;
      assert.deepEqual(command, ['./deploy.sh']);
    },
    sleep: async () => {},
    now: () => 0,
    stdout: () => {}
  });

  assert.equal(exitCode, 0);
  assert.equal(commandCalled, true);
  assert.equal(requestCountWhenCommandCalled, 3);

  const auditRequest = requests.find(({ url }) => {
    return url.endsWith('/v1/audits');
  });
  const auditBody = JSON.parse(auditRequest.options.body);

  assert.deepEqual(
    auditBody.options['service-worker-deployment'],
    {
      testId: 'test-123'
    }
  );
  assert.equal(
    JSON.stringify(auditBody).includes('./deploy.sh'),
    false
  );
  assert.equal(
    requests.some(({ url }) => {
      return url.endsWith('/v1/audits/audit-123/deployment');
    }),
    true
  );
});

test('marks the queued audit failed when deployment orchestration fails', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'pwa-check-cli-')
  );

  await writeFile(
    path.join(directory, 'pwa-check.yml'),
    [
      'version: 1',
      'audit:',
      '  profile: custom',
      '  include:',
      '    - service-worker-deployment',
      '  options:',
      '    service-worker-deployment:',
      '      command:',
      '        - ./deploy.sh',
      ''
    ].join('\n')
  );

  const requests = [];
  const responses = [
    jsonResponse({
      testId: 'test-123',
      deploymentToken: 'deployment-token',
      statusUrl: '/checks/serviceworker-deployment/test-123',
      completionUrl: '/checks/serviceworker-deployment/test-123/complete'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      state: 'baseline-ready'
    }),
    jsonResponse({
      state: 'cancelled'
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'failed'
    })
  ];
  const exitCode = await runCli([
    'audit',
    '--json',
    'https://example.com'
  ], {
    environment: {
      PWA_AUDIT_TOKEN: 'token-value'
    },
    cwd: directory,
    fetchFunction: async (url, options) => {
      requests.push({
        url,
        options
      });
      return responses.shift();
    },
    runCommand: async () => {
      throw new Error('Deployment failed.');
    },
    sleep: async () => {},
    now: () => 0,
    stderr: () => {}
  });
  const failureRequest = requests.find(({ url, options }) => {
    return (
      url.endsWith('/v1/audits/audit-123/deployment') &&
      JSON.parse(options.body).failed
    );
  });

  assert.equal(exitCode, 2);
  assert.equal(JSON.parse(failureRequest.options.body).failed, true);
});
