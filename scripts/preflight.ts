import { validateDeploymentEnvironment } from '../server/preflight.js';

const result = validateDeploymentEnvironment(process.env);

for (const warning of result.warnings) console.warn(`WARN  ${warning}`);
for (const error of result.errors) console.error(`ERROR ${error}`);

if (result.errors.length > 0) {
  console.error(`\nPreflight failed: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Preflight passed: configuration is complete (${result.warnings.length} warning(s)).`);
}
