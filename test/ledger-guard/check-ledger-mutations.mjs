#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// =============================================================================
// Constants & Types
// =============================================================================

const SOURCE_PARENT_DIRS = ['apps', 'packages'];
const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const IGNORED_DIR_NAMES = new Set(['test', 'tests', '__tests__', '__mocks__']);
const IGNORED_FILE_MARKERS = ['.test.', '.spec.'];

const FORBIDDEN_PATTERNS = [
  {
    label: 'Drizzle UPDATE against ledgerEvents',
    regex: /\.\s*update\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?ledgerEvents\s*\)/g,
  },
  {
    label: 'Drizzle DELETE against ledgerEvents',
    regex: /\.\s*delete\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?ledgerEvents\s*\)/g,
  },
  {
    label: 'raw SQL UPDATE ledger_events',
    regex: /\bUPDATE\s+ledger_events\b/gi,
  },
  {
    label: 'raw SQL DELETE FROM ledger_events',
    regex: /\bDELETE\s+FROM\s+ledger_events\b/gi,
  },
];

// =============================================================================
// Utils & Helpers
// =============================================================================

function isDirectory(directoryPath) {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function sourceRoots(repoRoot) {
  const roots = [];

  for (const parentDir of SOURCE_PARENT_DIRS) {
    const parentPath = path.join(repoRoot, parentDir);
    if (!isDirectory(parentPath)) {
      continue;
    }

    for (const entry of fs.readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourcePath = path.join(parentPath, entry.name, 'src');
      if (isDirectory(sourcePath)) {
        roots.push(sourcePath);
      }
    }
  }

  return roots;
}

function sourceFiles(directoryPath) {
  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      files.push(...sourceFiles(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    if (IGNORED_FILE_MARKERS.some((marker) => entry.name.includes(marker))) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function lineAndColumn(contents, matchIndex) {
  const beforeMatch = contents.slice(0, matchIndex);
  const lines = beforeMatch.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

// =============================================================================
// Business Logic
// =============================================================================

function findForbiddenMutations(repoRoot) {
  const findings = [];

  for (const root of sourceRoots(repoRoot)) {
    for (const filePath of sourceFiles(root)) {
      const contents = fs.readFileSync(filePath, 'utf8');

      for (const pattern of FORBIDDEN_PATTERNS) {
        pattern.regex.lastIndex = 0;

        for (const match of contents.matchAll(pattern.regex)) {
          const matchIndex = match.index ?? 0;
          const location = lineAndColumn(contents, matchIndex);
          findings.push({
            filePath: path.relative(repoRoot, filePath),
            line: location.line,
            column: location.column,
            label: pattern.label,
            snippet: match[0],
          });
        }
      }
    }
  }

  return findings;
}

// =============================================================================
// CLI Interface
// =============================================================================

const repoRoot = process.cwd();
const findings = findForbiddenMutations(repoRoot);

if (findings.length === 0) {
  process.stdout.write(
    'PASS: no forbidden ledger_events UPDATE/DELETE mutations in production src dirs\n',
  );
} else {
  process.stderr.write(
    'FAIL: forbidden ledger_events mutation patterns found in production src dirs\n',
  );
  for (const finding of findings) {
    process.stderr.write(
      `${finding.filePath}:${finding.line}:${finding.column} — ${finding.label}: ${finding.snippet}\n`,
    );
  }
  process.exitCode = 1;
}
