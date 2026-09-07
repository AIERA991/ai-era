import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { BrowserProvider, Contract, ContractFactory, parseUnits } from 'ethers';

export const units = value => parseUnits(String(value), 8);
export async function localChain(artifacts) {
  const hre = await createHardhatRuntimeEnvironment({ networks: {
    local: { type: 'edr-simulated', chainId: 1337, hardfork: 'shanghai' }
  }});
  const connection = await hre.network.create('local');
  const rpc = connection.provider;
  const provider = new BrowserProvider(rpc);
  provider.pollingInterval = 10;
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const factory = new ContractFactory(artifacts.AIEra.abi, artifacts.AIEra.bytecode, signers[0]);
  const token = await factory.deploy(...addresses.slice(1, 5));
  await token.waitForDeployment();
  const vesting = new Contract(await token.developerVesting(), artifacts.DeveloperVesting.abi, signers[0]);
  const escrowFactory = new ContractFactory(artifacts.AITaskEscrow.abi, artifacts.AITaskEscrow.bytecode, signers[0]);
  const escrow = await escrowFactory.deploy(await token.getAddress());
  await escrow.waitForDeployment();
  return { rpc, provider, signers, addresses, token, vesting, escrow,
    async now() { return Number((await rpc.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })).timestamp); },
    async advance(seconds) {
      await rpc.request({ method: 'evm_increaseTime', params: [seconds] });
      await rpc.request({ method: 'evm_mine', params: [] });
    },
    async close() { provider.destroy(); await connection.close(); }
  };
}
