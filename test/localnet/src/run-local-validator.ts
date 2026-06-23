import { spawn, type ChildProcess } from 'node:child_process';

import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import {
  createFundedTokenAccounts,
  DEFAULT_INITIAL_TOKEN_AMOUNT,
  DEFAULT_SMOKE_TRANSFER_AMOUNT,
  generateThrowawayKeypair,
  getTokenAccountBalance,
  requestAirdropAndConfirm,
  sendMemoTransaction,
  sendSplTokenTransfer,
  type FundedTokenAccounts,
} from './fixtures.js';
import {
  cleanupLocalValidator,
  findOpenPort,
  preflightSolanaTestValidator,
  startLocalValidator,
  stopLocalValidator,
  waitForLocalValidatorReady,
  type LocalValidatorHandle,
} from './validator.js';

// =============================================================================
// Constants & Types
// =============================================================================

const DEFAULT_AIRDROP_SOL = 2;
const TEST_COMMAND_STOP_TIMEOUT_MS = 5_000;
const MAX_PORT_ALLOCATION_ATTEMPTS = 20;

interface CliOptions {
  allowSkip: boolean;
  help: boolean;
  keepLedger: boolean;
  rpcPort?: number;
  faucetPort?: number;
  testCommand?: string;
}

interface ParseOk {
  ok: true;
  options: CliOptions;
}

interface ParseFailure {
  ok: false;
  message: string;
  exitCode: number;
}

type ParseResult = ParseOk | ParseFailure;

interface PortParseOk {
  ok: true;
  port: number;
}

interface PortParseFailure {
  ok: false;
  message: string;
  exitCode: number;
}

type PortParseResult = PortParseOk | PortParseFailure;

interface LocalnetSetup {
  connection: Connection;
  payer: Keypair;
  donorOwner: Keypair;
  treasuryOwner: Keypair;
  tokenAccounts: FundedTokenAccounts;
  airdropSignature: string;
}

interface ValidatorPorts {
  rpcPort: number;
  faucetPort: number;
}

interface SmokeResult {
  transferSignature: string;
  memoSignature: string;
  vaultBalance: bigint;
}

interface ConnectionWithRpcWebSocket extends Connection {
  _rpcWebSocket?: {
    close: () => void;
  };
}

// =============================================================================
// Utils & Helpers
// =============================================================================

function printHelp(): void {
  console.log(`Usage: pnpm run blockchain:local-validator -- [options]

Starts an isolated solana-test-validator, creates throwaway localnet SPL Token
fixtures, then runs either a built-in smoke transaction or an optional command.

Options:
  --allow-skip             Exit 0 with a SKIP message when solana-test-validator is unavailable.
  --rpc-port <port>        RPC port to bind. Defaults to a free local port.
  --faucet-port <port>     Faucet port to bind. Defaults to a free local port.
  --keep-ledger            Keep the temporary validator ledger/keypair directory after exit.
  --test-command <command> Run a command after fixture setup instead of the built-in smoke.
  -h, --help               Show this help.

Environment provided to --test-command:
  LOCALNET_RPC_URL, LOCALNET_MINT, LOCALNET_DONOR_OWNER, LOCALNET_SOURCE_TOKEN_ACCOUNT,
  LOCALNET_TREASURY_OWNER, LOCALNET_VAULT_TOKEN_ACCOUNT`);
}

function parsePort(rawPort: string, flagName: string): PortParseResult {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return {
      ok: false,
      message: `${flagName} must be an integer between 1 and 65535`,
      exitCode: 2,
    };
  }

  return { ok: true, port };
}

function looksLikeCliOptionToken(arg: string | undefined): boolean {
  return arg?.startsWith('-') ?? false;
}

function parseCliArgs(args: readonly string[]): ParseResult {
  const options: CliOptions = {
    allowSkip: false,
    help: false,
    keepLedger: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      return { ok: false, message: 'Unexpected empty argument', exitCode: 2 };
    }

    if (arg === '--allow-skip') {
      options.allowSkip = true;
      continue;
    }

    if (arg === '--keep-ledger') {
      options.keepLedger = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--') {
      if (index === 0 && (args.length === 1 || looksLikeCliOptionToken(args[index + 1]))) {
        continue;
      }

      const command = args
        .slice(index + 1)
        .join(' ')
        .trim();
      if (command.length === 0) {
        return { ok: false, message: 'Expected a command after --', exitCode: 2 };
      }

      options.testCommand = command;
      break;
    }

    if (arg === '--rpc-port' || arg === '--faucet-port' || arg === '--test-command') {
      const value = args[index + 1];
      if (value === undefined) {
        return { ok: false, message: `Expected a value after ${arg}`, exitCode: 2 };
      }

      if (arg === '--test-command') {
        options.testCommand = value;
      } else {
        const parsedPort = parsePort(value, arg);
        if (!parsedPort.ok) {
          return parsedPort;
        }

        if (arg === '--rpc-port') {
          options.rpcPort = parsedPort.port;
        } else {
          options.faucetPort = parsedPort.port;
        }
      }

      index += 1;
      continue;
    }

    if (arg.startsWith('--rpc-port=')) {
      const parsedPort = parsePort(arg.slice('--rpc-port='.length), '--rpc-port');
      if (!parsedPort.ok) {
        return parsedPort;
      }

      options.rpcPort = parsedPort.port;
      continue;
    }

    if (arg.startsWith('--faucet-port=')) {
      const parsedPort = parsePort(arg.slice('--faucet-port='.length), '--faucet-port');
      if (!parsedPort.ok) {
        return parsedPort;
      }

      options.faucetPort = parsedPort.port;
      continue;
    }

    if (arg.startsWith('--test-command=')) {
      const command = arg.slice('--test-command='.length).trim();
      if (command.length === 0) {
        return { ok: false, message: '--test-command cannot be empty', exitCode: 2 };
      }

      options.testCommand = command;
      continue;
    }

    return { ok: false, message: `Unknown option: ${arg}`, exitCode: 2 };
  }

  if (
    options.rpcPort !== undefined &&
    options.faucetPort !== undefined &&
    options.rpcPort === options.faucetPort
  ) {
    return {
      ok: false,
      message: '--rpc-port and --faucet-port must be different',
      exitCode: 2,
    };
  }

  return { ok: true, options };
}

async function findOpenPortExcept(excludedPort: number | undefined): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_ALLOCATION_ATTEMPTS; attempt += 1) {
    const port = await findOpenPort();
    if (port !== excludedPort) {
      return port;
    }
  }

  throw new Error(
    `Unable to allocate a port distinct from ${String(excludedPort)} after ${MAX_PORT_ALLOCATION_ATTEMPTS} attempts`,
  );
}

async function resolveValidatorPorts(options: CliOptions): Promise<ValidatorPorts> {
  const rpcPort = options.rpcPort ?? (await findOpenPortExcept(options.faucetPort));
  const faucetPort = options.faucetPort ?? (await findOpenPortExcept(rpcPort));

  if (rpcPort === faucetPort) {
    throw new Error('--rpc-port and --faucet-port must be different');
  }

  return { rpcPort, faucetPort };
}

function formatPublicKey(publicKey: PublicKey): string {
  return publicKey.toBase58();
}

function printSetupSummary(handle: LocalValidatorHandle, setup: LocalnetSetup): void {
  console.log('Local validator ready');
  console.log(`  RPC URL: ${handle.rpcUrl}`);
  console.log(`  Ledger dir: ${handle.ledgerDir}`);
  console.log('Fixture setup:');
  console.log(`  Payer: ${formatPublicKey(setup.payer.publicKey)}`);
  console.log(`  Airdrop signature: ${setup.airdropSignature}`);
  console.log(`  SPL mint: ${formatPublicKey(setup.tokenAccounts.mint)}`);
  console.log(`  Mint signature: ${setup.tokenAccounts.mintSignature}`);
  console.log(`  Donor/source owner: ${formatPublicKey(setup.donorOwner.publicKey)}`);
  console.log(
    `  Donor/source token account: ${formatPublicKey(setup.tokenAccounts.sourceTokenAccount)}`,
  );
  console.log(`  Treasury owner: ${formatPublicKey(setup.treasuryOwner.publicKey)}`);
  console.log(`  Vault ATA: ${formatPublicKey(setup.tokenAccounts.destinationTokenAccount)}`);
  console.log(`  Initial source token amount: ${String(setup.tokenAccounts.initialSourceAmount)}`);
}

function buildTestCommandEnv(
  handle: LocalValidatorHandle,
  setup: LocalnetSetup,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LOCALNET_RPC_URL: handle.rpcUrl,
    LOCALNET_MINT: formatPublicKey(setup.tokenAccounts.mint),
    LOCALNET_DONOR_OWNER: formatPublicKey(setup.donorOwner.publicKey),
    LOCALNET_SOURCE_TOKEN_ACCOUNT: formatPublicKey(setup.tokenAccounts.sourceTokenAccount),
    LOCALNET_TREASURY_OWNER: formatPublicKey(setup.treasuryOwner.publicKey),
    LOCALNET_VAULT_TOKEN_ACCOUNT: formatPublicKey(setup.tokenAccounts.destinationTokenAccount),
  };
}

function runShellCommand(command: string, env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, {
    detached: process.platform !== 'win32',
    shell: true,
    stdio: 'inherit',
    env,
  });
  activeTestCommandChild = child;

  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      activeTestCommandChild = undefined;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      activeTestCommandChild = undefined;
      if (signal === 'SIGINT') {
        resolve(130);
        return;
      }

      resolve(code ?? 1);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once('exit', () => {
      resolve();
    });
  });
}

function closeConnectionWebSocket(connection: Connection): void {
  const connectionWithRpcWebSocket = connection as ConnectionWithRpcWebSocket;
  connectionWithRpcWebSocket._rpcWebSocket?.close();
}

// =============================================================================
// Business Logic
// =============================================================================

async function createLocalnetSetup(rpcUrl: string): Promise<LocalnetSetup> {
  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = generateThrowawayKeypair('payer').keypair;
  const donorOwner = generateThrowawayKeypair('donor-owner').keypair;
  const treasuryOwner = generateThrowawayKeypair('treasury-owner').keypair;
  const airdropSignature = await requestAirdropAndConfirm(
    connection,
    payer.publicKey,
    DEFAULT_AIRDROP_SOL,
  );
  const tokenAccounts = await createFundedTokenAccounts(connection, payer, {
    sourceOwner: donorOwner,
    destinationOwner: treasuryOwner,
    initialSourceAmount: DEFAULT_INITIAL_TOKEN_AMOUNT,
  });

  return {
    connection,
    payer,
    donorOwner,
    treasuryOwner,
    tokenAccounts,
    airdropSignature,
  };
}

async function runBuiltInSmoke(setup: LocalnetSetup): Promise<SmokeResult> {
  const transferSignature = await sendSplTokenTransfer(setup.connection, {
    payer: setup.payer,
    source: setup.tokenAccounts.sourceTokenAccount,
    destination: setup.tokenAccounts.destinationTokenAccount,
    owner: setup.donorOwner,
    amount: DEFAULT_SMOKE_TRANSFER_AMOUNT,
  });
  const memoSignature = await sendMemoTransaction(setup.connection, {
    payer: setup.payer,
    memo: 'open-care localnet smoke',
  });
  const vaultBalance = await getTokenAccountBalance(
    setup.connection,
    setup.tokenAccounts.destinationTokenAccount,
  );

  return {
    transferSignature,
    memoSignature,
    vaultBalance,
  };
}

async function runHarness(options: CliOptions): Promise<number> {
  const preflight = preflightSolanaTestValidator();
  if (!preflight.ok) {
    const message = `solana-test-validator unavailable: ${preflight.message}`;
    if (options.allowSkip) {
      console.log(`SKIP: ${message}`);
      return 0;
    }

    console.error(`ERROR: ${message}`);
    console.error(
      'Install the Solana CLI or rerun with --allow-skip on machines without local validator tooling.',
    );
    return 1;
  }

  console.log(`Preflight OK: ${preflight.version}`);

  const { rpcPort, faucetPort } = await resolveValidatorPorts(options);
  const handle = startLocalValidator({
    rpcPort,
    faucetPort,
  });
  activeValidatorHandle = handle;
  activeKeepLedger = options.keepLedger;
  let setup: LocalnetSetup | undefined;

  try {
    console.log(`Starting solana-test-validator --reset at ${handle.rpcUrl}`);
    await waitForLocalValidatorReady(handle);

    setup = await createLocalnetSetup(handle.rpcUrl);
    printSetupSummary(handle, setup);

    if (options.testCommand !== undefined) {
      console.log(`Running test command: ${options.testCommand}`);
      return await runShellCommand(options.testCommand, buildTestCommandEnv(handle, setup));
    }

    const smoke = await runBuiltInSmoke(setup);
    console.log('Built-in smoke complete:');
    console.log(`  SPL transfer signature: ${smoke.transferSignature}`);
    console.log(`  Memo signature: ${smoke.memoSignature}`);
    console.log(`  Vault token balance: ${smoke.vaultBalance.toString()}`);
    return 0;
  } finally {
    if (setup !== undefined) {
      closeConnectionWebSocket(setup.connection);
    }

    await cleanupActiveValidator();
  }
}

async function cleanupLocalValidatorWithoutRemovingTemp(
  handle: LocalValidatorHandle,
): Promise<void> {
  await stopLocalValidator(handle);
}

let activeValidatorHandle: LocalValidatorHandle | undefined;
let activeKeepLedger = false;
let activeCleanupPromise: Promise<void> | undefined;
let activeTestCommandChild: ChildProcess | undefined;

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
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

async function stopProcessTree(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  signalProcessTree(child, 'SIGTERM');

  const timeout = sleep(timeoutMs).then(() => 'timeout' as const);
  const exited = waitForChildExit(child).then(() => 'exited' as const);
  const result = await Promise.race([timeout, exited]);

  if (result === 'timeout') {
    signalProcessTree(child, 'SIGKILL');
    await waitForChildExit(child);
  }
}

async function cleanupActiveTestCommand(): Promise<void> {
  if (activeTestCommandChild === undefined) {
    return;
  }

  const child = activeTestCommandChild;
  activeTestCommandChild = undefined;
  await stopProcessTree(child, TEST_COMMAND_STOP_TIMEOUT_MS);
}

async function cleanupActiveValidator(): Promise<void> {
  if (activeCleanupPromise !== undefined) {
    await activeCleanupPromise;
    return;
  }

  if (activeValidatorHandle === undefined) {
    return;
  }

  const handle = activeValidatorHandle;
  activeValidatorHandle = undefined;
  activeCleanupPromise = (async () => {
    if (activeKeepLedger) {
      await cleanupLocalValidatorWithoutRemovingTemp(handle);
      console.log(`Kept temporary validator directory: ${handle.tempRootDir}`);
      return;
    }

    await cleanupLocalValidator(handle);
    console.log(`Removed temporary validator directory: ${handle.tempRootDir}`);
  })();

  await activeCleanupPromise;
}

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') {
    return 130;
  }

  if (signal === 'SIGTERM') {
    return 143;
  }

  return 1;
}

// =============================================================================
// CLI Interface
// =============================================================================

const parsedArgs = parseCliArgs(process.argv.slice(2));

if (!parsedArgs.ok) {
  console.error(`ERROR: ${parsedArgs.message}`);
  process.exitCode = parsedArgs.exitCode;
} else if (parsedArgs.options.help) {
  printHelp();
} else {
  let shutdownExitCode: number | undefined;
  let shutdownCleanupPromise: Promise<void> | undefined;

  const requestShutdown = (signal: NodeJS.Signals): void => {
    const exitCode = signalExitCode(signal);
    if (shutdownCleanupPromise !== undefined) {
      console.error(`Received ${signal} while cleanup is already running; exiting immediately.`);
      process.exit(exitCode);
    }

    shutdownExitCode = exitCode;
    console.error(`Received ${signal}; cleaning up local validator...`);
    shutdownCleanupPromise = (async () => {
      await cleanupActiveTestCommand();
      await cleanupActiveValidator();
    })();

    void shutdownCleanupPromise
      .then(() => {
        process.exit(exitCode);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`ERROR during shutdown cleanup: ${message}`);
        process.exit(1);
      });
  };

  const handleSigint = (): void => {
    requestShutdown('SIGINT');
  };

  const handleSigterm = (): void => {
    requestShutdown('SIGTERM');
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  runHarness(parsedArgs.options)
    .then((exitCode) => {
      if (shutdownExitCode === undefined) {
        process.exitCode = exitCode;
        return;
      }

      process.exitCode = shutdownExitCode;
    })
    .catch((error: unknown) => {
      if (shutdownExitCode !== undefined) {
        process.exitCode = shutdownExitCode;
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(`ERROR: ${message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
    });
}
