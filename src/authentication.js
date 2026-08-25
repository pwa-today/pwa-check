const MAX_AUTHENTICATION_BYTES = 16384;

const invalidAuthentication = () => {
  throw new TypeError('Authentication must contain a bearer header, cookie or session storage.');
};

export const normalizeAuthentication = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidAuthentication();
  }

  const authorization = value.headers?.authorization;
  const cookies = value.cookies;
  const sessionStorage = value.sessionStorage;

  if (
    authorization !== undefined &&
    (typeof authorization !== 'string' || authorization.length === 0 || authorization.length > 2048 || !/^Bearer\s+\S+$/i.test(authorization))
  ) {
    invalidAuthentication();
  }

  if (
    cookies !== undefined &&
    (!Array.isArray(cookies) || cookies.length === 0 || cookies.length > 10 || cookies.some((cookie) => (
      !cookie ||
      typeof cookie !== 'object' ||
      Array.isArray(cookie) ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name ?? '') ||
      typeof cookie.value !== 'string' ||
      cookie.value.length === 0 ||
      cookie.value.length > 2048
    )))
  ) {
    invalidAuthentication();
  }

  if (
    sessionStorage !== undefined &&
    (
      !sessionStorage ||
      typeof sessionStorage !== 'object' ||
      Array.isArray(sessionStorage) ||
      Object.keys(sessionStorage).length === 0 ||
      Object.keys(sessionStorage).length > 10 ||
      Object.entries(sessionStorage).some(([key, storageValue]) => (
        key.length === 0 ||
        key.length > 200 ||
        typeof storageValue !== 'string' ||
        storageValue.length > 8192
      ))
    )
  ) {
    invalidAuthentication();
  }

  if (!authorization && !cookies && !sessionStorage) {
    invalidAuthentication();
  }

  const authentication = {
    ...(authorization ? {
      headers: {
        authorization
      }
    } : {}),
    ...(cookies ? {
      cookies: cookies.map(({ name, value: cookieValue }) => ({
        name,
        value: cookieValue
      }))
    } : {}),
    ...(sessionStorage ? { sessionStorage } : {})
  };

  if (Buffer.byteLength(JSON.stringify(authentication), 'utf8') > MAX_AUTHENTICATION_BYTES) {
    invalidAuthentication();
  }

  return authentication;
};

export const parseAuthentication = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    invalidAuthentication();
  }

  try {
    return normalizeAuthentication(JSON.parse(value));
  }
  catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }

    invalidAuthentication();
  }
};

export const getScopedAuthenticationHeaders = (url, origin, authentication) => {
  if (!authentication || new URL(url).origin !== origin) {
    return {};
  }

  return {
    ...(authentication.headers?.authorization ? {
      authorization: authentication.headers.authorization
    } : {}),
    ...(authentication.cookies ? {
      cookie: authentication.cookies
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ')
    } : {})
  };
};
