import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argContractAddress, argBatchId] = process.argv.slice(2);
  const contractAddress = process.env.CONTRACT_ADDRESS ?? argContractAddress;
  const batchIdArg = process.env.BATCH_ID ?? argBatchId;

  if (!contractAddress || !batchIdArg) {
    throw new Error(
      "Set CONTRACT_ADDRESS and BATCH_ID. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 pnpm run batch:status:base",
    );
  }

  const batchId = BigInt(batchIdArg);
  const rollup = await ethers.getContractAt("SimpleOptimisticRollup", contractAddress);
  const batch = await rollup.batches(batchId);

  console.log({
    batchId: batchId.toString(),
    stateRoot: batch.stateRoot,
    txRoot: batch.txRoot,
    submittedAt: batch.submittedAt.toString(),
    challenged: batch.challenged,
    finalized: batch.finalized,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
