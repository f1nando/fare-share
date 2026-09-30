import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceProgramIdSources } from '../scripts/set-disposable-program-id.js';

const OLD = 'GHGqUCx5Gf1KgNPXFdWnxYH1DbX9htA5517tFaDXi3i4';
const NEXT = '11111111111111111111111111111111';

test('disposable Program ID update keeps Anchor and Rust sources synchronized', () => {
  const result = replaceProgramIdSources(
    `[programs.localnet]\ntaxi_park = "${OLD}"\n`,
    `declare_id!("${OLD}");\n`,
    NEXT,
  );
  assert.match(result.anchorText, new RegExp(`taxi_park = "${NEXT}"`));
  assert.match(result.rustText, new RegExp(`declare_id!\\("${NEXT}"\\)`));
  assert.equal(result.previousProgramId, OLD);
});

test('disposable Program ID update rejects source drift and duplicate declarations', () => {
  assert.throws(() => replaceProgramIdSources(
    `taxi_park = "${OLD}"\n`,
    `declare_id!("${NEXT}");\n`,
    NEXT,
  ), /do not match/);
  assert.throws(() => replaceProgramIdSources(
    `taxi_park = "${OLD}"\ntaxi_park = "${OLD}"\n`,
    `declare_id!("${OLD}");\n`,
    NEXT,
  ), /exactly one/);
});
