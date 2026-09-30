import { resolve } from 'node:path';
import {
  REHEARSAL_EXECUTION_CONFIRMATION,
  REHEARSAL_STEPS,
  runRehearsalSmoke,
} from '../server/rehearsalSmoke.js';

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const mode = value('--mode');
const manifestPath = value('--manifest');
const stateDirectory = value('--state-dir');
if (mode !== 'dry-run' && mode !== 'execute') throw new Error('Use --mode dry-run or --mode execute explicitly.');
if (!manifestPath) throw new Error('--manifest requires the complete rehearsal manifest path.');
if (!stateDirectory) throw new Error('--state-dir requires an absolute path outside the Git repository.');

const result = await runRehearsalSmoke({
  repoRoot: process.cwd(),
  manifestPath,
  stateDirectory,
  mode,
  confirmation: value('--confirm'),
  evidencePath: value('--evidence'),
});

console.log(`MODE=${result.mode}`);
console.log(`MANIFEST_SHA256=${result.manifestSha256}`);
console.log(`COMPLETED=${result.completedStepIds.length}/${REHEARSAL_STEPS.length}`);
if (result.acceptedEvidence) console.log(`EVIDENCE_SAVED=${result.acceptedEvidence}`);
if (result.nextStep) {
  console.log(`NEXT_STEP=${result.nextStep.id}`);
  console.log(`TITLE=${result.nextStep.title}`);
  console.log(`EXISTING_SURFACE=${result.nextStep.surface}`);
  console.log(`REQUIRED_EVIDENCE=${result.nextStep.evidence.join(',')}`);
  console.log(`ALLOWED_OUTCOMES=${result.nextStep.allowSafeNoRoute ? 'passed,safe-no-route' : 'passed'}`);
} else {
  console.log('REHEARSAL_EVIDENCE_COMPLETE=true');
}
if (mode === 'dry-run') {
  console.log('READ_ONLY=true');
  console.log(`EXECUTE_CONFIRMATION=${REHEARSAL_EXECUTION_CONFIRMATION}`);
}
