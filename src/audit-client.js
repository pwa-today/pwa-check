const TERMINAL_STATUSES = new Set([
  'completed',
  'partially-completed',
  'failed'
]);

export class AuditApiError extends Error {
  constructor(message, {
    status = null,
    exitCode = 3
  } = {}) {
    super(message);
    this.name = 'AuditApiError';
    this.status = status;
    this.exitCode = exitCode;
  }
}

export const requestJson = async ({
  fetchFunction,
  url,
  token,
  method = 'GET',
  body,
  headers = {},
  idempotencyKey,
  requestTimeoutMs = 30000
}) => {
  let response;

  try {
    response = await fetchFunction(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(body
          ? {
              'content-type': 'application/json'
            }
          : {}),
        ...(idempotencyKey
          ? {
              'idempotency-key': idempotencyKey
            }
          : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  }
  catch (error) {
    throw new AuditApiError(
      `Could not reach the runtime audit service: ${error.message}`
    );
  }

  let data;

  try {
    data = await response.json();
  }
  catch {
    throw new AuditApiError(
      `The runtime audit service returned HTTP ${response.status} without JSON.`,
      {
        status: response.status
      }
    );
  }

  if (!response.ok) {
    const exitCode = [
      400,
      401,
      403
    ].includes(response.status)
      ? 2
      : 3;

    throw new AuditApiError(
      data.error ?? `The runtime audit service returned HTTP ${response.status}.`,
      {
        status: response.status,
        exitCode
      }
    );
  }

  return data;
};

export const createRemoteAudit = async ({
  apiUrl,
  token,
  request,
  idempotencyKey,
  requestTimeoutMs = 30000,
  fetchFunction = fetch
}) => {
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const created = await requestJson({
    fetchFunction,
    url: `${baseUrl}/v1/audits`,
    token,
    method: 'POST',
    body: request,
    idempotencyKey,
    requestTimeoutMs
  });

  if (!created.auditId) {
    throw new AuditApiError(
      'The runtime audit service did not return an audit ID.'
    );
  }

  return created;
};

export const reportAuditDeployment = async ({
  apiUrl,
  token,
  auditId,
  failed = false,
  requestTimeoutMs = 30000,
  fetchFunction = fetch
}) => {
  const baseUrl = apiUrl.replace(/\/+$/, '');

  return await requestJson({
    fetchFunction,
    url: `${baseUrl}/v1/audits/${encodeURIComponent(
      auditId
    )}/deployment`,
    token,
    method: 'POST',
    body: failed
      ? {
          failed: true
        }
      : {},
    requestTimeoutMs
  });
};

export const waitForRemoteAudit = async ({
  apiUrl,
  token,
  auditId,
  pollIntervalMs = 2000,
  auditTimeoutMs = 15 * 60_000,
  requestTimeoutMs = 30000,
  fetchFunction = fetch,
  sleep = async (milliseconds) => {
    await new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  },
  now = () => Date.now(),
  onStatus = () => {}
}) => {
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const statusUrl = `${baseUrl}/v1/audits/${encodeURIComponent(
    auditId
  )}`;
  const resultsUrl = `${statusUrl}/results`;
  const deadline = now() + auditTimeoutMs;
  let audit;
  let previousStatus;

  while (now() <= deadline) {
    audit = await requestJson({
      fetchFunction,
      url: statusUrl,
      token,
      requestTimeoutMs
    });

    if (audit.status !== previousStatus) {
      onStatus(audit.status, audit);
      previousStatus = audit.status;
    }

    if (TERMINAL_STATUSES.has(audit.status)) {
      const resultResponse = await requestJson({
        fetchFunction,
        url: resultsUrl,
        token,
        requestTimeoutMs
      });

      return {
        audit,
        results: resultResponse.results ?? []
      };
    }

    await sleep(pollIntervalMs);
  }

  throw new AuditApiError(
    `Runtime audit timed out after ${auditTimeoutMs} ms.`
  );
};

export const runRemoteAudit = async (options) => {
  const created = await createRemoteAudit(options);

  return await waitForRemoteAudit({
    ...options,
    auditId: created.auditId
  });
};
