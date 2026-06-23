import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

import { Connection } from '@solana/web3.js';

// =============================================================================
// Constants & Types
// =============================================================================

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 3_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const OUTPUT_TAIL_LIMIT = 8_000;

export interface ValidatorPreflightOk {
  ok: true;
  version: string;
}

export interface ValidatorPreflightFailure {
  ok: false;
  message: string;
}

export type ValidatorPreflightResult = ValidatorPreflightOk | ValidatorPreflightFailure;

export type LocalValidatorChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface LocalValidatorOptions {
  rpcPort: number;
  faucetPort: number;
  validatorCommand?: string;
  startupTimeoutMs?: number;
}

export interface LocalValidatorHandle {
  child: LocalValidatorChildProcess;
  rpcUrl: string;
  rpcPort: number;
  faucetPort: number;
  tempRootDir: string;
  ledgerDir: string;
  output: ProcessOutputBuffer;
}

// =============================================================================
// Utils & Helpers
// =============================================================================

export class ProcessOutputBuffer {
  readonly #chunks: string[] = [];
  #length = 0;

  append(chunk: string | Buffer): void {
    const text = chunk.toString();
    this.#chunks.push(text);
    this.#length += text.length;

    while (this.#length > OUTPUT_TAIL_LIMIT && this.#chunks.length > 1) {
      const removed = this.#chunks.shift();
      this.#length -= removed?.length ?? 0;
    }
  }

  tail(): string {
    const text = this.#chunks.join('');
    if (text.length <= OUTPUT_TAIL_LIMIT) {
      return text.trim();
    }

    return text.slice(text.length - OUTPUT_TAIL_LIMIT).trim();
  }
}

function describeSpawnError(error: Error): string {
  const errnoError = error as NodeJS.ErrnoException;
  if (errnoError.code === 'ENOENT') {
    return 'command not found on PATH';
  }

  if (errnoError.code === 'ETIMEDOUT') {
    return 'version check timed out';
  }

  return error.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function attachOutputBuffer(child: LocalValidatorChildProcess): ProcessOutputBuffer {
  const output = new ProcessOutputBuffer();
  child.stdout.on('data', (chunk: Buffer) => {
    output.append(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output.append(chunk);
  });
  return output;
}

function waitForChildExit(child: LocalValidatorChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
}

function signalChild(child: LocalValidatorChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }

  const primaryPid = process.platform === 'win32' ? child.pid : -child.pid;

  try {
    process.kill(primaryPid, signal);
    return;
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException;
    if (errnoError.code === 'ESRCH') {
      return;
    }
  }

  try {
    process.kill(child.pid, signal);
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException;
    if (errnoError.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function stopChildProcess(
  child: LocalValidatorChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  signalChild(child, 'SIGTERM');

  const timeout = sleep(timeoutMs).then(() => 'timeout' as const);
  const exited = waitForChildExit(child).then(() => 'exited' as const);
  const result = await Promise.race([timeout, exited]);

  if (result === 'timeout') {
    signalChild(child, 'SIGKILL');
    await waitForChildExit(child);
  }
}

// =============================================================================
// Business Logic
// =============================================================================

export function preflightSolanaTestValidator(
  validatorCommand = 'solana-test-validator',
  timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS,
): ValidatorPreflightResult {
  const result = spawnSync(validatorCommand, ['--version'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error !== undefined) {
    return {
      ok: false,
      message: `Unable to execute ${validatorCommand}: ${describeSpawnError(result.error)}`,
    };
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    return {
      ok: false,
      message: `${validatorCommand} --version exited ${result.status ?? 'without a status'}${
        stderr.length > 0 ? `: ${stderr}` : ''
      }`,
    };
  }

  const version = result.stdout.trim().split('\n')[0]?.trim() ?? 'unknown version';
  return { ok: true, version };
}

export async function findOpenPort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Unable to determine allocated TCP port'));
        });
        return;
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

export function startLocalValidator(options: LocalValidatorOptions): LocalValidatorHandle {
  const validatorCommand = options.validatorCommand ?? 'solana-test-validator';
  const tempRootDir = mkdtempSync(join(tmpdir(), 'open-care-localnet-'));
  const ledgerDir = join(tempRootDir, 'ledger');

  mkdirSync(ledgerDir, { recursive: true });

  const child = spawn(
    validatorCommand,
    [
      '--reset',
      '--ledger',
      ledgerDir,
      '--bind-address',
      '127.0.0.1',
      '--rpc-port',
      String(options.rpcPort),
      '--faucet-port',
      String(options.faucetPort),
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const output = attachOutputBuffer(child);

  return {
    child,
    rpcUrl: `http://127.0.0.1:${options.rpcPort}`,
    rpcPort: options.rpcPort,
    faucetPort: options.faucetPort,
    tempRootDir,
    ledgerDir,
    output,
  };
}

export async function waitForLocalValidatorReady(
  handle: LocalValidatorHandle,
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
): Promise<void> {
  const connection = new Connection(handle.rpcUrl, 'confirmed');
  const deadline = Date.now() + timeoutMs;
  let lastErrorMessage = 'validator did not respond yet';

  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      throw new Error(
        `solana-test-validator exited before readiness. Output:\n${handle.output.tail()}`,
      );
    }

    try {
      await connection.getVersion();
      await connection.getLatestBlockhash('confirmed');
      return;
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      await sleep(250);
    }
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for solana-test-validator at ${handle.rpcUrl}: ${lastErrorMessage}\n${handle.output.tail()}`,
  );
}

export async function stopLocalValidator(
  handle: LocalValidatorHandle,
  timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
): Promise<void> {
  await stopChildProcess(handle.child, timeoutMs);
}

export async function cleanupLocalValidator(handle: LocalValidatorHandle): Promise<void> {
  await stopLocalValidator(handle);
  rmSync(handle.tempRootDir, { recursive: true, force: true });
}
