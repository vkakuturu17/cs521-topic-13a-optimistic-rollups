import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argContractAddress, argBatchId] = process.argv.slice(2);
  const contractAddress = process.env.CONTRACT_ADDRESS ?? argContractAddress;
  const batchIdArg = process.env.BATCH_ID ?? argBatchId;

  if (!contractAddress || !batchIdArg) {
    throw new Error(
      "Set CONTRACT_ADDRESS and BATCH_ID. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 pnpm run finalize:batch:base",
    );
  }

  const batchId = BigInt(batchIdArg);
  const [sequencer] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("SimpleOptimisticRollup", contractAddress);

  const tx = await rollup.connect(sequencer).finalizeBatch(batchId);
  const receipt = await tx.wait();

  console.log("Finalized batch:", batchId.toString());
  console.log("Finalize tx hash:", tx.hash);
  console.log("Finalize block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
