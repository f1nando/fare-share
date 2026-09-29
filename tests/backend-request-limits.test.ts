import assert from 'node:assert/strict';
import test from 'node:test';
import { jupiterRequest } from '../server/jupiterHttp.js';
import {
  FifoRequestQueue,
  QueueDeadlineError,
  createRequestQueues,
  runRateLimitedAttempts,
} from '../server/requestLimits.js';
import {
  AmbiguousSolanaWriteError,
  solanaRpcCall,
  solanaSendTransactionCall,
} from '../server/solanaRpc.js';

test('FIFO queue spaces request starts without a catch-up burst', async () => {
  const queue = new FifoRequestQueue('test', 25);
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 3 }, () => queue.schedule(async () => {
    starts.push(Date.now());
  })));
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 32, `first interval was ${starts[1] - starts[0]}ms`);
  assert.ok(starts[2] - starts[1] >= 32, `second interval was ${starts[2] - starts[1]}ms`);
});

test('Jupiter quote and build requests share one process queue', async () => {
  const starts: number[] = [];
  const fetchImplementation = async () => {
    starts.push(Date.now());
    return new Response('{}', { status: 200 });
  };
  await Promise.all([
    jupiterRequest('https://jupiter.test/quote', {}, { fetchImplementation, maximumAttempts: 1, operation: '/quote' }),
    jupiterRequest('https://jupiter.test/build', {}, { fetchImplementation, maximumAttempts: 1, operation: '/build' }),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 80, `Jupiter interval was ${starts[1] - starts[0]}ms`);
});

test('Solana RPC callers share one process queue', async () => {
  const starts: number[] = [];
  const fetchImplementation = async () => {
    starts.push(Date.now());
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { value: 1 } }), { status: 200 });
  };
  await Promise.all([
    solanaRpcCall('https://rpc.test', 'getBalance', ['a'], { fetchImplementation, maximumAttempts: 1 }),
    solanaRpcCall('https://rpc.test', 'getAccountInfo', ['b'], { fetchImplementation, maximumAttempts: 1 }),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 15, `Solana RPC interval was ${starts[1] - starts[0]}ms`);
});

test('safe retries return to the back of the same queue', async () => {
  const queues = createRequestQueues({
    jupiterRequestsPerSecond: 40,
    solanaRpcRequestsPerSecond: 40,
    solanaSendTransactionRequestsPerSecond: 40,
    solanaDasRequestsPerSecond: 40,
  });
  const order: string[] = [];
  let attempts = 0;
  const retried = runRateLimitedAttempts({
    queue: queues.solanaRpc,
    maximumAttempts: 2,
    shouldRetry: () => true,
    task: async () => {
      attempts += 1;
      order.push(`attempt-${attempts}`);
      if (attempts === 1) throw new Error('retryable');
      return 'ok';
    },
  });
  const next = queues.solanaRpc.schedule(async () => { order.push('next'); });
  assert.equal(await retried, 'ok');
  await next;
  assert.deepEqual(order, ['attempt-1', 'next', 'attempt-2']);
});

test('one failed request does not block later FIFO work', async () => {
  const queue = new FifoRequestQueue('failure-test', 100);
  const results = await Promise.allSettled([
    queue.schedule(async () => { throw new Error('failed'); }),
    queue.schedule(async () => 'continued'),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.deepEqual(results[1], { status: 'fulfilled', value: 'continued' });
});

test('expired queued work is rejected before the external request starts', async () => {
  const queue = new FifoRequestQueue('deadline-test', 50);
  let expiredTaskStarted = false;
  const first = queue.schedule(async () => undefined);
  const expired = queue.schedule(async () => {
    expiredTaskStarted = true;
  }, { deadlineAt: Date.now() + 5 });
  await first;
  await assert.rejects(expired, QueueDeadlineError);
  assert.equal(expiredTaskStarted, false);
});

test('ambiguous sendTransaction failure is not retried', async () => {
  let attempts = 0;
  await assert.rejects(
    solanaSendTransactionCall('https://rpc.test', ['signed'], {
      fetchImplementation: async () => {
        attempts += 1;
        throw new DOMException('timed out', 'TimeoutError');
      },
    }),
    AmbiguousSolanaWriteError,
  );
  assert.equal(attempts, 1);
});

test('sendTransaction HTTP 5xx remains ambiguous and is not retried', async () => {
  let attempts = 0;
  await assert.rejects(
    solanaSendTransactionCall('https://rpc.test', ['signed'], {
      fetchImplementation: async () => {
        attempts += 1;
        return new Response('upstream unavailable', { status: 503 });
      },
    }),
    AmbiguousSolanaWriteError,
  );
  assert.equal(attempts, 1);
});

test('sendTransaction simulation errors retain program logs', async () => {
  await assert.rejects(
    solanaSendTransactionCall('https://rpc.test', ['signed'], {
      fetchImplementation: async () => new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: {
          message: 'Transaction simulation failed',
          data: { logs: ['Program consumed 200000 of 200000 compute units'] },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    }),
    /Program consumed 200000 of 200000 compute units/,
  );
});
