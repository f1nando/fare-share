import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconciledRehearsalSpend,
  rehearsalBudgetAllows,
  REHEARSAL_HARD_LIMIT_LAMPORTS,
  REHEARSAL_ORDINARY_LIMIT_LAMPORTS,
} from '../server/rehearsalBudget.js';

test('ordinary rehearsal actions stop at 0.7 SOL while recovery can use the final 0.1 SOL', () => {
  assert.equal(rehearsalBudgetAllows(690_000_000n, 0n, 10_000_000n, 'ordinary'), true);
  assert.equal(rehearsalBudgetAllows(690_000_000n, 0n, 10_000_001n, 'ordinary'), false);
  assert.equal(rehearsalBudgetAllows(700_000_000n, 0n, 100_000_000n, 'recovery'), true);
  assert.equal(rehearsalBudgetAllows(700_000_000n, 0n, 100_000_001n, 'recovery'), false);
  assert.equal(REHEARSAL_ORDINARY_LIMIT_LAMPORTS, 700_000_000n);
  assert.equal(REHEARSAL_HARD_LIMIT_LAMPORTS, 800_000_000n);
});

test('pending reservations are charged and only finalized SOL returns reduce spend', () => {
  assert.equal(rehearsalBudgetAllows(680_000_000n, 15_000_000n, 10_000_000n, 'ordinary'), false);
  assert.equal(reconciledRehearsalSpend(100_000_000n, 5_000n), 100_005_000n);
  assert.equal(reconciledRehearsalSpend(100_000_000n, -40_000_000n), 60_000_000n);
  assert.equal(reconciledRehearsalSpend(10_000_000n, -40_000_000n), 0n);
});
