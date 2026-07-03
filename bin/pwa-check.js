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
    result.status === 'pass' ? '✓' :
    result.status === 'warn' ? '⚠' :
    '✗';

  console.log(`${icon} ${result.message}`);
}

const errors = results.filter(r => r.status === 'fail').length;
process.exit(errors > 0 ? 1 : 0);
