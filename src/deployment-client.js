import {
  spawn
} from 'node:child_process';

import {
  AuditApiError,
  requestJson
} from './audit-client.js';

const TERMINAL_STATES = new Set([
  'completed',
  'failed',
  'cancelled'
]);

const endpointUrl = (baseUrl, path) => {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).href;
};

const deploymentError = (job, fallback) => {
  return new AuditApiError(
    job.error?.message ?? job.result?.message ?? fallback
  );
};

export const executeDeploymentCommand = async ({
  command,
  cwd,
  environment,
  timeoutMs
}) => {
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: environment,
      stdio: 'inherit'
    });
    let timedOut = false;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : null;

    child.once('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      reject(new AuditApiError(
        `Could not start the deployment command: ${error.message}`
      ));
    });

    child.once('exit', (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (timedOut) {
        reject(new AuditApiError(
          `The deployment command timed out after ${timeoutMs} ms.`
        ));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new AuditApiError(
        signal
          ? `The deployment command was terminated by ${signal}.`
          : `The deployment command exited with code ${code}.`
      ));
    });
  });
};

const waitForState = async ({
  statusUrl,
  token,
  deploymentToken,
  expectedState,
  timeoutMs,
  pollIntervalMs,
  requestTimeoutMs,
  fetchFunction,
  sleep,
  now,
  onState
}) => {
  const deadline = now() + timeoutMs;
  let previousState;

  while (now() <= deadline) {
    const job = await requestJson({
      fetchFunction,
      url: statusUrl,
      token,
      headers: {
        'x-deployment-token': deploymentToken
      },
      requestTimeoutMs
    });

    if (job.state !== previousState) {
      onState(job.state, job);
      previousState = job.state;
    }

    if (expectedState(job)) {
      return job;
    }

    if (TERMINAL_STATES.has(job.state)) {
      throw deploymentError(
        job,
        `The deployment check ended in state ${job.state}.`
      );
    }

    await sleep(pollIntervalMs);
  }

  throw new AuditApiError(
    `The deployment check timed out after ${timeoutMs} ms.`
  );
};

export const runDeploymentCheck = async ({
  apiUrl,
  token,
  url,
  options,
  command,
  commandTimeoutMs,
  metadata = {},
  cwd,
  environment,
  pollIntervalMs = 2000,
  deploymentTimeoutMs = 10 * 60_000,
  requestTimeoutMs = 30000,
  fetchFunction = fetch,
  runCommand = executeDeploymentCommand,
  sleep = async (milliseconds) => {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  },
  now = () => Date.now(),
  onState = () => {}
}) => {
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const created = await requestJson({
    fetchFunction,
    url: `${baseUrl}/checks/serviceworker-deployment`,
    token,
    method: 'POST',
    body: {
      url,
      ...options
    },
    requestTimeoutMs
  });

  if (
    !created.testId ||
    !created.deploymentToken ||
    !created.statusUrl ||
    !created.completionUrl
  ) {
    throw new AuditApiError(
      'The deployment check did not return its coordination details.'
    );
  }

  const statusUrl = endpointUrl(baseUrl, created.statusUrl);
  const completionUrl = endpointUrl(baseUrl, created.completionUrl);

  try {
    await waitForState({
      statusUrl,
      token,
      deploymentToken: created.deploymentToken,
      expectedState: (job) => job.state === 'baseline-ready',
      timeoutMs: deploymentTimeoutMs,
      pollIntervalMs,
      requestTimeoutMs,
      fetchFunction,
      sleep,
      now,
      onState
    });

    await runCommand({
      command,
      cwd,
      environment,
      timeoutMs: commandTimeoutMs
    });

    await requestJson({
      fetchFunction,
      url: completionUrl,
      token,
      method: 'POST',
      body: metadata,
      headers: {
        'x-deployment-token': created.deploymentToken
      },
      requestTimeoutMs
    });

    const completed = await waitForState({
      statusUrl,
      token,
      deploymentToken: created.deploymentToken,
      expectedState: (job) => {
        return TERMINAL_STATES.has(job.state) && Boolean(job.result);
      },
      timeoutMs: deploymentTimeoutMs,
      pollIntervalMs,
      requestTimeoutMs,
      fetchFunction,
      sleep,
      now,
      onState
    });

    return {
      testId: created.testId,
      state: completed.state,
      result: completed.result
    };
  }
  catch (error) {
    try {
      await requestJson({
        fetchFunction,
        url: statusUrl,
        token,
        method: 'DELETE',
        headers: {
          'x-deployment-token': created.deploymentToken
        },
        requestTimeoutMs
      });
    }
    catch (cancellationError) {
      console.error(
        'Could not cancel the deployment check.',
        cancellationError
      );
    }

    throw error;
  }
};
