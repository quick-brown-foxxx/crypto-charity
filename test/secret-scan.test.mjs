import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findTreasuryKeyFindings } from './secret-scan/check-no-treasury-key.mjs';

const forbiddenEnvName = ['TREASURY', 'KEY'].join('_');
const forbiddenPrivateKeyName = ['treasury', 'private', 'key'].join('_');

function createTempGitRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-care-secret-scan-'));
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  return repoRoot;
}

function writeFile(repoRoot, relativeFilePath, contents) {
  const filePath = path.join(repoRoot, relativeFilePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function trackFiles(repoRoot, relativeFilePaths) {
  execFileSync('git', ['add', '--', ...relativeFilePaths], { cwd: repoRoot });
}

describe('treasury key secret scan', () => {
  it('scans tracked root env-style and extensionless files', () => {
    /*
     * Scenario: committed root files do not need an allowlisted extension.
     * Given a tracked root env-style file and a tracked extensionless root file
     * When the treasury-key scanner runs
     * Then both files are scanned and reported when they contain forbidden material.
     */
    const repoRoot = createTempGitRepo();
    try {
      writeFile(repoRoot, '.dev.vars.example', `${forbiddenEnvName}=placeholder\n`);
      writeFile(repoRoot, 'README', `${forbiddenPrivateKeyName} = "placeholder"\n`);
      trackFiles(repoRoot, ['.dev.vars.example', 'README']);

      const findingPaths = findTreasuryKeyFindings(repoRoot).map((finding) => finding.filePath);

      expect(findingPaths).toContain('.dev.vars.example');
      expect(findingPaths).toContain('README');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not scan untracked local files or tracked generated/dependency outputs', () => {
    /*
     * Scenario: local ignored secrets and generated/dependency directories stay out of CI scans.
     * Given forbidden material in an untracked root file and tracked generated/dependency output
     * When the treasury-key scanner runs
     * Then those files are excluded from findings.
     */
    const repoRoot = createTempGitRepo();
    try {
      writeFile(repoRoot, '.dev.vars', `${forbiddenEnvName}=local-secret\n`);
      writeFile(repoRoot, 'node_modules/leak.ts', `${forbiddenEnvName}=dependency-output\n`);
      writeFile(repoRoot, 'dist/leak.ts', `${forbiddenEnvName}=generated-output\n`);
      writeFile(repoRoot, 'apps/example/src/index.ts', 'const value = "safe";\n');
      trackFiles(repoRoot, ['node_modules/leak.ts', 'dist/leak.ts', 'apps/example/src/index.ts']);

      const findings = findTreasuryKeyFindings(repoRoot);

      expect(findings).toEqual([]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
