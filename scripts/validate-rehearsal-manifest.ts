import { readFile } from 'node:fs/promises';
import { validateRehearsalManifest, type RehearsalValidationMode } from '../server/rehearsalManifest.js';

const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const manifestIndex = args.indexOf('--manifest');
const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
const manifestPath = manifestIndex >= 0 ? args[manifestIndex + 1] : 'config/rehearsal-manifest.json';

if (mode !== 'preparation' && mode !== 'complete') {
  throw new Error('Use --mode preparation or --mode complete explicitly.');
}
if (!manifestPath) throw new Error('--manifest requires a path.');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
const result = validateRehearsalManifest(manifest, mode as RehearsalValidationMode);
for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
for (const error of result.errors) console.error(`ERROR ${error}`);
console.log(`DEPLOYMENT_AUTHORIZED=${result.deploymentAuthorized ? 'true' : 'false'}`);
if (result.errors.length > 0) process.exitCode = 1;
