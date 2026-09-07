import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, ContractFactory, id, keccak256 } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { localChain, units } from '../scripts/local-chain.mjs';

const artifacts = compile();
const abi = AbiCoder.defaultAbiCoder();
const evidence = abi.encode(['int64', 'int64'], [10, 4]);
const inputHash = keccak256(evidence);
const outputHash = keccak256(abi.encode(['int256', 'bool'], [29, true]));
const tx = async pending => (await pending).wait();
async function fixture(run) {
  const c = await localChain(artifacts);
  try {
    const deploy = async name => {
      const contract = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, c.signers[0])
        .deploy(...(name === 'AIVerifiedEscrow' ? [await c.token.getAddress(), await c.verifier.getAddress()] : []));
      await contract.waitForDeployment();
      return contract;
    };
    c.verifier = await deploy('LinearInferenceVerifier');
    c.verified = await deploy('AIVerifiedEscrow');
    await tx(c.token.connect(c.signers[1]).transfer(c.addresses[5], units(50)));
    await tx(c.token.connect(c.signers[5]).approve(await c.verified.getAddress(), units(50)));
    c.modelHash = await c.verifier.MODEL_HASH();
    await tx(c.verified.connect(c.signers[5]).createJob(c.addresses[6], units(25),
      await c.now() + 86400, c.modelHash, inputHash));
    await run(c);
  } finally { await c.close(); }
}

test('Exact AI inference pays automatically without client approval or arbiter', () => fixture(async c => {
  assert.equal(await c.verifier.verify(c.modelHash, inputHash, outputHash, evidence), true);
  await tx(c.verified.connect(c.signers[6]).settle(1, outputHash, evidence));
  assert.equal(await c.token.balanceOf(c.addresses[6]), units(25));
  assert.equal((await c.verified.jobs(1)).state, 2n);
  assert.equal(await c.verified.totalEscrowed(), 0n);
  await assert.rejects(c.verified.connect(c.signers[6]).settle(1, outputHash, evidence));
}));

test('Wrong model, input, output, malformed evidence and copied submission cannot claim payment', () => fixture(async c => {
  assert.equal(await c.verifier.verify(id('wrong model'), inputHash, outputHash, evidence), false);
  assert.equal(await c.verifier.verify(c.modelHash, id('wrong input'), outputHash, evidence), false);
  await assert.rejects(c.verified.connect(c.signers[6]).settle(1, id('wrong output'), evidence));
  await assert.rejects(c.verified.connect(c.signers[6]).settle(1, outputHash, '0x01'));
  await assert.rejects(c.verified.connect(c.signers[8]).settle(1, outputHash, evidence));
  assert.equal(await c.verified.totalEscrowed(), units(25));
  assert.equal(await c.token.balanceOf(c.addresses[6]), 0n);
}));

test('Uncompleted verifiable inference refunds after deadline and blocks late claims', () => fixture(async c => {
  await assert.rejects(c.verified.refund(1));
  await c.advance(86401);
  await assert.rejects(c.verified.connect(c.signers[6]).settle(1, outputHash, evidence));
  await tx(c.verified.refund(1, { gasLimit: 200000 }));
  assert.equal(await c.token.balanceOf(c.addresses[5]), units(50));
  assert.equal(await c.verified.totalEscrowed(), 0n);
  await assert.rejects(c.verified.refund(1));
}));

test('Demo classifier handles negative and boundary inputs without integer overflow', () => fixture(async c => {
  for (const [x0, x1] of [[-10n, 4n], [0n, 0n], [-(2n ** 63n), 2n ** 63n - 1n]]) {
    const bytes = abi.encode(['int64', 'int64'], [x0, x1]);
    const score = 3n * x0 - 2n * x1 + 7n;
    const hash = keccak256(abi.encode(['int256', 'bool'], [score, score >= 0n]));
    assert.equal(await c.verifier.verify(c.modelHash, keccak256(bytes), hash, bytes), true);
  }
}));
