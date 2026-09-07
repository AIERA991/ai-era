import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function compile() {
  const sources = Object.fromEntries(fs.readdirSync(path.join(root, 'contracts'))
    .filter(name => name.endsWith('.sol'))
    .map(name => [name, { content: fs.readFileSync(path.join(root, 'contracts', name), 'utf8') }]));
  const input = { language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } }
  }};
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: name => {
    const resolved = path.resolve(root, 'node_modules', name);
    if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) return { error: 'Invalid import' };
    try { return { contents: fs.readFileSync(resolved, 'utf8') }; }
    catch { return { error: `Missing import: ${name}` }; }
  }}));
  for (const error of output.errors ?? []) {
    if (error.severity === 'error') throw new Error(error.formattedMessage);
    console.warn(error.formattedMessage);
  }
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const artifacts = {};
  for (const name of ['AIEra', 'DeveloperVesting', 'AITaskEscrow', 'AIVerifiedEscrow', 'LinearInferenceVerifier']) {
    const contract = output.contracts[`${name}.sol`][name];
    artifacts[name] = { contractName: name, compiler: solc.version(),
      evmVersion: 'paris', abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
      deployedBytecode: `0x${contract.evm.deployedBytecode.object}` };
    fs.writeFileSync(path.join(root, 'artifacts', `${name}.json`), JSON.stringify(artifacts[name], null, 2));
  }
  fs.writeFileSync(path.join(root, 'artifacts', 'compiler-input.json'), JSON.stringify(input, null, 2));
  return artifacts;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = compile();
  for (const [name, artifact] of Object.entries(artifacts)) {
    console.log(`${name}: ${(artifact.deployedBytecode.length - 2) / 2} deployed bytes`);
  }
  console.log('Compiled for local EVM testing. These are NOT verified TRON/TVM deployment artifacts.');
}
