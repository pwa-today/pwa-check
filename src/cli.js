import {
  readFileSync
} from 'node:fs';

import {
  loadAuditConfig
} from './audit-config.js';
import {
  AuditApiError,
  createRemoteAudit,
  reportAuditDeployment,
  runRemoteAudit,
  waitForRemoteAudit
} from './audit-client.js';
import {
  executeDeploymentCommand,
  runDeploymentCheck
} from './deployment-client.js';
import {
  writeAuditReports
} from './audit-reports.js';
import {
  checkPwa,
  shouldFailResults,
  summarizeResults
} from './checker.js';

const packageData = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

const DEPLOYMENT_CHECK = 'service-worker-deployment';

const splitList = (value) => {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const getOptionValue = (args, index, name) => {
  const argument = args[index];

  if (argument === name) {
    const value = args[index + 1];

    if (!value) {
      throw new TypeError(`Missing value for ${name}.`);
    }

    return {
      value,
      consumed: 2
    };
  }

  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);

    if (!value) {
      throw new TypeError(`Missing value for ${name}.`);
    }

    return {
      value,
      consumed: 1
    };
  }

  return null;
};

export const parseArgs = (argv) => {
  const args = [...argv];
  const explicitCommand = [
    'check',
    'audit'
  ].includes(args[0])
    ? args.shift()
    : null;
  const options = {
    command: explicitCommand ?? 'check',
    url: null,
    json: false,
    help: false,
    failOnWarn: false,
    ignoreWarnCodes: [],
    insecureLocalhost: false,
    timeoutMs: undefined,
    config: null,
    profile: null,
    include: [],
    exclude: [],
    applicationId: null,
    minimumScore: undefined,
    failOn: [],
    pollIntervalMs: undefined,
    auditTimeoutMs: undefined,
    apiUrl: null,
    idempotencyKey: null
  };
  let index = 0;

  while (index < args.length) {
    const argument = args[index];

    if (argument === '--json') {
      options.json = true;
      index += 1;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      index += 1;
      continue;
    }

    if (argument === '--fail-on-warn') {
      options.failOnWarn = true;
      index += 1;
      continue;
    }

    if (argument === '--insecure-localhost') {
      options.insecureLocalhost = true;
      index += 1;
      continue;
    }

    const valueOptions = [
      ['--ignore-warn', 'ignoreWarnCodes', true],
      ['--timeout', 'timeoutMs', false],
      ['--config', 'config', false],
      ['--profile', 'profile', false],
      ['--include', 'include', true],
      ['--exclude', 'exclude', true],
      ['--application', 'applicationId', false],
      ['--minimum-score', 'minimumScore', false],
      ['--fail-on', 'failOn', true],
      ['--poll-interval', 'pollIntervalMs', false],
      ['--audit-timeout', 'auditTimeoutMs', false],
      ['--api-url', 'apiUrl', false],
      ['--idempotency-key', 'idempotencyKey', false]
    ];
    const matched = valueOptions
      .map(([name, property, multiple]) => {
        const match = getOptionValue(args, index, name);

        return match
          ? {
              ...match,
              name,
              property,
              multiple
            }
          : null;
      })
      .find(Boolean);

    if (matched) {
      if (matched.multiple) {
        options[matched.property].push(...splitList(matched.value));
      }
      else {
        options[matched.property] = matched.value;
      }

      index += matched.consumed;
      continue;
    }

    if (argument.startsWith('-')) {
      throw new TypeError(`Unknown option: ${argument}.`);
    }

    if (!options.url) {
      options.url = argument;
      index += 1;
      continue;
    }

    throw new TypeError(`Unexpected argument: ${argument}.`);
  }

  for (const name of [
    'timeoutMs',
    'minimumScore',
    'pollIntervalMs',
    'auditTimeoutMs'
  ]) {
    if (options[name] !== undefined) {
      options[name] = Number(options[name]);

      if (!Number.isFinite(options[name]) || options[name] < 0) {
        throw new TypeError(`${name} must be a non-negative number.`);
      }
    }
  }

  return options;
};

const usage = [
  'Usage:',
  '  pwa-check [check] [options] <url>',
  '  pwa-check audit [options] <url>',
  '',
  'Free check options:',
  '  --json',
  '  --fail-on-warn',
  '  --ignore-warn <code>',
  '  --timeout <ms>',
  '  --insecure-localhost',
  '',
  'Runtime audit options:',
  '  --config <file>',
  '  --profile <quick|standard|full|custom>',
  '  --include <check-id>',
  '  --exclude <check-id>',
  '  --application <hostname>',
  '  --minimum-score <0-100>',
  '  --fail-on <severity>',
  '  --poll-interval <ms>',
  '  --audit-timeout <ms>',
  '  --api-url <url>',
  '  --idempotency-key <key>'
].join('\n');

const printFreeResults = ({
  url,
  results,
  summary,
  json,
  stdout
}) => {
  if (json) {
    stdout(`${JSON.stringify({
      url,
      summary,
      results
    }, null, 2)}\n`);
    return;
  }

  stdout(`\nPWA Check\nChecking ${url}\n\n`);

  results.forEach((result) => {
    const icon = result.status === 'pass'
      ? '\x1b[32m✓\x1b[0m'
      : result.status === 'warn'
        ? '\x1b[31m⚠\x1b[0m'
        : '\x1b[31m✗ FAIL\x1b[0m';

    stdout(`${icon} ${result.message}\n`);

    if (result.status !== 'pass') {
      [
        ['Code', result.code],
        ['Priority', result.priority],
        ['Impact', result.impact],
        ['Fix', result.fix],
        ['Docs', result.documentation]
      ]
        .filter(([, value]) => value !== undefined)
        .forEach(([label, value]) => {
          stdout(`  ${`${label}:`.padEnd(10)}${value}\n`);
        });
    }
  });

  stdout(
    `\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail\n`
  );
};

const detectSource = (environment) => {
  if (environment.GITHUB_ACTIONS === 'true') {
    const pullRequest = environment.GITHUB_REF
      ?.match(/^refs\/pull\/(\d+)\//)?.[1];
    const pipelineUrl = (
      environment.GITHUB_SERVER_URL &&
      environment.GITHUB_REPOSITORY &&
      environment.GITHUB_RUN_ID
    )
      ? [
          environment.GITHUB_SERVER_URL,
          environment.GITHUB_REPOSITORY,
          'actions/runs',
          environment.GITHUB_RUN_ID
        ].join('/')
      : undefined;

    return {
      type: 'github-actions',
      repository: environment.GITHUB_REPOSITORY,
      branch: environment.GITHUB_REF_NAME,
      commit: environment.GITHUB_SHA,
      pullRequest,
      pipelineUrl,
      environment: environment.PWA_TODAY_ENVIRONMENT
    };
  }

  return {
    type: environment.CI ? 'ci' : 'cli',
    environment: environment.PWA_TODAY_ENVIRONMENT
  };
};

const withoutUndefined = (value) => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      return entry !== undefined;
    })
  );
};

const printAuditResults = ({
  output,
  stdout
}) => {
  stdout(`\nPWA Runtime Audit\nAudited ${output.audit.url}\n\n`);

  output.results.forEach((result) => {
    const icon = result.status === 'passed'
      ? '\x1b[32m✓\x1b[0m'
      : result.status === 'warning'
        ? '\x1b[33m⚠\x1b[0m'
        : [
            'not-applicable',
            'skipped'
          ].includes(result.status)
          ? '\x1b[90m–\x1b[0m'
          : '\x1b[31m✗\x1b[0m';

    stdout(
      `${icon} ${result.check}: ${result.message} (${result.severity})\n`
    );
  });

  stdout(`\nScore: ${output.audit.score ?? 'n/a'}\n`);
  stdout(
    `Quality gate: ${output.audit.qualityGate?.passed ? 'passed' : 'failed'}\n`
  );
  stdout(`Audit ID: ${output.audit.auditId}\n`);
};

const runFreeCheck = async ({
  options,
  stdout,
  stderr
}) => {
  try {
    const results = await checkPwa(options.url, {
      timeoutMs: options.timeoutMs,
      insecureLocalhost: options.insecureLocalhost
    });
    const summary = summarizeResults(results);

    printFreeResults({
      url: options.url,
      results,
      summary,
      json: options.json,
      stdout
    });

    return shouldFailResults(results, {
      failOnWarn: options.failOnWarn,
      ignoreWarnCodes: options.ignoreWarnCodes
    })
      ? 1
      : 0;
  }
  catch (error) {
    stderr(`${error.message}\n`);
    return 1;
  }
};

const runAudit = async ({
  options,
  environment,
  cwd,
  stdout,
  stderr,
  fetchFunction,
  runCommand,
  sleep,
  now
}) => {
  const token = environment.PWA_AUDIT_TOKEN;

  if (!token) {
    stderr(
      'PWA_AUDIT_TOKEN is required for the audit command.\n'
    );
    return 2;
  }

  try {
    const config = await loadAuditConfig({
      filename: options.config,
      cwd
    });
    const auditConfig = config.audit ?? {};
    const configuredGate = config.qualityGate ?? {};
    const include = options.include.length > 0
      ? options.include
      : auditConfig.include ?? [];
    const exclude = options.exclude.length > 0
      ? options.exclude
      : auditConfig.exclude ?? [];
    const failOn = options.failOn.length > 0
      ? options.failOn
      : configuredGate.failOn;
    const apiUrl =
      options.apiUrl ??
      environment.PWA_TODAY_API_URL ??
      'https://api.pwa.today';
    const requestOptions = {
      ...(auditConfig.options ?? {})
    };
    const deploymentRequested = include.includes(DEPLOYMENT_CHECK);
    const idempotencyKey =
      options.idempotencyKey ??
      environment.PWA_TODAY_IDEMPOTENCY_KEY;
    const buildAuditRequest = () => ({
      url: options.url,
      applicationId:
        options.applicationId ?? auditConfig.applicationId,
      profile: options.profile ?? auditConfig.profile ?? 'standard',
      include,
      exclude,
      options: requestOptions,
      qualityGate: withoutUndefined({
        minimumScore:
          options.minimumScore ??
          configuredGate.minimumScore,
        failOn
      }),
      source: withoutUndefined({
        ...detectSource(environment),
        cliVersion: packageData.version
      })
    });
    const onAuditStatus = options.json
      ? () => {}
      : (status) => {
          stdout(`Audit status: ${status}\n`);
        };
    let output;

    if (deploymentRequested) {
      const deploymentConfig = requestOptions[DEPLOYMENT_CHECK] ?? {};
      const command = deploymentConfig.command;

      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        command.some((entry) => {
          return typeof entry !== 'string' || entry.length === 0;
        })
      ) {
        throw new TypeError(
          `audit.options.${DEPLOYMENT_CHECK}.command must be a non-empty array of strings.`
        );
      }

      const {
        command: ignoredCommand,
        commandTimeout,
        ...deploymentOptions
      } = deploymentConfig;
      const deploymentTimeout =
        deploymentOptions.deploymentTimeout ?? 10 * 60_000;
      const commandTimeoutMs = commandTimeout ?? deploymentTimeout;

      if (
        !Number.isFinite(deploymentTimeout) ||
        deploymentTimeout <= 0 ||
        !Number.isFinite(commandTimeoutMs) ||
        commandTimeoutMs <= 0
      ) {
        throw new TypeError(
          `audit.options.${DEPLOYMENT_CHECK} timeouts must be positive numbers.`
        );
      }

      let preparedAudit;

      try {
        await runDeploymentCheck({
          apiUrl,
          token,
          url: options.url,
          options: deploymentOptions,
          command,
          commandTimeoutMs,
          metadata: withoutUndefined({
            commitSha:
              environment.BITBUCKET_COMMIT ??
              environment.GITHUB_SHA
          }),
          cwd,
          environment,
          pollIntervalMs: options.pollIntervalMs ?? 2000,
          deploymentTimeoutMs: deploymentTimeout,
          fetchFunction,
          runCommand,
          sleep,
          now,
          onCreated: async ({ testId }) => {
            requestOptions[DEPLOYMENT_CHECK] = {
              testId
            };
            preparedAudit = await createRemoteAudit({
              apiUrl,
              token,
              request: buildAuditRequest(),
              idempotencyKey,
              fetchFunction
            });
          },
          onState: options.json
            ? () => {}
            : (state) => {
                stdout(`Deployment check: ${state}\n`);
              }
        });

        await reportAuditDeployment({
          apiUrl,
          token,
          auditId: preparedAudit.auditId,
          fetchFunction
        });
        output = await waitForRemoteAudit({
          apiUrl,
          token,
          auditId: preparedAudit.auditId,
          pollIntervalMs: options.pollIntervalMs ?? 2000,
          auditTimeoutMs: options.auditTimeoutMs ?? 15 * 60_000,
          fetchFunction,
          sleep,
          now,
          onStatus: onAuditStatus
        });
      }
      catch (error) {
        if (preparedAudit?.auditId) {
          await reportAuditDeployment({
            apiUrl,
            token,
            auditId: preparedAudit.auditId,
            failed: true,
            fetchFunction
          }).catch((reportError) => {
            console.error(
              'Could not mark the prepared audit as failed.',
              reportError
            );
          });
        }

        throw error;
      }
    }
    else {
      delete requestOptions[DEPLOYMENT_CHECK];
      output = await runRemoteAudit({
        apiUrl,
        token,
        request: buildAuditRequest(),
        idempotencyKey,
        pollIntervalMs: options.pollIntervalMs ?? 2000,
        auditTimeoutMs: options.auditTimeoutMs ?? 15 * 60_000,
        fetchFunction,
        sleep,
        now,
        onStatus: onAuditStatus
      });
    }

    if (options.json) {
      stdout(`${JSON.stringify(output, null, 2)}\n`);
    }
    else {
      printAuditResults({
        output,
        stdout
      });
    }

    const writtenReports = await writeAuditReports({
      reports: config.reports,
      output,
      cwd
    });

    if (!options.json) {
      Object.entries(writtenReports).forEach(([type, filename]) => {
        stdout(`${type.toUpperCase()} report: ${filename}\n`);
      });
    }

    if ([
      'failed',
      'partially-completed'
    ].includes(output.audit.status)) {
      return 3;
    }

    return output.audit.qualityGate?.passed ? 0 : 1;
  }
  catch (error) {
    stderr(`${error.message}\n`);

    if (error instanceof AuditApiError) {
      return error.exitCode;
    }

    return 2;
  }
};

export const runCli = async (
  argv,
  {
    environment = process.env,
    cwd = process.cwd(),
    stdout = (value) => process.stdout.write(value),
    stderr = (value) => process.stderr.write(value),
    fetchFunction = fetch,
    runCommand = executeDeploymentCommand,
    sleep,
    now
  } = {}
) => {
  let options;

  try {
    options = parseArgs(argv);
  }
  catch (error) {
    stderr(`${error.message}\n${usage}\n`);
    return 2;
  }

  if (options.help) {
    stdout(`${usage}\n`);
    return 0;
  }

  if (!options.url) {
    stderr(`A URL is required.\n${usage}\n`);
    return options.command === 'audit' ? 2 : 1;
  }

  if (options.command === 'audit') {
    return await runAudit({
      options,
      environment,
      cwd,
      stdout,
      stderr,
      fetchFunction,
      runCommand,
      sleep,
      now
    });
  }

  return await runFreeCheck({
    options,
    stdout,
    stderr
  });
};
