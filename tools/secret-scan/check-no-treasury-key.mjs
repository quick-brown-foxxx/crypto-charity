#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// =============================================================================
// Constants
// =============================================================================

const IGNORED_DIR_NAMES = new Set([
  '.git',
  '.svelte-kit',
  '.turbo',
  '.wrangler',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const IGNORED_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.tsbuildinfo',
  'yarn.lock',
]);

const FORBIDDEN_PATTERNS = [
  {
    label: 'treasury secret environment variable name',
    regex: /\bTREASURY_(?:KEY|KEYPAIR|PRIVATE_KEY|SECRET|WALLET_SECRET)\b/g,
  },
  {
    label: 'treasury private key assignment',
    regex: /\btreasury(?:[_-]?wallet)?[_-]?private[_-]?key\b\s*[:=]/gi,
  },
];

// =============================================================================
// Helpers
// =============================================================================

function trackedFilePaths(repoRoot) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((filePath) => filePath.length > 0);
}

function isIgnoredTrackedPath(relativeFilePath) {
  const pathSegments = relativeFilePath.split('/');
  const fileName = pathSegments[pathSegments.length - 1];

  if (fileName === undefined || IGNORED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return pathSegments.slice(0, -1).some((segment) => IGNORED_DIR_NAMES.has(segment));
}

function sourceFiles(directoryPath) {
  return trackedFilePaths(directoryPath)
    .filter((relativeFilePath) => !isIgnoredTrackedPath(relativeFilePath))
    .map((relativeFilePath) => path.join(directoryPath, relativeFilePath))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function lineAndColumn(contents, matchIndex) {
  const beforeMatch = contents.slice(0, matchIndex);
  const lines = beforeMatch.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

// =============================================================================
// Business Logic
// =============================================================================

export function findTreasuryKeyFindings(repoRoot) {
  const findings = [];

  for (const filePath of sourceFiles(repoRoot)) {
    const contents = fs.readFileSync(filePath, 'utf8');

    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.regex.lastIndex = 0;

      for (const match of contents.matchAll(pattern.regex)) {
        const matchIndex = match.index ?? 0;
        const location = lineAndColumn(contents, matchIndex);
        findings.push({
          filePath: relativePath(repoRoot, filePath),
          line: location.line,
          column: location.column,
          label: pattern.label,
          snippet: match[0],
        });
      }
    }
  }

  return findings;
}

// =============================================================================
// CLI Interface
// =============================================================================

export function runCli(repoRoot) {
  const findings = findTreasuryKeyFindings(repoRoot);

  if (findings.length === 0) {
    process.stdout.write(
      'PASS: no treasury key material found in repository source, docs, tooling, or root files\n',
    );
    return;
  }

  process.stderr.write(
    'FAIL: potential treasury key material found in repository source, docs, tooling, or root files\n',
  );
  for (const finding of findings) {
    process.stderr.write(
      `${finding.filePath}:${finding.line}:${finding.column} — ${finding.label}: ${finding.snippet}\n`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.cwd());
}
