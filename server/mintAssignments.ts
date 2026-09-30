import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const CLASS_CAPS = [833, 278, 83, 28] as const;
export const TOTAL_PAID_SUPPLY = 1_222;
const VARIANT_COUNT = 4;
const TREE_SIZE = 2_048;
const HASH_BYTES = 12;
const DOMAIN = Buffer.from('TAXI_MINT_ASSIGNMENT_V1');

export interface MintAssignment {
  classIndex: number;
  variantIndex: number;
}

export interface MintAssignmentWithProof extends MintAssignment {
  assignmentIndex: number;
  proof: string[];
}

export async function loadMintAssignments(path: string) {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { assignments?: MintAssignment[] };
  const assignments = validateAssignments(parsed.assignments);
  const tree = buildTree(assignments);
  return {
    root: tree.at(-1)![0],
    assignment(index: number): MintAssignmentWithProof {
      if (!Number.isInteger(index) || index < 0 || index >= assignments.length) throw new Error('Mint assignment index is out of range');
      return assignmentWithProof(assignments, index, tree);
    },
    assignments,
  };
}

export function generateMintAssignments(): MintAssignment[] {
  const assignments: MintAssignment[] = [];
  CLASS_CAPS.forEach((count, classIndex) => {
    const base = Math.floor(count / VARIANT_COUNT);
    const extras = count % VARIANT_COUNT;
    const variants = shuffle([0, 1, 2, 3]);
    for (let variantIndex = 0; variantIndex < VARIANT_COUNT; variantIndex += 1) {
      const variantCount = base + (variants.indexOf(variantIndex) < extras ? 1 : 0);
      for (let index = 0; index < variantCount; index += 1) assignments.push({ classIndex, variantIndex });
    }
  });
  return shuffle(assignments);
}

export function assignmentRoot(assignments: MintAssignment[]) {
  return buildTree(validateAssignments(assignments)).at(-1)![0];
}

export function assignmentWithProof(assignments: MintAssignment[], index: number, existingTree?: Buffer[][]): MintAssignmentWithProof {
  const validated = validateAssignments(assignments);
  if (!Number.isInteger(index) || index < 0 || index >= validated.length) throw new Error('Mint assignment index is out of range');
  const tree = existingTree || buildTree(validated);
  let position = index;
  const proof: string[] = [];
  for (let level = 0; level < tree.length - 1; level += 1) {
    proof.push(tree[level][position ^ 1].toString('hex'));
    position >>= 1;
  }
  return { assignmentIndex: index, ...validated[index], proof };
}

function validateAssignments(value: unknown): MintAssignment[] {
  if (!Array.isArray(value) || value.length !== TOTAL_PAID_SUPPLY) throw new Error(`Mint assignment list must contain ${TOTAL_PAID_SUPPLY} entries`);
  const assignments = value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Mint assignment ${index} is invalid`);
    const { classIndex, variantIndex } = item as MintAssignment;
    if (!Number.isInteger(classIndex) || classIndex < 0 || classIndex >= CLASS_CAPS.length
      || !Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= VARIANT_COUNT) {
      throw new Error(`Mint assignment ${index} is invalid`);
    }
    return { classIndex, variantIndex };
  });
  CLASS_CAPS.forEach((expected, classIndex) => {
    const classAssignments = assignments.filter(item => item.classIndex === classIndex);
    if (classAssignments.length !== expected) throw new Error(`Class ${classIndex} must contain ${expected} assignments`);
    const counts = Array.from({ length: VARIANT_COUNT }, (_, variantIndex) => classAssignments.filter(item => item.variantIndex === variantIndex).length);
    if (Math.max(...counts) - Math.min(...counts) > 1 || counts.some(count => count === 0)) {
      throw new Error(`Class ${classIndex} variants are not balanced`);
    }
  });
  return assignments;
}

function buildTree(assignments: MintAssignment[]) {
  const leaves = Array.from({ length: TREE_SIZE }, (_, index) => index < assignments.length
    ? leaf(index, assignments[index])
    : Buffer.alloc(HASH_BYTES));
  const levels = [leaves];
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!;
    const next = [];
    for (let index = 0; index < previous.length; index += 2) next.push(hash(previous[index], previous[index + 1]));
    levels.push(next);
  }
  return levels;
}

function leaf(index: number, assignment: MintAssignment) {
  const indexBytes = Buffer.alloc(2);
  indexBytes.writeUInt16LE(index);
  return hash(DOMAIN, indexBytes, Buffer.from([assignment.classIndex, assignment.variantIndex]));
}

function hash(...parts: Buffer[]) {
  return createHash('sha256').update(Buffer.concat(parts)).digest().subarray(0, HASH_BYTES);
}

function shuffle<T>(input: T[]): T[] {
  const result = [...input];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = randomInt(index + 1);
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}
