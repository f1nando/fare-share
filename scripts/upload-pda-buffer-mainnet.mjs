// Rate-limited, resumable buffer upload only. Never upgrades or closes a program.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  AccountRole, address, createKeyPairSignerFromBytes, createTransactionMessage,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionEncoder,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';

const PROGRAM = '8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD';
const PROGRAMDATA = '8JHtNnvcKH435F55hD5gv3ZUCBfuzBSoAf4k1NLJLkCY';
const AUTHORITY = 'F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR';
const BUFFER = '9FxHoCC6jTocECMZmRKqKYoZSDzN3yhHPTEVHoAffeVY';
const LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
const HASH = '124147cf9ba9683aad0943c8806e4eae976b6a2b98c4963b4c8803e33ab5f21e';
const SIZE = 881680;
const BUFFER_SIZE = SIZE + 45;
const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pubkeyBytes = a => Buffer.from(a.data[0], 'base64');

export function encodeBufferWrite(offset, bytes) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + bytes.length > SIZE || bytes.length > 900) throw Error('Invalid buffer write bounds');
  const data = Buffer.alloc(16 + bytes.length);
  data.writeUInt32LE(1, 0); // UpgradeableLoaderInstruction::Write
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(bytes.length), 8);
  data.set(bytes, 16);
  return data;
}

export async function main() {
  const required = name => { if (!process.env[name]) throw Error(`Missing ${name}`); return process.env[name]; };
  const binary = readFileSync(required('PROGRAM_SO'));
  if (binary.length !== SIZE || digest(binary) !== HASH) throw Error('Frozen ELF mismatch');
  const backup = readFileSync(required('BACKUP_VERIFICATION_FILE'), 'utf8');
  if (!backup.includes('AUTHORITY_AND_BUFFER_DPAPI_ROUNDTRIP=PASS')) throw Error('Backup gate failed');
  const authority = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(required('AUTHORITY_KEYPAIR'), 'utf8'))));
  const bufferSigner = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(required('BUFFER_KEYPAIR'), 'utf8'))));
  if (authority.address !== AUTHORITY || bufferSigner.address !== BUFFER) throw Error('Signer identity mismatch');
  const rpcUrl = readFileSync(required('RPC_URL_FILE'), 'utf8').trim();
  const evidence = required('EVIDENCE_DIR');
  // No raw RPC errors/URLs are printed: the URL may contain a provider credential.
  async function rpc(method, params = []) {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw Error(`${method}: RPC error code ${body.error.code}`);
    return body.result;
  }
  const getAccount = async a => (await rpc('getAccountInfo', [a, { encoding: 'base64', commitment: 'finalized' }])).value;
  if (await rpc('getGenesisHash') !== GENESIS) throw Error('Not mainnet');
  const program = await getAccount(PROGRAM);
  const programData = await getAccount(PROGRAMDATA);
  const { getAddressDecoder } = await import('@solana/kit');
  const decode = bytes => getAddressDecoder().decode(bytes);
  if (!program?.executable || program.owner !== LOADER || pubkeyBytes(program).readUInt32LE(0) !== 2 || decode(pubkeyBytes(program).subarray(4, 36)) !== PROGRAMDATA) throw Error('Program identity mismatch');
  const pd = pubkeyBytes(programData);
  if (programData.owner !== LOADER || pd.readUInt32LE(0) !== 3 || pd[12] !== 1 || decode(pd.subarray(13, 45)) !== AUTHORITY || programData.lamports !== 4481682680 || pd.length !== 882048 + 45) throw Error('ProgramData recovery gate failed');
  const rent = await rpc('getMinimumBalanceForRentExemption', [BUFFER_SIZE, { commitment: 'finalized' }]);
  const balance = (await rpc('getBalance', [AUTHORITY, { commitment: 'finalized' }])).value;
  let buffer = await getAccount(BUFFER);
  if (balance < (buffer ? 0 : rent) + 20000000) throw Error('Insufficient upload budget');
  function checkBuffer(account) {
    const data = pubkeyBytes(account);
    if (account.owner !== LOADER || account.executable || data.readUInt32LE(0) !== 1 || data[4] !== 1 || decode(data.subarray(5, 37)) !== AUTHORITY || data.length !== BUFFER_SIZE || account.lamports !== rent) throw Error('Buffer identity/rent mismatch');
    return data.subarray(37, 37 + SIZE);
  }
  if (buffer) checkBuffer(buffer);
  console.log(`CONTROLLED_UPLOAD_PREFLIGHT=PASS; bufferRent=${rent}; walletLamports=${balance}`);
  if (process.argv[2] !== '--execute') return;
  if (process.argv[3] !== `UPLOAD-${BUFFER}-${HASH}`) throw Error('Explicit upload confirmation required');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(`${evidence}/upload-start.json`, JSON.stringify({ program: PROGRAM, buffer: BUFFER, authority: AUTHORITY, hash: HASH, rent, balance, resumed: Boolean(buffer) }));
  let blockhash, fetchedAt = 0, confirmedFee = 0;
  async function send(instructions) {
    if (Date.now() - fetchedAt > 20000) {
      blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
      fetchedAt = Date.now();
    }
    const budget = address('ComputeBudget111111111111111111111111111111');
    const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(15000, 1);
    const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(1000n, 1);
    let message = createTransactionMessage({ version: 0 });
    message = setTransactionMessageFeePayerSigner(authority, message);
    message = setTransactionMessageLifetimeUsingBlockhash({ ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) }, message);
    message = appendTransactionMessageInstructions([{ programAddress: budget, data: limit }, { programAddress: budget, data: price }, ...instructions], message);
    const transaction = await signTransactionMessageWithSigners(message);
    if (getTransactionEncoder().encode(transaction).length > 1232) throw Error('Upload transaction too large');
    const signature = getSignatureFromTransaction(transaction);
    const expectedFee = instructions.length === 2 ? 10015 : 5015;
    if (confirmedFee + expectedFee > 10000000) throw Error('Upload fee ceiling reached');
    appendFileSync(`${evidence}/transactions.jsonl`, JSON.stringify({ signature, at: new Date().toISOString() }) + '\n');
    const sent = await rpc('sendTransaction', [getBase64EncodedWireTransaction(transaction), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 }]);
    if (sent !== signature) throw Error('RPC signature mismatch');
    for (let poll = 0; poll < 150; poll++) {
      await sleep(500);
      const state = (await rpc('getSignatureStatuses', [[signature]])).value[0];
      if (state?.err) throw Error(`Upload transaction failed: ${signature}`);
      if (state && ['confirmed', 'finalized'].includes(state.confirmationStatus)) { confirmedFee += expectedFee; return; }
    }
    throw Error(`Upload confirmation timed out: ${signature}; inspect before resuming`);
  }
  if (!buffer) {
    const initialize = Buffer.alloc(4); // InitializeBuffer = 0
    await send([getCreateAccountInstruction({ payer: authority, newAccount: bufferSigner, lamports: BigInt(rent), space: BigInt(BUFFER_SIZE), programAddress: LOADER }), {
      programAddress: LOADER, data: initialize, accounts: [
        { address: address(BUFFER), role: AccountRole.WRITABLE }, { address: authority.address, role: AccountRole.READONLY },
      ],
    }]);
    // The account is now confirmed; a finalized snapshot is required before resume validation.
    for (let i = 0; i < 60 && !buffer; i++) { await sleep(1000); buffer = await getAccount(BUFFER); }
    if (!buffer) throw Error('Buffer creation has not finalized');
  }
  const existing = checkBuffer(buffer);
  let writes = 0;
  for (let offset = 0; offset < SIZE; offset += 900) {
    const bytes = binary.subarray(offset, Math.min(offset + 900, SIZE));
    if (bytes.equals(existing.subarray(offset, offset + bytes.length))) continue;
    await send([{ programAddress: LOADER, data: encodeBufferWrite(offset, bytes), accounts: [
      { address: address(BUFFER), role: AccountRole.WRITABLE },
      { address: authority.address, role: AccountRole.READONLY_SIGNER, signer: authority },
    ] }]);
    writes++;
    if (writes % 50 === 0) console.log(`UPLOAD_PROGRESS=${Math.min(offset + 900, SIZE)}/${SIZE}; confirmedWrites=${writes}`);
  }
  for (let i = 0; i < 60; i++) {
    const uploaded = checkBuffer(await getAccount(BUFFER));
    if (digest(uploaded) === HASH) {
      writeFileSync(`${evidence}/buffer-verified.json`, JSON.stringify({ program: PROGRAM, buffer: BUFFER, authority: AUTHORITY, hash: HASH, bytes: SIZE, rent, writes, confirmedFee }));
      console.log(`BUFFER_ELF_FINALIZED=PASS; sha256=${HASH}; writes=${writes}; estimatedFees=${confirmedFee}`);
      return;
    }
    await sleep(1000);
  }
  throw Error('Finalized buffer ELF hash mismatch; do not upgrade');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
