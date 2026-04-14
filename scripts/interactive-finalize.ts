import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;

  if (!contractAddress || !batchIdRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS and BATCH_ID. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 pnpm run interactive:finalize:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);

  const [caller] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const tx = await rollup.connect(caller).finalizeBatch(batchId);
  const receipt = await tx.wait();

  console.log("Caller:", caller.address);
  console.log("Finalize tx hash:", tx.hash);
  console.log("Finalize block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
