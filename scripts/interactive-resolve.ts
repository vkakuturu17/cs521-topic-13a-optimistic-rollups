import { network } from "hardhat";

const { ethers } = await network.connect();

type DisputeView = {
  sequencerWon: boolean;
  challengerWon: boolean;
};

type BatchView = {
  invalidated: boolean;
  challenged: boolean;
};

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const sequencerPostRaw = process.env.SEQUENCER_CLAIMED_POST_STATE;
  const challengerPostRaw = process.env.CHALLENGER_CLAIMED_POST_STATE;

  if (!contractAddress || !batchIdRaw || !sequencerPostRaw || !challengerPostRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, BATCH_ID, SEQUENCER_CLAIMED_POST_STATE, CHALLENGER_CLAIMED_POST_STATE. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 SEQUENCER_CLAIMED_POST_STATE=17 CHALLENGER_CLAIMED_POST_STATE=18 pnpm run interactive:resolve:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);
  const sequencerClaimedPostState = BigInt(sequencerPostRaw);
  const challengerClaimedPostState = BigInt(challengerPostRaw);

  const [caller] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const tx = await rollup
    .connect(caller)
    .getFunction("resolveSingleStep")(batchId, sequencerClaimedPostState, challengerClaimedPostState);
  const receipt = await tx.wait();

  const dispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;
  const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;

  console.log("Caller:", caller.address);
  console.log("Resolve tx hash:", tx.hash);
  console.log("Resolve block:", receipt?.blockNumber ?? "unknown");
  console.log("sequencerWon:", dispute.sequencerWon);
  console.log("challengerWon:", dispute.challengerWon);
  console.log("batchInvalidated:", batch.invalidated);
  console.log("batchChallenged:", batch.challenged);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
