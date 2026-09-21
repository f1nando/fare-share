import { readFile } from 'node:fs/promises';
import { validateDeploymentEnvironment } from '../server/preflight.js';
import { validateProgramIdSources } from '../server/preflight.js';

const result = await validateDeploymentEnvironment(process.env);
const [anchorToml, rustSource] = await Promise.all([
  readFile('Anchor.toml', 'utf8'),
  readFile('programs/taxi_park/src/lib.rs', 'utf8'),
]);
const programId = process.env.TAXI_PROGRAM_ID?.trim();
if (programId) result.errors.push(...validateProgramIdSources(programId, anchorToml, rustSource));

for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
for (const error of result.errors) console.error(`ERROR ${error}`);

if (result.errors.length > 0) {
  console.error(`\nPreflight failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Preflight passed: configuration is complete (${result.warnings.length} warning(s)).`);
}
