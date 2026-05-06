import { network } from "hardhat";
import { readChallengerInstructionsFromEnv } from "./utils/instructions.js";

const { ethers } = await network.connect();

type BatchView = {
  sequencer: string;
  previousStateHash: string;
  claimedPostStateHash: string;
  instructionCommitment: string;
  submittedAt: bigint;
  instructionCount: bigint;
  challenged: boolean;
  finalized: boolean;
  invalidated: boolean;
  bondSettled: boolean;
};

type DisputeView = {
  challenger: string;
  active: boolean;
  resolved: boolean;
  startStep: bigint;
  endStep: bigint;
  agreedStartHash: string;
  sequencerEndHash: string;
  challengerEndHash: string;
  sequencerMidSubmitted: boolean;
  challengerMidSubmitted: boolean;
  sequencerMidHash: string;
  challengerMidHash: string;
  sequencerWon: boolean;
  challengerWon: boolean;
};

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS ?? process.env.ROLLUP_CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const challengerClaimedPostStateHashRaw =
    process.env.CHALLENGER_CLAIMED_POST_STATE_HASH ?? process.env.CHALLENGER_CLAIMED_POST_STATE_ROOT;
  const challengerPrivateKey = process.env.CHALLENGER_PRIVATE_KEY;

  if (!contractAddress) {
    throw new Error(
      "Set CONTRACT_ADDRESS (or ROLLUP_CONTRACT_ADDRESS). Optional BATCH_ID (defaults to latest batch).",
    );
  }

  const deltas = readChallengerInstructionsFromEnv();
  const abi = ethers.AbiCoder.defaultAbiCoder();

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer available. Configure DEPLOYER_PRIVATE_KEY (and optional CHALLENGER_PRIVATE_KEY). ");
  }

  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const challengerBond = (await rollup.getFunction("challengerBond")()) as bigint;
  const latestBatchId = (await rollup.getFunction("latestBatchId")()) as bigint;
  if (latestBatchId === 0n && batchIdRaw === undefined) {
    throw new Error("No batches exist yet. Submit a batch first or provide BATCH_ID explicitly.");
  }

  const batchId = batchIdRaw !== undefined ? BigInt(batchIdRaw) : latestBatchId;
  const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
  const challengePeriod = (await rollup.getFunction("challengePeriod")()) as bigint;
  const latestBlock = await ethers.provider.getBlock("latest");
  const nowTs = BigInt(latestBlock?.timestamp ?? 0);
  const deadline = batch.submittedAt + challengePeriod;

  if (BigInt(deltas.length) !== batch.instructionCount) {
    throw new Error(
      `Revealed instruction length ${deltas.length} must match on-chain instructionCount ${batch.instructionCount.toString()}.`,
    );
  }

  const revealedCommitment = ethers.keccak256(abi.encode(["int256[]"], [deltas]));
  if (revealedCommitment !== batch.instructionCommitment) {
    throw new Error(
      `Revealed instruction commitment mismatch. expected=${batch.instructionCommitment} actual=${revealedCommitment}`,
    );
  }

  if (nowTs > deadline) {
    throw new Error(
      `Challenge window already closed for batch ${batchId.toString()} (now=${nowTs.toString()}, deadline=${deadline.toString()})`,
    );
  }

  let recomputedPostStateHash = batch.previousStateHash;
  for (const d of deltas) {
    recomputedPostStateHash = ethers.keccak256(abi.encode(["bytes32", "int256"], [recomputedPostStateHash, d]));
  }

  const challengerClaimedPostStateHash = challengerClaimedPostStateHashRaw ?? recomputedPostStateHash;

  let challenger = signers.find((s) => s.address.toLowerCase() !== batch.sequencer.toLowerCase()) ?? signers[0];
  if (challengerPrivateKey && challengerPrivateKey.length > 0) {
    challenger = new ethers.Wallet(challengerPrivateKey, ethers.provider);
  }

  const tx = await rollup
    .connect(challenger)
    .getFunction("challengeBatch")(batchId, deltas, challengerClaimedPostStateHash, { value: challengerBond });
  const receipt = await tx.wait();

  const dispute = (await rollup.getFunction("getDispute")(batchId)) as DisputeView;

  console.log("Challenger signer:", challenger.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", batchId.toString());
  console.log("Revealed instruction commitment:", revealedCommitment);
  console.log("On-chain instruction commitment:", batch.instructionCommitment);
  console.log("Recomputed post-state hash:", recomputedPostStateHash);
  console.log("Challenger claimed post-state hash:", challengerClaimedPostStateHash);
  console.log("Sequencer claimed post-state hash:", batch.claimedPostStateHash);
  console.log("Fraud detected (local recomputation):", recomputedPostStateHash !== batch.claimedPostStateHash);
  console.log("Challenge tx hash:", tx.hash);
  console.log("Challenge block:", receipt?.blockNumber ?? "unknown");
  console.log("Dispute range:", `[${dispute.startStep.toString()}, ${dispute.endStep.toString()})`);
  console.log(
    "Next:",
    dispute.endStep > dispute.startStep + 1n
      ? `submit midpoint hash for step ${(dispute.startStep + dispute.endStep) / 2n} using interactive:process:*`
      : "call resolveOneStep using interactive:process:* with PRE_STATE",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
