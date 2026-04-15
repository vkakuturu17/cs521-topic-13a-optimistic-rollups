import { network } from "hardhat";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const { ethers } = await network.connect();

type BatchView = {
  submittedAt: bigint;
  txCount: bigint;
  challenged: boolean;
  finalized: boolean;
  invalidated: boolean;
};

type DisputeView = {
  active: boolean;
  resolved: boolean;
  start: bigint;
  end: bigint;
  sequencerMidSubmitted: boolean;
  challengerMidSubmitted: boolean;
  sequencerSingleStepSubmitted: boolean;
  challengerSingleStepSubmitted: boolean;
  sequencerWon: boolean;
  challengerWon: boolean;
};

function parseDeltas(raw: string): bigint[] {
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => BigInt(x));

  if (items.length === 0) {
    throw new Error("SUBMITTED_DELTAS_CSV must include at least one integer delta");
  }

  return items;
}

function parseDeltasExact(raw: string, expectedLen: number, label: string): bigint[] {
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => BigInt(x));
  if (items.length !== expectedLen) {
    throw new Error(`${label} must include exactly ${expectedLen} values (got ${items.length})`);
  }
  return items;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNum(v: bigint): number {
  return Number(v);
}

async function getNowTs(): Promise<bigint> {
  const latestBlock = await ethers.provider.getBlock("latest");
  return BigInt(latestBlock?.timestamp ?? 0);
}

function claimableMessage(amount: bigint): string {
  return amount > 0n ? `YES (${ethers.formatEther(amount)} ETH)` : "NO (0 ETH)";
}

function computePostStates(initialState: bigint, deltas: bigint[]): bigint[] {
  const postStates: bigint[] = [];
  let state = initialState;
  for (const delta of deltas) {
    state += delta;
    postStates.push(state);
  }
  return postStates;
}

function formatComputation(initialState: bigint, deltasToApply: bigint[]): string {
  const pieces = [initialState.toString(), ...deltasToApply.map((d) => `(${d.toString()})`)];
  const result = deltasToApply.reduce((state, delta) => state + delta, initialState);
  return `${pieces.join(" + ")} = ${result.toString()}`;
}

function formatDeltas(deltas: bigint[]): string {
  return deltas.map((x) => x.toString()).join(",");
}

function printStepDivider(): void {
  console.log("\n----------------------------------------\n");
}

async function waitForUser(label: string, enabled: boolean): Promise<void> {
  if (!enabled) return;
  if (!input.isTTY) {
    console.log(`[step] ${label} (no TTY detected, continuing automatically)`);
    printStepDivider();
    return;
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question(`[step] ${label}. Type yes to continue: `)).trim().toLowerCase();
      if (answer === "yes" || answer === "y") {
        printStepDivider();
        return;
      }
      console.log("Please type yes to continue.");
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const sequencerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const initialStateRaw = process.env.INITIAL_STATE;
  const claimedFinalStateRaw = process.env.CLAIMED_FINAL_STATE;
  const submittedDeltasRaw = process.env.SUBMITTED_DELTAS_CSV;
  const actualUsedDeltasRaw = process.env.ACTUAL_USED_DELTAS_CSV;
  const pollSeconds = Number(process.env.POLL_SECONDS ?? "3");
  const maxPolls = Number(process.env.MAX_POLLS ?? "7200");
  const stepMode = (process.env.STEP_MODE ?? "true").toLowerCase() !== "false";

  if (!contractAddress || !sequencerPrivateKey || !initialStateRaw || !submittedDeltasRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, DEPLOYER_PRIVATE_KEY, INITIAL_STATE, SUBMITTED_DELTAS_CSV. Optional: ACTUAL_USED_DELTAS_CSV, CLAIMED_FINAL_STATE, POLL_SECONDS=3, MAX_POLLS=7200",
    );
  }

  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
    throw new Error("POLL_SECONDS must be a positive number");
  }

  if (!Number.isFinite(maxPolls) || maxPolls <= 0) {
    throw new Error("MAX_POLLS must be a positive number");
  }

  const initialState = BigInt(initialStateRaw);
  const submittedDeltas = parseDeltas(submittedDeltasRaw);

  const actualUsedDeltas = actualUsedDeltasRaw
    ? parseDeltasExact(actualUsedDeltasRaw, submittedDeltas.length, "ACTUAL_USED_DELTAS_CSV")
    : submittedDeltas;
  const claimedPostStates = computePostStates(initialState, actualUsedDeltas);
  const claimedDerivedFinalState = claimedPostStates[claimedPostStates.length - 1];

  const claimedFinalState = claimedFinalStateRaw ? BigInt(claimedFinalStateRaw) : claimedDerivedFinalState;
  const disputePostStates = [...claimedPostStates];
  if (claimedFinalState !== claimedDerivedFinalState && disputePostStates.length > 0) {
    disputePostStates[disputePostStates.length - 1] = claimedFinalState;
  }

  const sequencer = new ethers.Wallet(sequencerPrivateKey, ethers.provider);
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const sequencerBond = (await rollup.getFunction("sequencerBond")()) as bigint;
  const challengePeriod = (await rollup.getFunction("challengePeriod")()) as bigint;

  console.log("Sequencer:", sequencer.address);
  console.log("Contract:", contractAddress);
  console.log("Batch deltas to submit:", formatDeltas(submittedDeltas));
  console.log("Deltas used for sequencer assertion path:", formatDeltas(actualUsedDeltas));
  console.log("Assertion-path computation:", formatComputation(initialState, actualUsedDeltas));
  console.log("submitBatch final-state argument:", claimedFinalState.toString());
  printStepDivider();

  await waitForUser("Sequencer will submit batch", stepMode);

  const submitTx = await rollup
    .connect(sequencer)
    .getFunction("submitBatch")(initialState, claimedFinalState, submittedDeltas, { value: sequencerBond });
  const submitReceipt = await submitTx.wait();
  const batchId = (await rollup.getFunction("latestBatchId")()) as bigint;

  console.log("Submit tx:", submitTx.hash);
  console.log("Submit block:", submitReceipt?.blockNumber ?? "unknown");
  console.log("Batch ID:", batchId.toString());

  let lastObservedRange: string | undefined;
  let lastWaitMessage: string | undefined;

  for (let poll = 1; poll <= maxPolls; poll++) {
    const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
    const dispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;
    const nowTs = await getNowTs();
    const deadline = batch.submittedAt + challengePeriod;
    const canFinalizeByTime = nowTs >= deadline;

    if (!dispute.active) {
      const winner = dispute.challengerWon ? "challenger" : dispute.sequencerWon ? "sequencer" : "none";
      console.log(`\n[Poll ${poll}]`);
      console.log(
        `Time: now ${nowTs.toString()}, deadline ${deadline.toString()} (${canFinalizeByTime ? "can finalize by time" : "still in challenge window"})`,
      );
      console.log(
        `Batch: challenged=${batch.challenged}, finalized=${batch.finalized}, invalidated=${batch.invalidated}`,
      );
      console.log(
        `Dispute: active=${dispute.active}, resolved=${dispute.resolved}, range=${dispute.start.toString()}..${dispute.end.toString()}, winner=${winner}`,
      );
      lastWaitMessage = undefined;
    }

    if (dispute.active) {
      const range = `${dispute.start.toString()}..${dispute.end.toString()}`;
      if (range !== lastObservedRange) {
        lastObservedRange = range;
        if (dispute.start < dispute.end) {
          const mid = (dispute.start + dispute.end) / 2n;
          const midIdx = toNum(mid);
          const seqMid = disputePostStates[midIdx];
          const challengerMidSubmittedText = dispute.challengerMidSubmitted
            ? "challenger midpoint claim submitted"
            : "waiting for challenger midpoint claim";
          console.log(
            `Challenge proof detected. Current disputed range is ${range}; calculating midpoint index ${mid.toString()}.`,
          );
          console.log("Sequencer midpoint math:", {
            range,
            mid: mid.toString(),
            sequencerStateAtMid: seqMid.toString(),
            expression: formatComputation(initialState, actualUsedDeltas.slice(0, midIdx + 1)),
            onChainComparison: `${seqMid.toString()} vs challengerMidpointClaim -> next range determined on-chain`,
            whereCompared: "Compared on-chain in DisputeBisected round advancement when both claims are submitted",
            status: challengerMidSubmittedText,
          });
        } else {
          const idx = toNum(dispute.start);
          const preState = idx === 0 ? initialState : disputePostStates[idx - 1];
          const delta = submittedDeltas[idx];
          const sequencerPost = disputePostStates[idx];
          console.log(
            `Challenge narrowed to single-step at tx index ${idx.toString()}. Calculating claimed post-state and preparing single-step claim.`,
          );
          console.log("Sequencer single-step math:", {
            disputedIndex: idx.toString(),
            preState: preState.toString(),
            claimedDelta: actualUsedDeltas[idx].toString(),
            submittedDelta: delta.toString(),
            sequencerClaimedPostState: sequencerPost.toString(),
            computation: `${preState.toString()} + (${actualUsedDeltas[idx].toString()}) = ${sequencerPost.toString()}`,
            onChainComparison: `${sequencerPost.toString()} vs challengerSingleStepClaim against expected post-state`,
            whereCompared: "Compared on-chain in single-step resolver once both claims are submitted",
          });
        }
      }

      if (dispute.start < dispute.end && dispute.sequencerMidSubmitted) {
        const waitMessage = "Waiting for challenger midpoint claim...";
        if (waitMessage !== lastWaitMessage) {
          console.log(waitMessage);
          lastWaitMessage = waitMessage;
        }
        await waitMs(pollSeconds * 1000);
        continue;
      }

      if (dispute.start < dispute.end && !dispute.sequencerMidSubmitted) {
        lastWaitMessage = undefined;
        const mid = (dispute.start + dispute.end) / 2n;
        const midIdx = toNum(mid);
        const sequencerMid = disputePostStates[midIdx];

        console.log("Sequencer turn: sending midpoint claim now.");
        console.log("Sequencer midpoint claim payload:", {
          range,
          mid: mid.toString(),
          sequencerStateAtMid: sequencerMid.toString(),
          expression: formatComputation(initialState, actualUsedDeltas.slice(0, midIdx + 1)),
          onChainComparison: `${sequencerMid.toString()} vs challengerMidpointClaim`,
          whereCompared: "Compared on-chain in DisputeBisected round advancement when both claims are submitted",
        });

        await waitForUser("Sequencer will submit submitSequencerMidpointClaim", stepMode);
        const tx = await rollup
          .connect(sequencer)
          .getFunction("submitSequencerMidpointClaim")(batchId, sequencerMid);
        const receipt = await tx.wait();
        console.log("Sequencer midpoint claim tx:", tx.hash);
        console.log("Sequencer midpoint claim block:", receipt?.blockNumber ?? "unknown");
        await waitMs(pollSeconds * 1000);
        continue;
      }

      if (dispute.start === dispute.end && !dispute.sequencerSingleStepSubmitted) {
        lastWaitMessage = undefined;
        const idx = toNum(dispute.start);
        const preState = idx === 0 ? initialState : disputePostStates[idx - 1];
        const delta = submittedDeltas[idx];
        const sequencerPost = disputePostStates[idx];

        console.log("Sequencer turn: sending single-step claim now.");
        console.log("Sequencer single-step claim payload:", {
          disputedIndex: idx.toString(),
          preState: preState.toString(),
          claimedDelta: actualUsedDeltas[idx].toString(),
          submittedDelta: delta.toString(),
          sequencerClaimedPostState: sequencerPost.toString(),
          expression: `${preState.toString()} + (${actualUsedDeltas[idx].toString()}) = ${sequencerPost.toString()}`,
          onChainComparison: `${sequencerPost.toString()} vs challengerSingleStepClaim against expected post-state`,
          whereCompared: "Compared on-chain in single-step resolver once both claims are submitted",
        });

        await waitForUser("Sequencer will submit submitSequencerSingleStepClaim", stepMode);
        const tx = await rollup
          .connect(sequencer)
          .getFunction("submitSequencerSingleStepClaim")(batchId, sequencerPost);
        const receipt = await tx.wait();
        console.log("Sequencer single-step claim tx:", tx.hash);
        console.log("Sequencer single-step claim block:", receipt?.blockNumber ?? "unknown");
        await waitMs(pollSeconds * 1000);
        continue;
      }

      if (dispute.start === dispute.end && dispute.sequencerSingleStepSubmitted) {
        const waitMessage = "Waiting for challenger single-step claim...";
        if (waitMessage !== lastWaitMessage) {
          console.log(waitMessage);
          lastWaitMessage = waitMessage;
        }
        await waitMs(pollSeconds * 1000);
        continue;
      }
    }

    if (batch.finalized) {
      console.log("Batch already finalized.");
      const claimable = (await rollup.getFunction("claimableBalances")(sequencer.address)) as bigint;
      console.log("Final result:", {
        outcome: "finalized",
        sequencerClaimable: claimableMessage(claimable),
      });
      return;
    }

    if (batch.invalidated || dispute.challengerWon) {
      const claimable = (await rollup.getFunction("claimableBalances")(sequencer.address)) as bigint;
      console.log("Final result:", {
        outcome: "challenger-won-batch-invalidated",
        sequencerClaimable: claimableMessage(claimable),
      });
      return;
    }

    if (dispute.active && !dispute.resolved) {
      await waitMs(pollSeconds * 1000);
      continue;
    }

    if (!canFinalizeByTime) {
      await waitMs(pollSeconds * 1000);
      continue;
    }

    try {
      await waitForUser("Sequencer will attempt finalizeBatch", stepMode);
      const finalizeTx = await rollup.connect(sequencer).getFunction("finalizeBatch")(batchId);
      const finalizeReceipt = await finalizeTx.wait();
      console.log("Finalize tx:", finalizeTx.hash);
      console.log("Finalize block:", finalizeReceipt?.blockNumber ?? "unknown");

      const claimable = (await rollup.getFunction("claimableBalances")(sequencer.address)) as bigint;
      console.log("Final result:", {
        outcome: "sequencer-won-or-unchallenged-finalized",
        sequencerClaimable: claimableMessage(claimable),
      });
      return;
    } catch (error) {
      if (error instanceof Error) {
        console.log("Finalize attempt skipped:", error.message);
      }
    }

    await waitMs(pollSeconds * 1000);
  }

  throw new Error(`Reached MAX_POLLS=${maxPolls} without terminal outcome`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
