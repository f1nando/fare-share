import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assignmentRoot, generateMintAssignments } from '../server/mintAssignments.js';

const output = resolve(process.argv[2] || 'config/mint-assignments.json');
const assignments = generateMintAssignments();
const root = assignmentRoot(assignments).toString('hex');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ version: 1, root, assignments }, null, 2)}\n`, { flag: 'wx' });
console.log(`Mint assignments written to ${output}`);
console.log(`MINT_ASSIGNMENT_ROOT_HEX=${root}`);
