import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argContractAddress, argBatchId, argReason] = process.argv.slice(2);
  const contractAddress = process.env.CONTRACT_ADDRESS ?? argContractAddress;
  const batchIdArg = process.env.BATCH_ID ?? argBatchId;
  const reason = process.env.CHALLENGE_REASON ?? argReason ?? "fraud-proof-placeholder";

  if (!contractAddress || !batchIdArg) {
    throw new Error(
      "Set CONTRACT_ADDRESS and BATCH_ID (optional CHALLENGE_REASON). Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 pnpm run challenger:challenge:base",
    );
  }

  const batchId = BigInt(batchIdArg);
  const [, challenger] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("SimpleOptimisticRollup", contractAddress);

  const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reason));
  const tx = await rollup.connect(challenger).challengeBatch(batchId, reasonHash);
  const receipt = await tx.wait();

  console.log("Challenger:", challenger.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", batchId.toString());
  console.log("Reason hash:", reasonHash);
  console.log("Challenge tx hash:", tx.hash);
  console.log("Challenge block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
