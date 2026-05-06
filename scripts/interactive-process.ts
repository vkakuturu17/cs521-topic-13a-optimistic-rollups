import { network } from "hardhat";

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

function stateToHash(state: bigint): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(abi.encode(["int256"], [state]));
}

function pickSignerByAddress(signers: Awaited<ReturnType<typeof ethers.getSigners>>, address: string) {
  return signers.find((s) => s.address.toLowerCase() === address.toLowerCase()) ?? null;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS ?? process.env.ROLLUP_CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const sequencerPrivateKey = process.env.SEQUENCER_PRIVATE_KEY;
  const challengerPrivateKey = process.env.CHALLENGER_PRIVATE_KEY;

  if (!contractAddress || !batchIdRaw) {
    throw new Error("Set CONTRACT_ADDRESS (or ROLLUP_CONTRACT_ADDRESS) and BATCH_ID.");
  }

  const batchId = BigInt(batchIdRaw);
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const signers = await ethers.getSigners();

  const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
  const dispute = (await rollup.getFunction("getDispute")(batchId)) as DisputeView;

  if (!dispute.active || dispute.resolved) {
    console.log("No active unresolved dispute for this batch.");
    console.log({ active: dispute.active, resolved: dispute.resolved, sequencerWon: dispute.sequencerWon, challengerWon: dispute.challengerWon });
    return;
  }

  if (dispute.endStep > dispute.startStep + 1n) {
    const midpoint = (dispute.startStep + dispute.endStep) / 2n;

    const sequencerTurn = !dispute.sequencerMidSubmitted;
    const expectedActor = sequencerTurn ? batch.sequencer : dispute.challenger;

    const stateRaw = sequencerTurn ? process.env.SEQUENCER_MID_STATE : process.env.CHALLENGER_MID_STATE;
    const hashRaw = sequencerTurn ? process.env.SEQUENCER_MID_HASH : process.env.CHALLENGER_MID_HASH;

    if (!stateRaw && !hashRaw) {
      throw new Error(
        sequencerTurn
          ? "Sequencer turn: set SEQUENCER_MID_STATE or SEQUENCER_MID_HASH."
          : "Challenger turn: set CHALLENGER_MID_STATE or CHALLENGER_MID_HASH.",
      );
    }

    const midpointHash = hashRaw ?? stateToHash(BigInt(stateRaw!));

    let actor = pickSignerByAddress(signers, expectedActor) ?? signers[0];
    if (sequencerTurn && sequencerPrivateKey) {
      actor = new ethers.Wallet(sequencerPrivateKey, ethers.provider);
    }
    if (!sequencerTurn && challengerPrivateKey) {
      actor = new ethers.Wallet(challengerPrivateKey, ethers.provider);
    }

    const tx = await rollup.connect(actor).getFunction("submitMidpointHash")(batchId, midpointHash);
    const receipt = await tx.wait();

    const next = (await rollup.getFunction("getDispute")(batchId)) as DisputeView;

    console.log("Action:", "submitMidpointHash");
    console.log("Actor:", actor.address);
    console.log("Expected actor:", expectedActor);
    console.log("Batch ID:", batchId.toString());
    console.log("Midpoint step:", midpoint.toString());
    console.log("Submitted midpoint hash:", midpointHash);
    console.log("Tx hash:", tx.hash);
    console.log("Block:", receipt?.blockNumber ?? "unknown");
    console.log("New dispute range:", `[${next.startStep.toString()}, ${next.endStep.toString()})`);
    console.log(
      "Next:",
      next.endStep > next.startStep + 1n
        ? !next.sequencerMidSubmitted
          ? "sequencer submits next midpoint"
          : "challenger submits midpoint for current round"
        : "set PRE_STATE_HASH (or PRE_STATE) and run interactive:process:* to resolve one step",
    );
    return;
  }

  const preStateRaw = process.env.PRE_STATE;
  const preStateHashRaw = process.env.PRE_STATE_HASH;
  if (!preStateRaw && !preStateHashRaw) {
    throw new Error("Single-step dispute reached. Set PRE_STATE_HASH (or PRE_STATE) and rerun interactive:process:*. ");
  }

  const preStateHash = preStateHashRaw ?? stateToHash(BigInt(preStateRaw!));
  let resolver = pickSignerByAddress(signers, batch.sequencer) ?? signers[0];
  if (sequencerPrivateKey) {
    resolver = new ethers.Wallet(sequencerPrivateKey, ethers.provider);
  }

  const tx = await rollup.connect(resolver).getFunction("resolveOneStep")(batchId, preStateHash);
  const receipt = await tx.wait();

  const finalDispute = (await rollup.getFunction("getDispute")(batchId)) as DisputeView;
  const finalBatch = (await rollup.getFunction("batches")(batchId)) as BatchView;

  console.log("Action:", "resolveOneStep");
  console.log("Resolver:", resolver.address);
  console.log("Batch ID:", batchId.toString());
  console.log("Pre-state hash:", preStateHash);
  console.log("Tx hash:", tx.hash);
  console.log("Block:", receipt?.blockNumber ?? "unknown");
  console.log({
    sequencerWon: finalDispute.sequencerWon,
    challengerWon: finalDispute.challengerWon,
    resolved: finalDispute.resolved,
    batchInvalidated: finalBatch.invalidated,
    batchChallenged: finalBatch.challenged,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
