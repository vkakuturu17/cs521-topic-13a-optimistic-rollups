import { network } from "hardhat";

const { ethers } = await network.connect();

function hashState(state: bigint): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["int256"], [state]));
}

function deriveTrace(initialState: bigint, instructions: bigint[]): string[] {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const hashes: string[] = [hashState(initialState)];
  for (const instruction of instructions) {
    hashes.push(ethers.keccak256(abi.encode(["bytes32", "int256"], [hashes[hashes.length - 1], instruction])));
  }
  return hashes;
}

async function main() {
  const [sequencer, challenger] = await ethers.getSigners();
  const challengePeriod = 300;
  const sequencerBond = ethers.parseEther("1");
  const challengerBond = ethers.parseEther("0.5");

  const rollup = await ethers.deployContract("InteractiveOptimisticRollup", [challengePeriod, sequencerBond, challengerBond]);
  await rollup.waitForDeployment();

  const instructions = [5n, -2n, 4n, 1n];
  const trace = deriveTrace(10n, instructions);
  const instructionCommitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["int256[]"], [instructions]));

  await rollup.connect(sequencer).submitBatch(trace[0], hashState(999n), instructionCommitment, instructions.length, {
    value: sequencerBond,
  });

  await rollup.connect(challenger).challengeBatch(1, instructions, trace[4], { value: challengerBond });

  await rollup.connect(sequencer).submitMidpointHash(1, trace[2]);
  await rollup.connect(challenger).submitMidpointHash(1, trace[2]);
  await rollup.connect(sequencer).submitMidpointHash(1, hashState(777n));
  await rollup.connect(challenger).submitMidpointHash(1, trace[3]);
  await rollup.connect(challenger).resolveOneStep(1, trace[2]);

  const dispute = await rollup.getDispute(1);
  const batch = await rollup.batches(1);

  console.log("Scenario:", "Sequencer fraud / Challenger honest");
  console.log("Contract:", await rollup.getAddress());
  console.log("Dispute resolved:", dispute.resolved);
  console.log("Challenger won:", dispute.challengerWon);
  console.log("Sequencer won:", dispute.sequencerWon);
  console.log("Batch invalidated:", batch.invalidated);
  console.log("Challenger reward ETH:", ethers.formatEther(await rollup.claimableBalances(challenger.address)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
