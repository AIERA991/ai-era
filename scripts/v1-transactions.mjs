import { Interface, getAddress, parseUnits, ZeroAddress, ZeroHash } from 'ethers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEPOLIA = Object.freeze({ chainId: 11155111,
  token: '0x03D09526AE4FB71d8C3b233D2B165Ff4fD2B6320',
  escrow: '0x9D479C59A5AC4d242A49c9E1779d6CC18b1d87E2' });
const token = new Interface(['function approve(address spender,uint256 amount)']);
const escrow = new Interface([
  'function createTask(address provider,address arbiter,uint256 amount,uint64 deliveryDeadline,bytes32 specificationHash)',
  'function submitResult(uint256 id,bytes32 resultHash)',
  'function approveResult(uint256 id)', 'function dispute(uint256 id)',
  'function resolve(uint256 id,uint256 providerAmount)',
  'function refundUndelivered(uint256 id)', 'function claimAfterReview(uint256 id)',
  'function refundUnresolved(uint256 id)'
]);
function address(value) {
  const result = getAddress(value);
  if (result === ZeroAddress) throw new Error('Zero address');
  return result;
}
function amount(value, allowZero = false) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,8})?$/.test(value)) throw new Error('Use a decimal AERA string, at most 8 decimal places');
  const result = parseUnits(value, 8);
  if (!allowZero && result === 0n) throw new Error('Amount must be positive');
  return result;
}
function hash(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || value === ZeroHash) throw new Error('Nonzero bytes32 hash required');
  return value;
}

// Offline encoding only. Alternate deployment is exclusively for local tests.
export function prepareTransaction(request, deployment = SEPOLIA) {
  if (![11155111, 1337].includes(deployment.chainId)) throw new Error('Only Sepolia or local simulation supported');
  const from = address(request.from);
  let args;
  if (request.action === 'approve') args = [address(deployment.escrow), amount(request.amount, true)];
  else if (request.action === 'createTask') {
    const provider = address(request.provider), arbiter = address(request.arbiter);
    if (new Set([from, provider, arbiter]).size !== 3) throw new Error('Participants must differ');
    if (!Number.isSafeInteger(request.deliveryDeadline) || request.deliveryDeadline <= 0) throw new Error('Use Unix seconds for deliveryDeadline');
    args = [provider, arbiter, amount(request.amount), request.deliveryDeadline, hash(request.specificationHash)];
  } else {
    if (!['submitResult','approveResult','dispute','resolve','refundUndelivered','claimAfterReview','refundUnresolved'].includes(request.action)) throw new Error('Unsupported action');
    if (typeof request.id !== 'string' || !/^[1-9]\d*$/.test(request.id)) throw new Error('Positive task id string required');
    args = [BigInt(request.id)];
    if (request.action === 'submitResult') args.push(hash(request.resultHash));
    if (request.action === 'resolve') args.push(amount(request.providerAmount, true));
  }
  const approval = request.action === 'approve';
  return { chainId: deployment.chainId, from, to: address(approval ? deployment.token : deployment.escrow),
    value: '0x0', data: (approval ? token : escrow).encodeFunctionData(request.action, args) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/v1-transactions.mjs request.json');
    const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    console.log(JSON.stringify({ network: 'Sepolia testnet', unsigned: true,
      action: request.action, transaction: prepareTransaction(request),
      warning: 'Offline encoding only: review decoded calldata and current on-chain state before signing. No transaction has been sent.' }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
