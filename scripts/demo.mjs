import fs from 'node:fs';
import path from 'node:path';
import { formatUnits, id } from 'ethers';
import { compile, root } from './compile.mjs';
import { localChain, units } from './local-chain.mjs';

const chain = await localChain(compile());
try {
  const { token, escrow, vesting, signers, addresses } = chain;
  const specification = { task: 'Translate a product introduction into English',
    model: 'DEMO_PLACEHOLDER_NO_MODEL_CALLED', acceptance: 'Client manually approves the translation',
    budgetAERA: '25' };
  const result = { text: 'AI Era connects people and AI agents through verifiable task settlement.',
    note: 'Fixed fixture to demonstrate settlement; no live inference performed.' };
  await (await token.connect(signers[1]).transfer(addresses[5], units(100))).wait();
  await (await token.connect(signers[5]).approve(await escrow.getAddress(), units(25))).wait();
  const created = await (await escrow.connect(signers[5]).createTask(addresses[6], addresses[7],
    units(25), await chain.now() + 86400, id(JSON.stringify(specification)))).wait();
  const submitted = await (await escrow.connect(signers[6]).submitResult(1, id(JSON.stringify(result)))).wait();
  const paid = await (await escrow.connect(signers[5]).approveResult(1)).wait();
  const report = { network: 'Ephemeral local EVM, chainId 1337; NOT a public token issuance',
    liveAIInference: false, token: await token.getAddress(), escrow: await escrow.getAddress(),
    developerVesting: await vesting.getAddress(), totalSupply: formatUnits(await token.totalSupply(), 8),
    developerLocked: formatUnits(await token.balanceOf(await vesting.getAddress()), 8),
    task: specification, result,
    taskStatus: 'Paid', clientBalance: formatUnits(await token.balanceOf(addresses[5]), 8),
    providerBalance: formatUnits(await token.balanceOf(addresses[6]), 8),
    transactions: { created: created.hash, submitted: submitted.hash, paid: paid.hash },
    note: 'Local chain is destroyed after this script. Addresses cannot be used on a public network.' };
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'local-demo.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await chain.close(); }
