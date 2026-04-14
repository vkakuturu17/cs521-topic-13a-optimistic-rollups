import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!contractAddress) {
    throw new Error("Set CONTRACT_ADDRESS. Example: CONTRACT_ADDRESS=0x... pnpm run interactive:withdraw:base-sepolia");
  }

  const [caller] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const tx = await rollup.connect(caller).withdrawClaimable();
  const receipt = await tx.wait();

  console.log("Caller:", caller.address);
  console.log("Withdraw tx hash:", tx.hash);
  console.log("Withdraw block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
