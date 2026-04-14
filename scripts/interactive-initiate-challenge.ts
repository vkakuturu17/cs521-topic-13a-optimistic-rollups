import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const challengerFinalStateRaw = process.env.CHALLENGER_FINAL_STATE;

  if (!contractAddress || !batchIdRaw || !challengerFinalStateRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, BATCH_ID, CHALLENGER_FINAL_STATE. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 CHALLENGER_FINAL_STATE=20 CHALLENGER_BOND_ETH=0.005 pnpm run interactive:challenge:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);
  const challengerFinalState = BigInt(challengerFinalStateRaw);
  const challengerBondEth = process.env.CHALLENGER_BOND_ETH ?? "0.005";
  const challengerBond = ethers.parseEther(challengerBondEth);

  const [challenger] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const tx = await rollup
    .connect(challenger)
    .initiateChallenge(batchId, challengerFinalState, { value: challengerBond });
  const receipt = await tx.wait();

  console.log("Challenger:", challenger.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", batchId.toString());
  console.log("Challenge tx hash:", tx.hash);
  console.log("Challenge block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
