import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const accountAddress = process.env.ACCOUNT_ADDRESS;

  if (!contractAddress || !batchIdRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS and BATCH_ID. Optional ACCOUNT_ADDRESS for claimable balance. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 pnpm run interactive:status:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const batch = await rollup.batches(batchId);
  const dispute = await rollup.disputes(batchId);

  console.log("Batch:", {
    sequencer: batch.sequencer,
    initialState: batch.initialState.toString(),
    claimedFinalState: batch.claimedFinalState.toString(),
    submittedAt: batch.submittedAt.toString(),
    txCount: batch.txCount.toString(),
    challenged: batch.challenged,
    finalized: batch.finalized,
    invalidated: batch.invalidated,
    bondSettled: batch.bondSettled,
  });

  console.log("Dispute:", {
    challenger: dispute.challenger,
    active: dispute.active,
    resolved: dispute.resolved,
    start: dispute.start.toString(),
    end: dispute.end.toString(),
    sequencerFinalState: dispute.sequencerFinalState.toString(),
    challengerFinalState: dispute.challengerFinalState.toString(),
    sequencerWon: dispute.sequencerWon,
    challengerWon: dispute.challengerWon,
  });

  if (accountAddress) {
    const claimable = await rollup.claimableBalances(accountAddress);
    console.log("Claimable balance for account:", accountAddress, ethers.formatEther(claimable), "ETH");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
