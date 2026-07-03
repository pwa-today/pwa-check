#!/usr/bin/env node
import { checkPwa } from '../src/checker.js';

const url = process.argv[2];

if (!url) {
  console.error('Usage: pwa-check <url>');
  process.exit(1);
}

const results = await checkPwa(url);

console.log(`\nPWA Check\nChecking ${url}\n`);

for (const result of results) {
  const icon =
    result.status === 'pass'
      ? '\x1b[32m✓\x1b[0m'
      : result.status === 'warn'
        ? '\x1b[31m⚠\x1b[0m'
        : '\x1b[31m✗ FAIL\x1b[0m';

  console.log(`${icon} ${result.message}`);
}

const errors = results.filter(r => r.status === 'fail').length;
process.exit(errors > 0 ? 1 : 0);
