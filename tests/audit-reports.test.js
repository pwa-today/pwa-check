import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createJunitReport
} from '../src/audit-reports.js';

test('creates JUnit failures and skipped checks', () => {
  const report = createJunitReport({
    audit: {
      auditId: 'audit-123'
    },
    results: [
      {
        check: 'manifest',
        status: 'failed',
        message: 'Manifest <failed>',
        durationMs: 100
      },
      {
        check: 'push-notifications',
        status: 'not-applicable',
        message: 'Missing configuration.',
        durationMs: 0
      }
    ]
  });

  assert.match(report, /failures="1"/);
  assert.match(report, /skipped="1"/);
  assert.match(report, /Manifest &lt;failed&gt;/);
});
