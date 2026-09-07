import fs from 'node:fs';
import path from 'node:path';
import { AbiCoder, ContractFactory, keccak256, formatUnits } from 'ethers';
import { compile, root } from './compile.mjs';
import { localChain, units } from './local-chain.mjs';

const artifacts = compile();
const c = await localChain(artifacts);
try {
  const factory = name => new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, c.signers[0]);
  const verifier = await factory('LinearInferenceVerifier').deploy();
  await verifier.waitForDeployment();
  const escrow = await factory('AIVerifiedEscrow').deploy(await c.token.getAddress(), await verifier.getAddress());
  await escrow.waitForDeployment();
  const abi = AbiCoder.defaultAbiCoder();
  const x0 = 10n, x1 = 4n;
  const score = 3n * x0 - 2n * x1 + 7n;
  const evidence = abi.encode(['int64', 'int64'], [x0, x1]);
  const output = abi.encode(['int256', 'bool'], [score, score >= 0n]);
  await (await c.token.connect(c.signers[1]).transfer(c.addresses[5], units(100))).wait();
  await (await c.token.connect(c.signers[5]).approve(await escrow.getAddress(), units(25))).wait();
  await (await escrow.connect(c.signers[5]).createJob(c.addresses[6], units(25), await c.now() + 86400,
    await verifier.MODEL_HASH(), keccak256(evidence))).wait();
  const receipt = await (await escrow.connect(c.signers[6]).settle(1, keccak256(output), evidence)).wait();
  const report = { network: 'Ephemeral local EVM only; no public issuance',
    model: 'Fixed demo linear classifier, not a trained production model',
    inputs: [String(x0), String(x1)], score: String(score), label: score >= 0n,
    verification: 'Contract recomputes exact integer inference; not ZK and not private',
    clientApprovalRequired: false, arbiterRequired: false,
    payment: formatUnits(await c.token.balanceOf(c.addresses[6]), 8) + ' AERA',
    escrowBalance: formatUnits(await c.token.balanceOf(await escrow.getAddress()), 8),
    transaction: receipt.hash,
    limitations: 'No L1 consensus, shielded transactions, private inference, automatic emissions or market launched.' };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'verified-demo.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await c.close(); }
