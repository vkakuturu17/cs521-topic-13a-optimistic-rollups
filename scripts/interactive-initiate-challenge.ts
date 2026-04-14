import { network } from "hardhat";

const { ethers } = await network.connect();

type BatchView = {
  submittedAt: bigint;
  challenged: boolean;
  finalized: boolean;
  invalidated: boolean;
};

type DisputeView = {
  active: boolean;
  resolved: boolean;
};

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const challengerFinalStateRaw = process.env.CHALLENGER_FINAL_STATE;

  if (!contractAddress || !batchIdRaw || !challengerFinalStateRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, BATCH_ID, CHALLENGER_FINAL_STATE. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 CHALLENGER_FINAL_STATE=20 pnpm run interactive:challenge:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);
  const challengerFinalState = BigInt(challengerFinalStateRaw);

  const [challenger] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const challengerBond = (await rollup.getFunction("challengerBond")()) as bigint;

  const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
  const dispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;
  const challengePeriod = (await rollup.getFunction("challengePeriod")()) as bigint;
  const latestBlock = await ethers.provider.getBlock("latest");
  const nowTs = BigInt(latestBlock?.timestamp ?? 0);
  const deadline = batch.submittedAt + challengePeriod;

  console.log("Challenger signer:", challenger.address);
  console.log("Batch status preflight:", {
    submittedAt: batch.submittedAt.toString(),
    now: nowTs.toString(),
    deadline: deadline.toString(),
    challenged: batch.challenged,
    finalized: batch.finalized,
    invalidated: batch.invalidated,
    disputeActive: dispute.active,
    disputeResolved: dispute.resolved,
    challengerBondEth: ethers.formatEther(challengerBond),
  });

  if (nowTs > deadline) {
    throw new Error(
      `Challenge window already closed for batch ${batchId.toString()} (now=${nowTs.toString()}, deadline=${deadline.toString()})`,
    );
  }

  const tx = await rollup
    .connect(challenger)
    .getFunction("initiateChallenge")(batchId, challengerFinalState, { value: challengerBond });
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
