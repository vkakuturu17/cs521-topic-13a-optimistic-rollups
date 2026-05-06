import { network } from "hardhat";
import { readChallengerInstructionsFromEnv } from "./utils/instructions.js";

const { ethers } = await network.connect();

type BatchView = {
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

  if (!contractAddress) {
    throw new Error("Set CONTRACT_ADDRESS (or ROLLUP_CONTRACT_ADDRESS). Optional: BATCH_ID");
  }

  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const latestBatchId = (await rollup.getFunction("latestBatchId")()) as bigint;
  const batchId = batchIdRaw !== undefined ? BigInt(batchIdRaw) : latestBatchId;

  if (batchId === 0n) {
    throw new Error("No batches exist yet.");
  }

  const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
  const deltas = readChallengerInstructionsFromEnv();
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const revealedInstructionCommitment = ethers.keccak256(abi.encode(["int256[]"], [deltas]));

  let recomputedPostStateHash = batch.previousStateHash;
  for (const d of deltas) {
    recomputedPostStateHash = ethers.keccak256(abi.encode(["bytes32", "int256"], [recomputedPostStateHash, d]));
  }

  console.log("Contract:", contractAddress);
  console.log("Batch ID:", batchId.toString());
  console.log("Instructions used for verification:", deltas.map((d) => d.toString()).join(","));
  console.log("On-chain instructionCount:", batch.instructionCount.toString());
  console.log("On-chain previousStateHash:", batch.previousStateHash);
  console.log("On-chain instructionCommitment:", batch.instructionCommitment);
  console.log("Revealed instructionCommitment:", revealedInstructionCommitment);
  console.log("On-chain claimedPostStateHash:", batch.claimedPostStateHash);
  console.log("Recomputed post-state hash:", recomputedPostStateHash);
  console.log("Claim check:", {
    commitmentMatch: revealedInstructionCommitment === batch.instructionCommitment,
    postStateHashMismatch: recomputedPostStateHash !== batch.claimedPostStateHash,
    fraudProvable:
      revealedInstructionCommitment === batch.instructionCommitment &&
      recomputedPostStateHash !== batch.claimedPostStateHash,
  });

  try {
    const dispute = (await rollup.getFunction("getDispute")(batchId)) as DisputeView;
    console.log("Dispute:", {
      challenger: dispute.challenger,
      active: dispute.active,
      resolved: dispute.resolved,
      startStep: dispute.startStep.toString(),
      endStep: dispute.endStep.toString(),
      sequencerWon: dispute.sequencerWon,
      challengerWon: dispute.challengerWon,
    });
  } catch {
    console.log("Dispute: none or not initialized");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
