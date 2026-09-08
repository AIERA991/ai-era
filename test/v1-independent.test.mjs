import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toUtf8Bytes } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { localChain, units } from '../scripts/local-chain.mjs';
import { prepareTransaction } from '../scripts/v1-transactions.mjs';

test('V1 independent participants settle five paths without founder, website or model API', async () => {
  const chain = await localChain(compile());
  const { token, escrow, signers, addresses } = chain;
  try {
    // Fixture distribution only; founder/treasury signers are never used below.
    await (await token.connect(signers[1]).transfer(addresses[5], units(100))).wait();
    const deployment = { chainId: 1337, token: await token.getAddress(), escrow: await escrow.getAddress() };
    const digest = keccak256(toUtf8Bytes('independently agreed task bytes'));
    async function send(who, action, fields = {}) {
      const tx = prepareTransaction({ from: addresses[who], action, ...fields }, deployment);
      return (await signers[who].sendTransaction(tx)).wait();
    }
    async function create() {
      await send(5, 'approve', { amount: '10' });
      const id = String(await escrow.nextTaskId());
      await send(5, 'createTask', { provider: addresses[6], arbiter: addresses[7], amount: '10', deliveryDeadline: (await chain.now()) + 3600, specificationHash: digest });
      assert.equal(await token.allowance(addresses[5], deployment.escrow), 0n);
      return id;
    }
    let id = await create();
    await send(6, 'submitResult', { id, resultHash: digest });
    await assert.rejects(send(8, 'approveResult', { id }));
    await send(5, 'approveResult', { id });
    assert.equal((await escrow.tasks(id)).status, 4n);
    id = await create();
    await chain.advance(3601);
    await send(8, 'refundUndelivered', { id });
    assert.equal((await escrow.tasks(id)).status, 5n);
    id = await create();
    await send(6, 'submitResult', { id, resultHash: digest });
    await chain.advance(7 * 86400 + 1);
    await send(8, 'claimAfterReview', { id });
    assert.equal((await escrow.tasks(id)).status, 4n);
    id = await create();
    await send(6, 'submitResult', { id, resultHash: digest });
    await send(5, 'dispute', { id });
    await assert.rejects(send(8, 'resolve', { id, providerAmount: '3' }));
    await send(7, 'resolve', { id, providerAmount: '3' });
    assert.equal((await escrow.tasks(id)).status, 6n);
    id = await create();
    await send(6, 'submitResult', { id, resultHash: digest });
    await send(5, 'dispute', { id });
    await chain.advance(14 * 86400 + 1);
    await send(9, 'refundUnresolved', { id });
    assert.equal((await escrow.tasks(id)).status, 5n);
    assert.equal(await token.balanceOf(addresses[5]), units(77));
    assert.equal(await token.balanceOf(addresses[6]), units(23));
    assert.equal(await token.balanceOf(deployment.escrow), 0n);
    assert.equal(await escrow.totalEscrowed(), 0n);
    assert.equal(await token.balanceOf(addresses[8]), 0n);
  } finally { await chain.close(); }
});

test('offline encoder rejects unsupported actions, networks and malformed amounts', () => {
  const from = '0x1111111111111111111111111111111111111111';
  for (const amount of ['-1', '1e3', '0.000000001', 10])
    assert.throws(() => prepareTransaction({ from, action: 'approve', amount }));
  assert.throws(() => prepareTransaction({ from, action: 'mint', id: '1' }));
  assert.throws(() => prepareTransaction({ from, action: 'approve', amount: '1' }, { chainId: 1 }));
});
