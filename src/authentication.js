const MAX_AUTHENTICATION_BYTES = 4096;

const invalidAuthentication = () => {
  throw new TypeError('Authentication must contain a supported bearer header or cookie.');
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

  if (!authorization && !cookies) {
    invalidAuthentication();
  }

  const authentication = {
    ...(authorization ? { authorization } : {}),
    ...(cookies ? {
      cookie: cookies.map(({ name, value: cookieValue }) => `${name}=${cookieValue}`).join('; ')
    } : {})
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
    ...(authentication.authorization ? {
      authorization: authentication.authorization
    } : {}),
    ...(authentication.cookie ? {
      cookie: authentication.cookie
    } : {})
  };
};
