import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argContractAddress, argLabel] = process.argv.slice(2);
  const contractAddress = process.env.CONTRACT_ADDRESS ?? argContractAddress;
  const label = process.env.BATCH_LABEL ?? argLabel ?? `batch-${Date.now()}`;

  if (!contractAddress) {
    throw new Error(
      "Set CONTRACT_ADDRESS (and optional BATCH_LABEL). Example: CONTRACT_ADDRESS=0x... BATCH_LABEL=demo1 pnpm run sequencer:submit:base",
    );
  }

  const [sequencer] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("SimpleOptimisticRollup", contractAddress);

  const stateRoot = ethers.keccak256(ethers.toUtf8Bytes(`state-${label}`));
  const txRoot = ethers.keccak256(ethers.toUtf8Bytes(`tx-${label}`));

  const tx = await rollup.connect(sequencer).submitBatch(stateRoot, txRoot);
  const receipt = await tx.wait();

  const latestBatchId = await rollup.latestBatchId();
  console.log("Sequencer:", sequencer.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", latestBatchId.toString());
  console.log("State root:", stateRoot);
  console.log("Tx root:", txRoot);
  console.log("Submit tx hash:", tx.hash);
  console.log("Submit block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
