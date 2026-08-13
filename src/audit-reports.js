import {
  mkdir,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

const escapeXml = (value) => {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};

export const createJunitReport = ({
  audit,
  results
}) => {
  const failures = results.filter((result) => {
    return result.status === 'failed';
  }).length;
  const errors = results.filter((result) => {
    return result.status === 'error';
  }).length;
  const skipped = results.filter((result) => {
    return [
      'not-applicable',
      'skipped'
    ].includes(result.status);
  }).length;
  const testCases = results.map((result) => {
    const attributes = [
      `name="${escapeXml(result.check)}"`,
      'classname="pwa-runtime-audit"',
      `time="${(result.durationMs ?? 0) / 1000}"`
    ].join(' ');
    const message = escapeXml(result.message ?? '');

    if (result.status === 'failed') {
      return `    <testcase ${attributes}><failure message="${message}"/></testcase>`;
    }

    if (result.status === 'error') {
      return `    <testcase ${attributes}><error message="${message}"/></testcase>`;
    }

    if ([
      'not-applicable',
      'skipped'
    ].includes(result.status)) {
      return `    <testcase ${attributes}><skipped message="${message}"/></testcase>`;
    }

    return `    <testcase ${attributes}/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    [
      '<testsuite',
      `name="PWA Runtime Audit ${escapeXml(audit.auditId)}"`,
      `tests="${results.length}"`,
      `failures="${failures}"`,
      `errors="${errors}"`,
      `skipped="${skipped}">`
    ].join(' '),
    ...testCases,
    '</testsuite>',
    ''
  ].join('\n');
};

const writeReport = async (filename, contents, cwd) => {
  const outputPath = path.resolve(cwd, filename);

  await mkdir(path.dirname(outputPath), {
    recursive: true
  });
  await writeFile(outputPath, contents);

  return outputPath;
};

export const writeAuditReports = async ({
  reports = {},
  output,
  cwd = process.cwd()
}) => {
  const written = {};

  if (reports.json) {
    written.json = await writeReport(
      reports.json,
      `${JSON.stringify(output, null, 2)}\n`,
      cwd
    );
  }

  if (reports.junit) {
    written.junit = await writeReport(
      reports.junit,
      createJunitReport(output),
      cwd
    );
  }

  return written;
};
