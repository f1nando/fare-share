import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { validateRehearsalManifest } from './rehearsalManifest.js';

export const REHEARSAL_EXECUTION_CONFIRMATION = 'I CONFIRM DISPOSABLE REHEARSAL EXECUTION';
export const ORDINARY_BUDGET_LIMIT_LAMPORTS = 700_000_000n;
export const HARD_BUDGET_LIMIT_LAMPORTS = 800_000_000n;
export const TRADE_BUY_CAP_LAMPORTS = 20_000_000n;

export type RehearsalEvidenceOutcome = 'passed' | 'safe-no-route';

export interface RehearsalEvidence {
  version: 1;
  stepId: string;
  manifestSha256: string;
  outcome: RehearsalEvidenceOutcome;
  recordedAt: string;
  observations: Record<string, string | number | boolean>;
}

export interface RehearsalCheckpoint {
  version: 1;
  manifestSha256: string;
  releaseSha: string;
  completedStepIds: string[];
  updatedAt: string;
}

export interface RehearsalStep {
  id: string;
  title: string;
  evidence: readonly string[];
  surface: string;
  allowSafeNoRoute?: boolean;
  budgetCheckpoint?: boolean;
  tradeBuyCap?: boolean;
}

const budgetEvidence = [
  'spentLamports',
  'reservedLamports',
  'projectedNextLamports',
  'recoverableRentLamports',
  'finalizedBalanceSnapshot',
] as const;

const mintEvidence = [
  'transactionSignature', 'quoteFareMint', 'quoteUsdCents', 'assignmentIndex',
  'asset', 'owner', 'sourceAta', 'teamAta', 'teamAtaDeltaRaw', 'quotedAmountRaw',
] as const;

export const REHEARSAL_STEPS: readonly RehearsalStep[] = [
  step('budget-initial', 'Initial project budget checkpoint', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  step('old-ca-paid-mint-1', 'Old-CA paid mint 1 of 2', mintEvidence, 'existing mint quote API and public mint transaction'),
  step('budget-after-old-ca-mint-1', 'Budget checkpoint after old-CA mint 1', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  step('old-ca-paid-mint-2', 'Old-CA paid mint 2 of 2', mintEvidence, 'existing mint quote API and public mint transaction'),
  step('budget-after-old-ca-mints', 'Budget checkpoint after old-CA mints', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  step('ca-replacement-stale-quote-rejected', 'Replace CA and reject the pre-replacement quote', [
    'replacementAdminEvidence', 'configurationFareMint', 'apiTokenFareMint', 'tradeFareMint',
    'overviewFareMint', 'oldQuoteFareMint', 'rejectionEvidence',
  ], 'existing protected admin CA replacement and mint quote validation'),
  step('faretest-paid-mint-1', 'FARETEST paid mint 1 of 2', mintEvidence, 'existing mint quote API and public mint transaction'),
  step('budget-after-faretest-mint-1', 'Budget checkpoint after FARETEST mint 1', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  step('faretest-paid-mint-2', 'FARETEST paid mint 2 of 2', mintEvidence, 'existing mint quote API and public mint transaction'),
  step('canonical-team-ata-deltas', 'Reconcile all four canonical team ATA payment deltas', [
    'oldCaTeamAta', 'oldCaExpectedDeltaRaw', 'oldCaObservedDeltaRaw',
    'faretestTeamAta', 'faretestExpectedDeltaRaw', 'faretestObservedDeltaRaw', 'noRewardOrBurnPaymentDelta',
  ], 'finalized canonical ATA snapshots'),
  step('budget-after-four-mints', 'Budget checkpoint after four paid mints', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  step('paid-transfer', 'Transfer a paid Core asset', ['transactionSignature', 'asset', 'previousOwner', 'newOwner', 'dasOwnerEvidence'], 'existing wallet/Core transfer flow'),
  step('trainee-transfer-rejected', 'Reject transfer of immutable frozen Trainee', [
    'asset', 'owner', 'collection', 'freezePluginEvidence', 'failedTransactionSignature', 'rejectionEvidence',
  ], 'existing Trainee activation and wallet/Core transfer flow'),
  step('paid-claim', 'Claim paid-machine rewards', ['transactionSignature', 'asset', 'owner', 'protocolTimeEvidence', 'rewardDeltas'], 'existing Garage claim flow'),
  step('trainee-claim', 'Claim Trainee rewards', ['transactionSignature', 'asset', 'owner', 'campaignId', 'protocolTimeEvidence', 'rewardDeltas'], 'existing Garage Trainee claim flow'),
  step('das-mongodb-garage-reconciliation', 'Reconcile DAS, MongoDB, and Garage', [
    'assets', 'dasSnapshot', 'mongodbSnapshot', 'garageSnapshot', 'ownerCollectionMetadataMatch',
  ], 'existing DAS-backed public-data indexer and Garage API'),
  step('quote-stale-market-rejected', 'Reject stale market quote', ['requestEvidence', 'marketAgeMs', 'rejectionEvidence'], 'existing mint quote API'),
  step('quote-no-liquidity-rejected', 'Reject no-liquidity quote', ['requestEvidence', 'liquidityEvidence', 'rejectionEvidence'], 'existing mint quote API'),
  step('quote-high-impact-rejected', 'Reject excessive price-impact quote', ['requestEvidence', 'priceImpactBps', 'rejectionEvidence'], 'existing mint quote API'),
  step('quote-divergence-rejected', 'Reject divergent-price quote', ['requestEvidence', 'priceDivergenceBps', 'rejectionEvidence'], 'existing mint quote API'),
  step('old-ca-trade-buy-partial-sell', 'Old-CA Trade buy and partial sell', [
    'fareMint', 'buySignature', 'buyLamports', 'boughtAmountRaw', 'sellSignature', 'soldAmountRaw', 'remainingAmountRaw',
  ], 'existing Trade quote/swap flow', { tradeBuyCap: true }),
  step('faretest-trade-buy-partial-sell', 'FARETEST Trade buy and partial sell', [
    'fareMint', 'buySignature', 'buyLamports', 'boughtAmountRaw', 'sellSignature', 'soldAmountRaw', 'remainingAmountRaw',
  ], 'existing Trade quote/swap flow', { tradeBuyCap: true }),
  step('budget-before-worker', 'Budget checkpoint before 0.1 SOL worker smoke', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
  workerStep('worker-route-fare', 'Worker FARE route or safe no-route'),
  workerStep('worker-route-stock-0', 'Worker UBERx route or safe no-route'),
  workerStep('worker-route-stock-1', 'Worker TSLAx route or safe no-route'),
  workerStep('worker-route-stock-2', 'Worker GOOGLx route or safe no-route'),
  workerStep('worker-route-stock-3', 'Worker AMZNx route or safe no-route'),
  step('budget-final', 'Final project budget checkpoint', budgetEvidence, 'finalized wallet/account snapshots', { budgetCheckpoint: true }),
] as const;

export interface RunRehearsalSmokeOptions {
  repoRoot: string;
  manifestPath: string;
  stateDirectory: string;
  mode: 'dry-run' | 'execute';
  confirmation?: string;
  evidencePath?: string;
  now?: () => Date;
}

export interface RunRehearsalSmokeResult {
  mode: 'dry-run' | 'execute';
  manifestSha256: string;
  completedStepIds: string[];
  nextStep?: RehearsalStep;
  acceptedEvidence?: string;
}

export async function runRehearsalSmoke(options: RunRehearsalSmokeOptions): Promise<RunRehearsalSmokeResult> {
  const repoRoot = resolve(options.repoRoot);
  if (!isAbsolute(options.stateDirectory)) throw new Error('State directory must be absolute.');
  const stateDirectory = resolve(options.stateDirectory);
  assertOutsideRepository(repoRoot, stateDirectory);
  if (options.mode === 'execute' && options.confirmation !== REHEARSAL_EXECUTION_CONFIRMATION) {
    throw new Error(`Execute mode requires exact confirmation: ${REHEARSAL_EXECUTION_CONFIRMATION}`);
  }

  const manifestText = await readFile(resolve(options.manifestPath), 'utf8');
  const manifest = parseJson(manifestText, 'manifest');
  const validation = validateRehearsalManifest(manifest, 'complete');
  if (!validation.deploymentAuthorized || validation.errors.length > 0) {
    throw new Error(`Complete rehearsal manifest is required:\n${validation.errors.join('\n')}`);
  }
  const releaseSha = String((manifest as Record<string, unknown>).releaseSha);
  const manifestSha256 = sha256(manifestText);
  const checkpointPath = resolve(stateDirectory, 'checkpoint.json');
  const checkpoint = await loadCheckpoint(checkpointPath, manifestSha256, releaseSha);
  assertOrderedPrefix(checkpoint.completedStepIds);
  const nextStep = REHEARSAL_STEPS[checkpoint.completedStepIds.length];

  let evidence: RehearsalEvidence | undefined;
  if (options.evidencePath) {
    if (!nextStep) throw new Error('Rehearsal is already complete; no more evidence is accepted.');
    evidence = parseEvidence(await readFile(resolve(options.evidencePath), 'utf8'));
    validateEvidence(evidence, nextStep, manifestSha256, manifest as Record<string, unknown>);
  }

  if (options.mode === 'dry-run') {
    return { mode: options.mode, manifestSha256, completedStepIds: checkpoint.completedStepIds, nextStep };
  }
  if (!nextStep) return { mode: options.mode, manifestSha256, completedStepIds: checkpoint.completedStepIds };
  if (!evidence) throw new Error(`Evidence is required for next step ${nextStep.id}; execute mode never auto-passes a step.`);

  const now = (options.now ?? (() => new Date()))().toISOString();
  const evidenceDirectory = resolve(stateDirectory, 'evidence');
  await mkdir(evidenceDirectory, { recursive: true });
  const evidenceFile = `${String(checkpoint.completedStepIds.length + 1).padStart(2, '0')}-${nextStep.id}.json`;
  await writeFile(resolve(evidenceDirectory, evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  const updated: RehearsalCheckpoint = {
    version: 1,
    manifestSha256,
    releaseSha,
    completedStepIds: [...checkpoint.completedStepIds, nextStep.id],
    updatedAt: now,
  };
  await atomicJsonWrite(checkpointPath, updated);
  return {
    mode: options.mode,
    manifestSha256,
    completedStepIds: updated.completedStepIds,
    nextStep: REHEARSAL_STEPS[updated.completedStepIds.length],
    acceptedEvidence: resolve(evidenceDirectory, evidenceFile),
  };
}

function step(id: string, title: string, evidence: readonly string[], surface: string, flags: Partial<RehearsalStep> = {}): RehearsalStep {
  return { id, title, evidence, surface, ...flags };
}

function workerStep(id: string, title: string): RehearsalStep {
  return step(id, title, [
    'route', 'reserveBeforeLamports', 'reserveAfterLamports', 'rewardVaultBeforeRaw',
    'rewardVaultAfterRaw', 'rentBeforeLamports', 'rentAfterLamports', 'resultEvidence',
  ], 'existing worker contract-fees/swaps/rewards cycle', { allowSafeNoRoute: true });
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseEvidence(value: string): RehearsalEvidence {
  const evidence = parseJson(value, 'evidence');
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Evidence must be an object.');
  const record = evidence as Record<string, unknown>;
  const allowed = new Set(['version', 'stepId', 'manifestSha256', 'outcome', 'recordedAt', 'observations']);
  const extra = Object.keys(record).filter(key => !allowed.has(key));
  if (extra.length) throw new Error(`Evidence has unknown fields: ${extra.join(', ')}`);
  if (record.version !== 1) throw new Error('Evidence version must be 1.');
  if (typeof record.stepId !== 'string' || typeof record.manifestSha256 !== 'string') throw new Error('Evidence stepId and manifestSha256 are required.');
  if (record.outcome !== 'passed' && record.outcome !== 'safe-no-route') throw new Error('Evidence outcome must be passed or safe-no-route.');
  if (typeof record.recordedAt !== 'string' || !Number.isFinite(Date.parse(record.recordedAt))) throw new Error('Evidence recordedAt must be an ISO timestamp.');
  if (!record.observations || typeof record.observations !== 'object' || Array.isArray(record.observations)) throw new Error('Evidence observations must be an object.');
  return record as unknown as RehearsalEvidence;
}

function validateEvidence(evidence: RehearsalEvidence, step: RehearsalStep, manifestSha256: string, manifest: Record<string, unknown>) {
  if (evidence.stepId !== step.id) throw new Error(`Expected evidence for ${step.id}, received ${evidence.stepId}.`);
  if (evidence.manifestSha256 !== manifestSha256) throw new Error('Evidence manifestSha256 does not match the loaded manifest.');
  if (evidence.outcome === 'safe-no-route' && !step.allowSafeNoRoute) throw new Error(`${step.id} does not permit safe-no-route.`);
  const missing = step.evidence.filter(key => !hasEvidenceValue(evidence.observations[key]));
  if (missing.length) throw new Error(`${step.id} evidence is incomplete; missing: ${missing.join(', ')}.`);
  rejectSecretLikeFields(evidence.observations);

  if (step.budgetCheckpoint) validateBudgetEvidence(evidence.observations);
  if (step.tradeBuyCap) {
    const buyLamports = integerEvidence(evidence.observations.buyLamports, 'buyLamports');
    if (buyLamports <= 0n || buyLamports > TRADE_BUY_CAP_LAMPORTS) throw new Error(`${step.id} buyLamports exceeds the 0.02 SOL cap.`);
    const bought = integerEvidence(evidence.observations.boughtAmountRaw, 'boughtAmountRaw');
    const sold = integerEvidence(evidence.observations.soldAmountRaw, 'soldAmountRaw');
    const remaining = integerEvidence(evidence.observations.remainingAmountRaw, 'remainingAmountRaw');
    if (sold <= 0n || remaining <= 0n || sold + remaining !== bought) throw new Error(`${step.id} must prove an exact partial sell with a positive remainder.`);
  }
  validateManifestBoundEvidence(step.id, evidence.observations, manifest);
  if (step.allowSafeNoRoute && evidence.outcome === 'safe-no-route') {
    const before = integerEvidence(evidence.observations.reserveBeforeLamports, 'reserveBeforeLamports');
    const after = integerEvidence(evidence.observations.reserveAfterLamports, 'reserveAfterLamports');
    if (before !== after) throw new Error(`${step.id} safe-no-route must preserve its reserve.`);
  }
}

function validateBudgetEvidence(observations: RehearsalEvidence['observations']) {
  const spent = integerEvidence(observations.spentLamports, 'spentLamports');
  const reserved = integerEvidence(observations.reservedLamports, 'reservedLamports');
  const projected = integerEvidence(observations.projectedNextLamports, 'projectedNextLamports');
  const rent = integerEvidence(observations.recoverableRentLamports, 'recoverableRentLamports');
  if ([spent, reserved, projected, rent].some(value => value < 0n)) throw new Error('Budget evidence cannot contain negative lamports.');
  if (spent + reserved > HARD_BUDGET_LIMIT_LAMPORTS) throw new Error('Project budget exceeds the 0.8 SOL hard limit.');
  if (spent + reserved + projected > ORDINARY_BUDGET_LIMIT_LAMPORTS) {
    throw new Error('Projected ordinary action exceeds the 0.7 SOL automatic stop; the final 0.1 SOL remains reserved.');
  }
}

function validateManifestBoundEvidence(stepId: string, observations: RehearsalEvidence['observations'], manifest: Record<string, unknown>) {
  const addresses = manifest.addresses as Record<string, unknown>;
  const oldCa = String(addresses.fareMint);
  const replacement = String(addresses.replacementFareMint);
  if (stepId.startsWith('old-ca-paid-mint') && observations.quoteFareMint !== oldCa) throw new Error(`${stepId} must use manifest addresses.fareMint.`);
  if (stepId.startsWith('faretest-paid-mint') && observations.quoteFareMint !== replacement) throw new Error(`${stepId} must use manifest addresses.replacementFareMint.`);
  if (stepId === 'old-ca-trade-buy-partial-sell' && observations.fareMint !== oldCa) throw new Error(`${stepId} must use manifest addresses.fareMint.`);
  if (stepId === 'faretest-trade-buy-partial-sell' && observations.fareMint !== replacement) throw new Error(`${stepId} must use manifest addresses.replacementFareMint.`);
  if (stepId.includes('paid-mint') && observations.quoteUsdCents !== 2500) throw new Error(`${stepId} quoteUsdCents must be 2500.`);
  if (stepId.includes('paid-mint') && observations.teamAtaDeltaRaw !== observations.quotedAmountRaw) throw new Error(`${stepId} must prove the full quoted amount reached the team ATA.`);
  if (stepId === 'ca-replacement-stale-quote-rejected') {
    for (const key of ['configurationFareMint', 'apiTokenFareMint', 'tradeFareMint', 'overviewFareMint']) {
      if (observations[key] !== replacement) throw new Error(`${stepId} ${key} must match manifest addresses.replacementFareMint.`);
    }
    if (observations.oldQuoteFareMint !== oldCa) throw new Error(`${stepId} oldQuoteFareMint must match manifest addresses.fareMint.`);
  }
  if (stepId === 'canonical-team-ata-deltas') {
    if (observations.oldCaExpectedDeltaRaw !== observations.oldCaObservedDeltaRaw
      || observations.faretestExpectedDeltaRaw !== observations.faretestObservedDeltaRaw
      || observations.noRewardOrBurnPaymentDelta !== true) {
      throw new Error(`${stepId} must prove exact team ATA deltas and no reward/burn payment delta.`);
    }
  }
  if (stepId === 'das-mongodb-garage-reconciliation' && observations.ownerCollectionMetadataMatch !== true) {
    throw new Error(`${stepId} ownerCollectionMetadataMatch must be true.`);
  }
  if (stepId === 'trainee-transfer-rejected' && observations.collection !== String(addresses.collection)) {
    throw new Error(`${stepId} collection must match manifest addresses.collection.`);
  }
}

function rejectSecretLikeFields(observations: RehearsalEvidence['observations']) {
  const forbidden = /secret|private.?key|seed|mnemonic|api.?key|password|token$/i;
  const found = Object.keys(observations).find(key => forbidden.test(key));
  if (found) throw new Error(`Evidence must not contain secret-like field ${found}.`);
}

function hasEvidenceValue(value: unknown) {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean';
}

function integerEvidence(value: unknown, name: string): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) throw new Error(`${name} must be an unsigned integer string or number.`);
  return BigInt(value);
}

function assertOutsideRepository(repoRoot: string, target: string) {
  const path = relative(repoRoot, target);
  if (path === '' || (!path.startsWith('..') && !isAbsolute(path))) throw new Error('Checkpoint/evidence state directory must be outside the Git repository.');
}

async function loadCheckpoint(path: string, manifestSha256: string, releaseSha: string): Promise<RehearsalCheckpoint> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, manifestSha256, releaseSha, completedStepIds: [], updatedAt: '' };
    throw error;
  }
  const value = parseJson(text, 'checkpoint') as Partial<RehearsalCheckpoint>;
  if (value.version !== 1 || value.manifestSha256 !== manifestSha256 || value.releaseSha !== releaseSha || !Array.isArray(value.completedStepIds)) {
    throw new Error('Checkpoint does not match the complete manifest/release or has an unsupported format.');
  }
  if (value.completedStepIds.some(id => typeof id !== 'string')) throw new Error('Checkpoint completedStepIds are invalid.');
  return value as RehearsalCheckpoint;
}

function assertOrderedPrefix(completed: string[]) {
  if (completed.length > REHEARSAL_STEPS.length || completed.some((id, index) => REHEARSAL_STEPS[index]?.id !== id)) {
    throw new Error('Checkpoint steps are not an ordered prefix of the approved rehearsal plan.');
  }
}

async function atomicJsonWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}
