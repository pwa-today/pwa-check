import {
  access,
  readFile
} from 'node:fs/promises';
import path from 'node:path';

import {
  parse
} from 'yaml';

const DEFAULT_CONFIG_FILES = [
  'pwa-check.yml',
  'pwa-check.yaml',
  'pwa-check.json'
];

const isObject = (value) => {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value);
};

const findConfigFile = async (cwd) => {
  const candidates = DEFAULT_CONFIG_FILES.map((filename) => {
    return path.join(cwd, filename);
  });
  const checks = await Promise.all(
    candidates.map(async (filename) => {
      try {
        await access(filename);
        return filename;
      }
      catch {
        return null;
      }
    })
  );

  return checks.find(Boolean) ?? null;
};

export const loadAuditConfig = async ({
  filename,
  cwd = process.cwd()
} = {}) => {
  const resolvedFilename = filename
    ? path.resolve(cwd, filename)
    : await findConfigFile(cwd);

  if (!resolvedFilename) {
    return {
      version: 1
    };
  }

  let config;

  try {
    config = parse(await readFile(resolvedFilename, 'utf8'));
  }
  catch (error) {
    throw new TypeError(
      `Could not read audit configuration: ${error.message}`
    );
  }

  if (!isObject(config)) {
    throw new TypeError('Audit configuration must be an object.');
  }

  if (config.version !== 1) {
    throw new TypeError('Audit configuration version must be 1.');
  }

  for (const name of [
    'audit',
    'qualityGate',
    'reports'
  ]) {
    if (config[name] !== undefined && !isObject(config[name])) {
      throw new TypeError(`${name} configuration must be an object.`);
    }
  }

  return config;
};
