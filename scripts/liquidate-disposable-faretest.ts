import { readFile } from 'node:fs/promises';
import { findAssociatedTokenPda } from '@solana-program/token';
import { address } from '@solana/kit';
import { rehearsalBudgetAllows, REHEARSAL_HARD_LIMIT_LAMPORTS } from '../server/rehearsalBudget.js';
import { validateRehearsalManifest } from '../server/rehearsalManifest.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const SAFE_AUXILIARY_PROGRAMS = new Set([
  'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ...TOKEN_PROGRAMS,
]);

interface FrozenManifest {
  releaseSha: string;
  addresses: {
    replacementFareMint: string;
    sharedRole: string;
    recoveryRecipient: string;
    jupiterProgramId: string;
  };
  limits: { irreversibleMaximumSol: number };
}

export interface LiquidationOptions {
  manifestPath: string;
  slippageBps: number;
  execute?: boolean;
  confirmation?: string;
  maximumTransactionDebitLamports?: bigint;
}

export interface CheckedLiquidationRoute {
  inputMint: string;
  outputMint: string;
  amountIn: bigint;
  minimumOutputLamports: bigint;
  sourceTokenAccount: string;
  destination: string;
  routerProgram: string;
  signerAddresses: string[];
  programAddresses: string[];
  opaqueRoute: unknown;
}

export interface FinalizedLiquidationEvidence {
  signature: string;
  finalized: boolean;
  recipient: string;
  recipientPreBalanceLamports: bigint;
  recipientPostBalanceLamports: bigint;
}

export interface LiquidationRuntime {
  inspectMint(mint: string): Promise<{ programOwner: string }>;
  inspectTokenAccount(tokenAccount: string): Promise<{
    programOwner: string;
    mint: string;
    owner: string;
    amount: bigint;
  }>;
  getCheckedJupiterRoute(input: {
    inputMint: string;
    outputMint: string;
    amountIn: bigint;
    sourceTokenAccount: string;
    sourceWallet: string;
    nativeDestination: string;
    jupiterProgram: string;
    slippageBps: number;
  }): Promise<CheckedLiquidationRoute | null>;
  rehearsalBudget(): Promise<{ spentLamports: bigint; reservedLamports: bigint }>;
  submitCheckedRoute(input: {
    route: CheckedLiquidationRoute;
    fundingWallet: string;
    actionClass: 'recovery';
    maximumDebitLamports: bigint;
  }): Promise<FinalizedLiquidationEvidence>;
}

export type LiquidationResult = {
  status: 'dry-run' | 'no-route' | 'executed';
  sourceWallet: string;
  sourceTokenAccount: string;
  recoveryRecipient: string;
  amountIn: bigint;
  confirmation?: string;
  evidence?: FinalizedLiquidationEvidence;
};

/**
 * Shutdown-only FARETEST liquidation. The function is deliberately dry-run by
 * default; all RPC/Jupiter/submission operations are supplied by one auditable
 * runtime so tests and rehearsals cannot accidentally fall through to fetch().
 */
export async function liquidateDisposableFaretest(
  options: LiquidationOptions,
  runtime: LiquidationRuntime,
): Promise<LiquidationResult> {
  if (!Number.isInteger(options.slippageBps) || options.slippageBps < 0 || options.slippageBps > 1_000) {
    throw new Error('Liquidation slippage must be an integer between 0 and 1000 bps');
  }
  const parsed = JSON.parse(await readFile(options.manifestPath, 'utf8')) as unknown;
  const validation = validateRehearsalManifest(parsed, 'complete');
  if (!validation.deploymentAuthorized) {
    throw new Error(`Complete frozen rehearsal manifest rejected:\n${validation.errors.join('\n')}`);
  }
  const manifest = parsed as FrozenManifest;
  if (manifest.limits.irreversibleMaximumSol !== 0.8) throw new Error('Frozen rehearsal hard limit must be exactly 0.8 SOL');

  const inputMint = manifest.addresses.replacementFareMint;
  const sourceWallet = manifest.addresses.sharedRole;
  const recoveryRecipient = manifest.addresses.recoveryRecipient;
  const mint = await runtime.inspectMint(inputMint);
  if (!TOKEN_PROGRAMS.has(mint.programOwner)) throw new Error(`Replacement FARETEST mint has unexpected program owner ${mint.programOwner}`);
  const [derivedSourceAta] = await findAssociatedTokenPda({
    owner: address(sourceWallet),
    mint: address(inputMint),
    tokenProgram: address(mint.programOwner),
  });
  const sourceTokenAccount = String(derivedSourceAta);
  const source = await runtime.inspectTokenAccount(sourceTokenAccount);
  if (source.programOwner !== mint.programOwner) throw new Error('Source ATA has an unexpected program owner');
  if (source.mint !== inputMint) throw new Error('Source ATA contains the wrong mint');
  if (source.owner !== sourceWallet) throw new Error('Source ATA has the wrong owner');

  const base = { sourceWallet, sourceTokenAccount, recoveryRecipient, amountIn: source.amount };
  if (source.amount === 0n) return { status: 'no-route', ...base };
  const route = await runtime.getCheckedJupiterRoute({
    inputMint,
    outputMint: WSOL_MINT,
    amountIn: source.amount,
    sourceTokenAccount,
    sourceWallet,
    nativeDestination: recoveryRecipient,
    jupiterProgram: manifest.addresses.jupiterProgramId,
    slippageBps: options.slippageBps,
  });
  // No route is a successful no-op. In particular, submission is unreachable.
  if (!route) return { status: 'no-route', ...base };
  assertCheckedRoute(route, {
    inputMint, sourceWallet, sourceTokenAccount, recoveryRecipient,
    amountIn: source.amount, jupiterProgram: manifest.addresses.jupiterProgramId,
  });

  const confirmation = `LIQUIDATE-FARETEST:${manifest.releaseSha}:${inputMint}:${sourceTokenAccount}:${recoveryRecipient}:${source.amount}`;
  if (!options.execute) return { status: 'dry-run', ...base, confirmation };
  if (options.confirmation !== confirmation) throw new Error(`Exact confirmation required: ${confirmation}`);
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) throw new Error('Liquidation execution is disabled in test environments');

  const maximumDebitLamports = options.maximumTransactionDebitLamports ?? 10_000_000n;
  if (maximumDebitLamports <= 0n) throw new Error('Maximum transaction debit must be positive');
  const budget = await runtime.rehearsalBudget();
  if (!rehearsalBudgetAllows(budget.spentLamports, budget.reservedLamports, maximumDebitLamports, 'recovery')) {
    throw new Error(`Rehearsal recovery budget would exceed ${REHEARSAL_HARD_LIMIT_LAMPORTS} lamports`);
  }
  const evidence = await runtime.submitCheckedRoute({
    route, fundingWallet: sourceWallet, actionClass: 'recovery', maximumDebitLamports,
  });
  const delta = evidence.recipientPostBalanceLamports - evidence.recipientPreBalanceLamports;
  if (!evidence.signature || !evidence.finalized || evidence.recipient !== recoveryRecipient
    || delta < route.minimumOutputLamports || delta <= 0n) {
    throw new Error('Finalized recovery-recipient SOL delta evidence is invalid');
  }
  return { status: 'executed', ...base, confirmation, evidence };
}

function assertCheckedRoute(route: CheckedLiquidationRoute, expected: {
  inputMint: string; sourceWallet: string; sourceTokenAccount: string; recoveryRecipient: string;
  amountIn: bigint; jupiterProgram: string;
}) {
  if (route.inputMint !== expected.inputMint || route.outputMint !== WSOL_MINT) throw new Error('Jupiter route changed the frozen mint pair');
  if (route.amountIn !== expected.amountIn || route.amountIn <= 0n || route.minimumOutputLamports <= 0n) throw new Error('Jupiter route changed the exact input or has no output');
  if (route.sourceTokenAccount !== expected.sourceTokenAccount) throw new Error('Jupiter route uses an unexpected source token account');
  if (route.destination !== expected.recoveryRecipient) throw new Error('Jupiter route uses an unexpected native SOL destination');
  if (route.routerProgram !== expected.jupiterProgram) throw new Error('Jupiter route uses an unexpected router program');
  if (!route.signerAddresses.includes(expected.sourceWallet)) throw new Error('Jupiter route does not require the frozen source wallet signer');
  const unexpectedSigner = route.signerAddresses.find(signer => signer !== expected.sourceWallet);
  if (unexpectedSigner) throw new Error(`Jupiter route requires unexpected signer ${unexpectedSigner}`);
  const allowedPrograms = new Set([...SAFE_AUXILIARY_PROGRAMS, expected.jupiterProgram]);
  if (!route.programAddresses.includes(expected.jupiterProgram)) throw new Error('Jupiter route does not invoke the frozen router program');
  const unexpectedProgram = route.programAddresses.find(program => !allowedPrograms.has(program));
  if (unexpectedProgram) throw new Error(`Jupiter route invokes unexpected program ${unexpectedProgram}`);
}
