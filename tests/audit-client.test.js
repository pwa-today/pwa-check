import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuditApiError,
  runRemoteAudit
} from '../src/audit-client.js';

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
};

test('creates, polls and retrieves a runtime audit', async () => {
  const requests = [];
  const responses = [
    jsonResponse({
      auditId: 'audit-123',
      status: 'queued'
    }, 202),
    jsonResponse({
      auditId: 'audit-123',
      status: 'running'
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      qualityGate: {
        passed: true
      }
    }),
    jsonResponse({
      auditId: 'audit-123',
      status: 'completed',
      results: [{
        check: 'manifest',
        status: 'passed'
      }]
    })
  ];
  const statuses = [];
  const output = await runRemoteAudit({
    apiUrl: 'https://api.example.com/',
    token: 'token-value',
    request: {
      url: 'https://example.com'
    },
    idempotencyKey: 'pipeline-123',
    fetchFunction: async (url, options) => {
      requests.push({
        url,
        options
      });

      return responses.shift();
    },
    sleep: async () => {},
    onStatus: (status) => {
      statuses.push(status);
    }
  });

  assert.equal(output.audit.status, 'completed');
  assert.equal(output.results[0].check, 'manifest');
  assert.deepEqual(statuses, [
    'running',
    'completed'
  ]);
  assert.equal(
    requests[0].options.headers.authorization,
    'Bearer token-value'
  );
  assert.equal(
    requests[0].options.headers['idempotency-key'],
    'pipeline-123'
  );
});

test('classifies authentication errors as exit code 2', async () => {
  await assert.rejects(
    runRemoteAudit({
      apiUrl: 'https://api.example.com',
      token: 'invalid',
      request: {
        url: 'https://example.com'
      },
      fetchFunction: async () => {
        return jsonResponse({
          error: 'Unauthorized'
        }, 401);
      }
    }),
    (error) => {
      assert.equal(error instanceof AuditApiError, true);
      assert.equal(error.exitCode, 2);
      return true;
    }
  );
});

test('classifies audit allowance errors as exit code 2', async () => {
  await assert.rejects(
    runRemoteAudit({
      apiUrl: 'https://api.example.com',
      token: 'token',
      request: {
        url: 'https://example.com'
      },
      fetchFunction: async () => {
        return jsonResponse({
          code: 'AUDIT_LIMIT_REACHED',
          error: 'Your audit allowance has been used.'
        }, 429);
      }
    }),
    (error) => {
      assert.equal(error instanceof AuditApiError, true);
      assert.equal(error.message, 'Your audit allowance has been used.');
      assert.equal(error.exitCode, 2);
      return true;
    }
  );
});
