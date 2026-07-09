#!/usr/bin/env node
import { checkPwa, shouldFailResults, summarizeResults } from '../src/checker.js';

const printUsage = () => {
  console.error(
    'Usage: pwa-check [--json] [--fail-on-warn] [--ignore-warn <code>] [--timeout <ms>] [--insecure-localhost] <url>'
  );
};

const parseArgs = argv => {
  const options = {
    json: false,
    failOnWarn: false,
    ignoreWarnCodes: [],
    insecureLocalhost: false,
    timeoutMs: undefined,
    url: null
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--fail-on-warn') {
      options.failOnWarn = true;
      continue;
    }

    if (arg === '--ignore-warn') {
      const ignoreWarnCode = argv[++index];

      if (!ignoreWarnCode) {
        throw new Error('Missing value for --ignore-warn');
      }

      options.ignoreWarnCodes.push(ignoreWarnCode);
      continue;
    }

    if (arg.startsWith('--ignore-warn=')) {
      const ignoreWarnCode = arg.slice('--ignore-warn='.length);

      if (!ignoreWarnCode) {
        throw new Error('Missing value for --ignore-warn');
      }

      options.ignoreWarnCodes.push(ignoreWarnCode);
      continue;
    }

    if (arg === '--timeout') {
      const timeoutValue = argv[++index];

      if (!timeoutValue) {
        throw new Error('Missing value for --timeout');
      }

      options.timeoutMs = Number(timeoutValue);
      continue;
    }

    if (arg.startsWith('--timeout=')) {
      options.timeoutMs = Number(arg.slice('--timeout='.length));
      continue;
    }

    if (arg === '--insecure-localhost') {
      options.insecureLocalhost = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (!options.url) {
      options.url = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)) {
    throw new Error('--timeout must be a non-negative number');
  }

  return options;
};

let options;

try {
  options = parseArgs(process.argv);
} catch (error) {
  console.error(error.message);
  printUsage();
  process.exit(1);
}

if (options.help || !options.url) {
  printUsage();
  process.exit(options.help ? 0 : 1);
}

const results = await checkPwa(options.url, {
  timeoutMs: options.timeoutMs,
  insecureLocalhost: options.insecureLocalhost
});
const summary = summarizeResults(results);
const exitCode = shouldFailResults(results, {
  failOnWarn: options.failOnWarn,
  ignoreWarnCodes: options.ignoreWarnCodes
}) ? 1 : 0;

if (options.json) {
  console.log(
    JSON.stringify(
      {
        url: options.url,
        summary,
        results
      },
      null,
      2
    )
  );
} else {
  console.log(`\nPWA Check\nChecking ${options.url}\n`);

  for (const result of results) {
    const icon =
      result.status === 'pass'
        ? '\x1b[32m✓\x1b[0m'
        : result.status === 'warn'
          ? '\x1b[31m⚠\x1b[0m'
          : '\x1b[31m✗ FAIL\x1b[0m';

    console.log(`${icon} ${result.message}`);
  }

  console.log(
    `\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`
  );
}

process.exit(exitCode);
