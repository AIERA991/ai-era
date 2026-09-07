import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractFactory, ZeroAddress, ZeroHash, id } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { localChain, units } from '../scripts/local-chain.mjs';

const artifacts = compile();
const DAY = 86400;
const tx = async promise => (await promise).wait();
const rejects = async promise => assert.rejects(async () => { const result = await promise; if (result.wait) await result.wait(); });
async function withChain(run) {
  const chain = await localChain(artifacts);
  try { await run(chain); } finally { await chain.close(); }
}
async function fundTask(c, amount = 100) {
  await tx(c.token.connect(c.signers[1]).transfer(c.addresses[5], units(amount)));
  await tx(c.token.connect(c.signers[5]).approve(await c.escrow.getAddress(), units(amount)));
  const taskId = await c.escrow.nextTaskId();
  await tx(c.escrow.connect(c.signers[5]).createTask(c.addresses[6], c.addresses[7],
    units(amount), await c.now() + DAY, id('AI translation; model and acceptance terms')));
  return taskId;
}
async function assertEmptyEscrow(c) {
  assert.equal(await c.escrow.totalEscrowed(), 0n);
  assert.equal(await c.token.balanceOf(await c.escrow.getAddress()), 0n);
}

test('Fixed supply, metadata and exact 65/20/10/5 allocation; deployer gets nothing', () => withChain(async c => {
  assert.equal(await c.token.name(), 'AI Era');
  assert.equal(await c.token.symbol(), 'AERA');
  assert.equal(await c.token.decimals(), 8n);
  assert.equal(await c.token.totalSupply(), units(21_000_000));
  for (const [index, amount] of [[0, 0], [1, 13_650_000], [2, 4_200_000], [3, 2_100_000], [4, 0]]) {
    assert.equal(await c.token.balanceOf(c.addresses[index]), units(amount));
  }
  assert.equal(await c.token.balanceOf(await c.vesting.getAddress()), units(1_050_000));
  assert.equal(await c.vesting.beneficiary(), c.addresses[4]);
  assert.equal(await c.vesting.token(), await c.token.getAddress());
  const names = artifacts.AIEra.abi.filter(x => x.type === 'function').map(x => x.name);
  for (const name of ['mint', 'burn', 'owner', 'upgradeTo', 'pause', 'blacklist']) assert.ok(!names.includes(name));
}));

test('Deployment rejects zero and duplicate allocation addresses', () => withChain(async c => {
  const factory = new ContractFactory(artifacts.AIEra.abi, artifacts.AIEra.bytecode, c.signers[0]);
  await rejects(factory.deploy(ZeroAddress, ...c.addresses.slice(2, 5)));
  await rejects(factory.deploy(c.addresses[1], c.addresses[1], c.addresses[3], c.addresses[4]));
}));

test('Transfers require balance and allowance and preserve supply', () => withChain(async c => {
  await rejects(c.token.connect(c.signers[5]).transfer(c.addresses[6], 1));
  await rejects(c.token.connect(c.signers[5]).transferFrom(c.addresses[1], c.addresses[6], 1));
  await tx(c.token.connect(c.signers[1]).approve(c.addresses[5], units(10)));
  await tx(c.token.connect(c.signers[5]).transferFrom(c.addresses[1], c.addresses[6], units(10)));
  assert.equal(await c.token.allowance(c.addresses[1], c.addresses[5]), 0n);
  assert.equal(await c.token.balanceOf(c.addresses[6]), units(10));
  assert.equal(await c.token.totalSupply(), units(21_000_000));
  await rejects(c.token.connect(c.signers[1]).transfer(ZeroAddress, 1));
}));

test('Developer lock: zero at one year, half at three years, full at five; no double release', () => withChain(async c => {
  const cliff = await c.vesting.cliff();
  const end = await c.vesting.end();
  assert.equal(end - cliff, BigInt(4 * 365 * DAY));
  assert.equal(await c.vesting.vestedAmount(cliff - 1n), 0n);
  assert.equal(await c.vesting.vestedAmount(cliff), 0n);
  assert.equal(await c.vesting.vestedAmount(cliff + BigInt(2 * 365 * DAY)), units(525_000));
  assert.equal(await c.vesting.vestedAmount(end), units(1_050_000));
  await rejects(c.vesting.release());
  await c.advance(3 * 365 * DAY);
  await tx(c.vesting.connect(c.signers[8]).release({ gasLimit: 200000 }));
  const partial = await c.token.balanceOf(c.addresses[4]);
  assert.ok(partial >= units(525_000) && partial < units(525_001));
  assert.equal(await c.token.balanceOf(c.addresses[8]), 0n);
  await c.advance(2 * 365 * DAY + 1);
  await tx(c.vesting.release({ gasLimit: 200000 }));
  assert.equal(await c.token.balanceOf(c.addresses[4]), units(1_050_000));
  assert.equal(await c.token.balanceOf(await c.vesting.getAddress()), 0n);
  await rejects(c.vesting.release());
}));

test('Only designated provider submits and only client approves; no double payment', () => withChain(async c => {
  const taskId = await fundTask(c);
  assert.equal(await c.escrow.totalEscrowed(), units(100));
  await rejects(c.escrow.connect(c.signers[8]).submitResult(taskId, id('result')));
  await rejects(c.escrow.connect(c.signers[6]).submitResult(taskId, ZeroHash));
  await tx(c.escrow.connect(c.signers[6]).submitResult(taskId, id('result')));
  await rejects(c.escrow.connect(c.signers[8]).approveResult(taskId));
  await rejects(c.escrow.claimAfterReview(taskId));
  await tx(c.escrow.connect(c.signers[5]).approveResult(taskId));
  assert.equal((await c.escrow.tasks(taskId)).status, 4n);
  assert.equal(await c.token.balanceOf(c.addresses[6]), units(100));
  await rejects(c.escrow.connect(c.signers[5]).approveResult(taskId));
  await assertEmptyEscrow(c);
}));

test('Undelivered tasks refund only after deadline; late submission cannot win', () => withChain(async c => {
  const taskId = await fundTask(c);
  await rejects(c.escrow.refundUndelivered(taskId));
  await c.advance(DAY + 1);
  await rejects(c.escrow.connect(c.signers[6]).submitResult(taskId, id('late')));
  await tx(c.escrow.connect(c.signers[8]).refundUndelivered(taskId, { gasLimit: 200000 }));
  assert.equal(await c.token.balanceOf(c.addresses[5]), units(100));
  await rejects(c.escrow.refundUndelivered(taskId));
  await assertEmptyEscrow(c);
}));

test('Client silence releases only after review; no refund after delivery', () => withChain(async c => {
  const taskId = await fundTask(c);
  await tx(c.escrow.connect(c.signers[6]).submitResult(taskId, id('result')));
  await c.advance(7 * DAY + 1);
  await rejects(c.escrow.connect(c.signers[5]).dispute(taskId));
  await rejects(c.escrow.refundUndelivered(taskId));
  await tx(c.escrow.claimAfterReview(taskId));
  assert.equal(await c.token.balanceOf(c.addresses[6]), units(100));
  await assertEmptyEscrow(c);
}));

test('Dispute freezes payment; named arbiter can split only this task amount', () => withChain(async c => {
  const taskId = await fundTask(c);
  await tx(c.escrow.connect(c.signers[6]).submitResult(taskId, id('result')));
  await rejects(c.escrow.connect(c.signers[8]).dispute(taskId));
  await tx(c.escrow.connect(c.signers[5]).dispute(taskId));
  await rejects(c.escrow.connect(c.signers[5]).approveResult(taskId));
  await rejects(c.escrow.claimAfterReview(taskId));
  await rejects(c.escrow.connect(c.signers[8]).resolve(taskId, units(60)));
  await rejects(c.escrow.connect(c.signers[7]).resolve(taskId, units(101)));
  await tx(c.escrow.connect(c.signers[7]).resolve(taskId, units(60)));
  assert.equal(await c.token.balanceOf(c.addresses[6]), units(60));
  assert.equal(await c.token.balanceOf(c.addresses[5]), units(40));
  await rejects(c.escrow.connect(c.signers[7]).resolve(taskId, 0));
  await assertEmptyEscrow(c);
}));

test('Inactive arbiter refunds client after 14 days, then cannot resolve', () => withChain(async c => {
  const taskId = await fundTask(c);
  await tx(c.escrow.connect(c.signers[6]).submitResult(taskId, id('result')));
  await tx(c.escrow.connect(c.signers[5]).dispute(taskId));
  await rejects(c.escrow.refundUnresolved(taskId));
  await c.advance(14 * DAY + 1);
  await rejects(c.escrow.connect(c.signers[7]).resolve(taskId, units(100)));
  await tx(c.escrow.refundUnresolved(taskId, { gasLimit: 200000 }));
  assert.equal(await c.token.balanceOf(c.addresses[5]), units(100));
  await assertEmptyEscrow(c);
}));

test('Missing tasks, bad terms and unfunded deposits cannot create liabilities', () => withChain(async c => {
  const create = (...args) => c.escrow.connect(c.signers[5]).createTask(...args);
  const deadline = await c.now() + DAY;
  await rejects(create(c.addresses[6], c.addresses[7], units(100), deadline, id('task')));
  await rejects(create(c.addresses[6], c.addresses[7], 0, deadline, id('task')));
  await rejects(create(c.addresses[5], c.addresses[7], units(1), deadline, id('task')));
  await rejects(create(c.addresses[6], c.addresses[6], units(1), deadline, id('task')));
  await rejects(create(ZeroAddress, c.addresses[7], units(1), deadline, id('task')));
  await rejects(create(c.addresses[6], c.addresses[7], units(1), deadline, ZeroHash));
  await rejects(create(c.addresses[6], c.addresses[7], units(1), 1, id('task')));
  await rejects(create(c.addresses[6], c.addresses[7], units(1), deadline + 100 * DAY, id('task')));
  await rejects(c.escrow.claimAfterReview(999));
  await rejects(c.escrow.refundUndelivered(999));
  await rejects(c.escrow.refundUnresolved(999));
  assert.equal(await c.escrow.nextTaskId(), 1n);
  await assertEmptyEscrow(c);
}));

test('Multiple task accounting isolates settled and pending balances', () => withChain(async c => {
  const a = await fundTask(c, 40);
  const b = await fundTask(c, 60);
  await tx(c.escrow.connect(c.signers[6]).submitResult(a, id('result')));
  await tx(c.escrow.connect(c.signers[5]).approveResult(a));
  assert.equal(await c.escrow.totalEscrowed(), units(60));
  assert.equal(await c.token.balanceOf(await c.escrow.getAddress()), units(60));
  assert.equal((await c.escrow.tasks(b)).status, 1n);
  await c.advance(DAY + 1);
  await tx(c.escrow.refundUndelivered(b));
  await assertEmptyEscrow(c);
  assert.equal(await c.token.totalSupply(), units(21_000_000));
}));
