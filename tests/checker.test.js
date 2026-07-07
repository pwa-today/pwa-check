import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldFailResults, summarizeResults } from '../src/checker.js';

test('summarizeResults counts statuses', () => {
  assert.deepEqual(
    summarizeResults([
      { status: 'pass', message: 'a' },
      { status: 'warn', message: 'b' },
      { status: 'warn', message: 'c' },
      { status: 'fail', message: 'd' }
    ]),
    { pass: 1, warn: 2, fail: 1 }
  );
});

test('shouldFailResults can fail on warnings', () => {
  assert.equal(
    shouldFailResults(
      [
        { status: 'pass', message: 'a' },
        { status: 'warn', message: 'b' }
      ],
      { failOnWarn: true }
    ),
    true
  );

  assert.equal(
    shouldFailResults(
      [
        { status: 'pass', message: 'a' },
        { status: 'warn', message: 'b' }
      ],
      { failOnWarn: false }
    ),
    false
  );
});
