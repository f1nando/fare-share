import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentRoot, assignmentWithProof, CLASS_CAPS, generateMintAssignments, TOTAL_PAID_SUPPLY } from '../server/mintAssignments.js';

test('precommitted mint assignments have exact class caps and balanced variants', () => {
  const assignments = generateMintAssignments();
  assert.equal(assignments.length, TOTAL_PAID_SUPPLY);
  CLASS_CAPS.forEach((cap, classIndex) => {
    const selected = assignments.filter(item => item.classIndex === classIndex);
    assert.equal(selected.length, cap);
    const variants = Array.from({ length: 4 }, (_, variantIndex) => selected.filter(item => item.variantIndex === variantIndex).length);
    assert.ok(Math.max(...variants) - Math.min(...variants) <= 1);
    assert.ok(variants.every(count => count > 0));
  });
  assert.equal(assignmentRoot(assignments).length, 12);
  const assigned = assignmentWithProof(assignments, 1_221);
  assert.equal(assigned.assignmentIndex, 1_221);
  assert.equal(assigned.proof.length, 11);
  assert.ok(assigned.proof.every(node => /^[0-9a-f]{24}$/.test(node)));
});
