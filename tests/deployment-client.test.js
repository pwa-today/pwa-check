import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runDeploymentCheck
} from '../src/deployment-client.js';

const jsonResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
};

test('waits for the baseline and command before reporting deployment', async () => {
  const requests = [];
  const events = [];
  const responses = [
    jsonResponse({
      testId: 'test-123',
      deploymentToken: 'deployment-token',
      statusUrl: '/checks/serviceworker-deployment/test-123',
      completionUrl: '/checks/serviceworker-deployment/test-123/complete'
    }, 202),
    jsonResponse({
      state: 'establishing-baseline'
    }),
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
    })
  ];
  const output = await runDeploymentCheck({
    apiUrl: 'https://api.example.com/',
    token: 'access-token',
    url: 'https://example.com',
    options: {
      deploymentTimeout: 900000
    },
    command: ['./deploy.sh'],
    commandTimeoutMs: 900000,
    metadata: {
      commitSha: 'abc123'
    },
    cwd: '/workspace',
    environment: {},
    fetchFunction: async (url, options) => {
      requests.push({
        url,
        options
      });
      events.push(options.method ?? 'GET');
      return responses.shift();
    },
    runCommand: async (input) => {
      events.push('COMMAND');
      assert.deepEqual(input.command, ['./deploy.sh']);
    },
    sleep: async () => {},
    now: () => 0
  });

  assert.equal(output.testId, 'test-123');
  assert.deepEqual(events, [
    'POST',
    'GET',
    'GET',
    'COMMAND',
    'POST',
    'GET'
  ]);
  assert.deepEqual(
    JSON.parse(requests[0].options.body),
    {
      url: 'https://example.com',
      deploymentTimeout: 900000
    }
  );
  assert.deepEqual(
    JSON.parse(requests[3].options.body),
    {
      commitSha: 'abc123'
    }
  );
  assert.equal(
    requests[3].options.headers['x-deployment-token'],
    'deployment-token'
  );
});

test('does not report completion when the deployment command fails', async () => {
  const requests = [];
  const responses = [
    jsonResponse({
      testId: 'test-123',
      deploymentToken: 'deployment-token',
      statusUrl: '/checks/serviceworker-deployment/test-123',
      completionUrl: '/checks/serviceworker-deployment/test-123/complete'
    }, 202),
    jsonResponse({
      state: 'baseline-ready'
    })
  ];

  await assert.rejects(
    runDeploymentCheck({
      apiUrl: 'https://api.example.com',
      token: 'access-token',
      url: 'https://example.com',
      options: {},
      command: ['./deploy.sh'],
      commandTimeoutMs: 900000,
      cwd: '/workspace',
      environment: {},
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
      now: () => 0
    }),
    /Deployment failed/
  );

  assert.equal(requests.length, 2);
});
