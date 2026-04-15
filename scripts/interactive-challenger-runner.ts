import { network } from "hardhat";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const { ethers } = await network.connect();

type BatchView = {
  submittedAt: bigint;
  initialState: bigint;
  claimedFinalState: bigint;
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
  mid: bigint;
  sequencerStateAtMid: bigint;
  challengerStateAtMid: bigint;
  sequencerMidSubmitted: boolean;
  challengerMidSubmitted: boolean;
  sequencerSingleStepPostState: bigint;
  challengerSingleStepPostState: bigint;
  sequencerSingleStepSubmitted: boolean;
  challengerSingleStepSubmitted: boolean;
  sequencerWon: boolean;
  challengerWon: boolean;
};

function parseDeltas(raw: string, expectedLen: number, label: string): bigint[] {
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => BigInt(x));

  if (items.length !== expectedLen) {
    throw new Error(
      `${label} must include exactly txCount values (got ${items.length}, expected ${expectedLen})`,
    );
  }

  return items;
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

function countDifferences(a: bigint[], b: bigint[]): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) count++;
  }
  return count;
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

function revertSelector(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeData = (error as { data?: unknown }).data;
  if (typeof maybeData === "string" && maybeData.startsWith("0x") && maybeData.length >= 10) {
    return maybeData.slice(0, 10).toLowerCase();
  }
  return undefined;
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
  const batchIdRaw = process.env.BATCH_ID;
  const challengerPrivateKey = process.env.CHALLENGER_PRIVATE_KEY;
  const challengerDeltasRaw = process.env.CHALLENGER_DELTAS_CSV;
  const challengerWrongDeltasRaw = process.env.CHALLENGER_WRONG_DELTAS;
  const pollSeconds = Number(process.env.POLL_SECONDS ?? "3");
  const maxPolls = Number(process.env.MAX_POLLS ?? "7200");
  const stepMode = (process.env.STEP_MODE ?? "true").toLowerCase() !== "false";

  if (!contractAddress || !batchIdRaw || !challengerPrivateKey) {
    throw new Error(
      "Set CONTRACT_ADDRESS, BATCH_ID, and CHALLENGER_PRIVATE_KEY. Optional: CHALLENGER_WRONG_DELTAS, CHALLENGER_DELTAS_CSV, POLL_SECONDS=3, MAX_POLLS=7200",
    );
  }

  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
    throw new Error("POLL_SECONDS must be a positive number");
  }

  if (!Number.isFinite(maxPolls) || maxPolls <= 0) {
    throw new Error("MAX_POLLS must be a positive number");
  }

  const batchId = BigInt(batchIdRaw);
  const challenger = new ethers.Wallet(challengerPrivateKey, ethers.provider);
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const challengerBond = (await rollup.getFunction("challengerBond")()) as bigint;
  const challengePeriod = (await rollup.getFunction("challengePeriod")()) as bigint;

  console.log("Challenger:", challenger.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", batchId.toString());

  let sequencerPostStates: bigint[] | undefined;
  let challengerPostStates: bigint[] | undefined;
  let sequencerDeltasForBatch: bigint[] | undefined;
  let challengerDeltasForBatch: bigint[] | undefined;
  let challengerFinalState: bigint | undefined;
  let sequencerDerivedFinalState: bigint | undefined;
  let sequencerClaimedFinalMismatch: boolean | undefined;
  let disagreementCount: number | undefined;
  let challengeSubmitted = false;
  let lastObservedRange: string | undefined;
  let lastWaitMessage: string | undefined;
  let lastSingleStepSnapshot: string | undefined;

  for (let poll = 1; poll <= maxPolls; poll++) {
    const batch = (await rollup.getFunction("batches")(batchId)) as BatchView;
    if (batch.submittedAt === 0n) {
      console.log(`Poll ${poll}: batch not found yet, waiting...`);
      await waitMs(pollSeconds * 1000);
      continue;
    }

    const dispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;
    const nowTs = await getNowTs();
    const deadline = batch.submittedAt + challengePeriod;
    const challengeWindowOpen = nowTs <= deadline;

    if (!sequencerPostStates || !challengerPostStates) {
      const txCount = toNum(batch.txCount);

      const sequencerDeltas = ((await rollup.getFunction("getBatchDeltas")(batchId)) as bigint[]).map((x) =>
        BigInt(x.toString()),
      );
      sequencerDeltasForBatch = sequencerDeltas;
      if (sequencerDeltas.length !== txCount) {
        throw new Error(
          `Unexpected delta length on-chain (got ${sequencerDeltas.length}, expected ${txCount})`,
        );
      }

      const challengerDeltas = challengerDeltasRaw
        ? parseDeltas(challengerDeltasRaw, txCount, "CHALLENGER_DELTAS_CSV")
        : sequencerDeltas;
      const challengerWrongDeltas = challengerWrongDeltasRaw
        ? parseDeltas(challengerWrongDeltasRaw, txCount, "CHALLENGER_WRONG_DELTAS")
        : undefined;
      const selectedChallengerDeltas = challengerWrongDeltas ?? challengerDeltas;
      challengerDeltasForBatch = selectedChallengerDeltas;
      if (challengerWrongDeltasRaw) {
        console.log(
          `CHALLENGER_WRONG_DELTAS override detected: challenger will intentionally use this path (${formatDeltas(selectedChallengerDeltas)}).`,
        );
      }

      const honestSequencerPostStates = computePostStates(batch.initialState, sequencerDeltas);
      sequencerDerivedFinalState = honestSequencerPostStates[honestSequencerPostStates.length - 1];
      sequencerClaimedFinalMismatch = sequencerDerivedFinalState !== batch.claimedFinalState;

      // For the interactive game, model sequencer's claimed path. If claimed final differs,
      // force the last post-state to match the sequencer's on-chain claimed final state.
      sequencerPostStates = [...honestSequencerPostStates];
      if (sequencerClaimedFinalMismatch) {
        sequencerPostStates[sequencerPostStates.length - 1] = batch.claimedFinalState;
      }

      challengerPostStates = computePostStates(batch.initialState, selectedChallengerDeltas);
      challengerFinalState = challengerPostStates[challengerPostStates.length - 1];
      disagreementCount = countDifferences(sequencerPostStates, challengerPostStates);

      console.log("Derived state paths:", {
        txCount,
        initialState: batch.initialState.toString(),
        sequencerClaimedFinalStateOnBatch: batch.claimedFinalState.toString(),
        derivedSequencerFinalState: sequencerDerivedFinalState.toString(),
        sequencerClaimedFinalMismatch,
        sequencerPathFinalStateForDispute: sequencerPostStates[sequencerPostStates.length - 1].toString(),
        derivedChallengerFinalState: challengerFinalState.toString(),
        differingIndices: disagreementCount,
        challengerPathSource: challengerWrongDeltasRaw
          ? "CHALLENGER_WRONG_DELTAS"
          : challengerDeltasRaw
            ? "CHALLENGER_DELTAS_CSV"
            : "on-chain batch deltas",
      });
    }

    if (!dispute.active) {
      const winner = dispute.challengerWon ? "challenger" : dispute.sequencerWon ? "sequencer" : "none";
      console.log(`\n[Poll ${poll}]`);
      console.log(
        `Time: now ${nowTs.toString()}, deadline ${deadline.toString()} (${challengeWindowOpen ? "challenge window open" : "challenge window closed"})`,
      );
      console.log(
        `Batch: challenged=${batch.challenged}, finalized=${batch.finalized}, invalidated=${batch.invalidated}`,
      );
      console.log(
        `Dispute: active=${dispute.active}, resolved=${dispute.resolved}, range=${dispute.start.toString()}..${dispute.end.toString()}, winner=${winner}`,
      );
      lastWaitMessage = undefined;
    }

    if (batch.finalized || dispute.resolved) {
      const claimable = (await rollup.getFunction("claimableBalances")(challenger.address)) as bigint;
      console.log("Final result:", {
        outcome: dispute.challengerWon ? "challenger-won" : "challenger-lost-or-no-win",
        challengerClaimable: claimableMessage(claimable),
      });
      return;
    }

    if (!batch.challenged && !dispute.active && challengeWindowOpen && !challengeSubmitted) {
      if (!challengerFinalState) {
        throw new Error("Failed to derive challenger final state");
      }
      if ((disagreementCount ?? 0) === 0) {
        console.log("No disagreement found between sequencer and challenger paths; skipping challenge.");
        const claimable = (await rollup.getFunction("claimableBalances")(challenger.address)) as bigint;
        console.log("Final result:", {
          outcome: "no-disagreement-no-challenge-submitted",
          challengerClaimable: claimableMessage(claimable),
        });
        return;
      }

      const onChainDeltas = sequencerDeltasForBatch;
      if (!onChainDeltas || sequencerDerivedFinalState === undefined || !challengerDeltasForBatch || !sequencerPostStates) {
        throw new Error("Missing sequencer delta derivation context for challenge narration");
      }

      console.log("Batch deltas read from contract:", formatDeltas(onChainDeltas));
      console.log(
        "Local recomputation from contract deltas:",
        formatComputation(batch.initialState, onChainDeltas),
      );
      console.log(
        `Comparison: batch.claimedFinalState=${batch.claimedFinalState.toString()} vs recomputedFromContractDeltas=${sequencerDerivedFinalState.toString()}`,
      );
      console.log("Challenger selected deltas:", formatDeltas(challengerDeltasForBatch));
      console.log(
        "Challenger selected-path computation:",
        formatComputation(batch.initialState, challengerDeltasForBatch),
      );
      console.log(
        `Comparison for challenge game: sequencer dispute-path final=${sequencerPostStates[sequencerPostStates.length - 1].toString()} vs challenger selected-path final=${challengerFinalState.toString()}`,
      );

      if (challengerWrongDeltasRaw) {
        console.log(
          "Challenge reason (simulation mode): challenger intentionally uses CHALLENGER_WRONG_DELTAS, so this proof is expected to fail.",
        );
      } else if (sequencerClaimedFinalMismatch) {
        console.log(
          "Challenge reason: sequencer claimed final state does not match final state derived from on-chain deltas.",
        );
      } else {
        console.log("Challenge reason: challenger-derived state path differs from sequencer dispute path.");
      }
      printStepDivider();

      await waitForUser("Challenger will submit initiateChallenge", stepMode);

      const tx = await rollup
        .connect(challenger)
        .getFunction("initiateChallenge")(batchId, challengerFinalState, { value: challengerBond });
      const receipt = await tx.wait();
      challengeSubmitted = true;
      console.log("Challenge tx:", tx.hash);
      console.log("Challenge block:", receipt?.blockNumber ?? "unknown");
      continue;
    }

    if (!challengeWindowOpen && !batch.challenged && !dispute.active) {
      const claimable = (await rollup.getFunction("claimableBalances")(challenger.address)) as bigint;
      console.log("Final result:", {
        outcome: "challenge-window-closed-without-dispute",
        challengerClaimable: claimableMessage(claimable),
      });
      return;
    }

    if (!dispute.active || dispute.resolved) {
      await waitMs(pollSeconds * 1000);
      continue;
    }

    if (dispute.start < dispute.end) {
      const computedMid = (dispute.start + dispute.end) / 2n;
      const mid = dispute.sequencerMidSubmitted ? dispute.mid : computedMid;
      const idx = toNum(mid);
      const sequencerMid = dispute.sequencerStateAtMid;
      const challengerMid = challengerPostStates[idx];
      const expectedNextRange =
        sequencerMid !== challengerMid
          ? `${dispute.start.toString()}..${mid.toString()}`
          : `${(mid + 1n).toString()}..${dispute.end.toString()}`;

      const range = `${dispute.start.toString()}..${dispute.end.toString()}`;
      if (range !== lastObservedRange) {
        lastObservedRange = range;
        console.log(
          `Challenge proof round detected. Current disputed range is ${range}; waiting for sequencer midpoint claim at index ${computedMid.toString()}.`,
        );
      }

      if (!dispute.sequencerMidSubmitted) {
        const waitMessage = "Waiting for sequencer midpoint claim...";
        if (waitMessage !== lastWaitMessage) {
          console.log(waitMessage);
          lastWaitMessage = waitMessage;
        }
        await waitMs(pollSeconds * 1000);
        continue;
      }

      if (dispute.challengerMidSubmitted) {
        const waitMessage = "Waiting for range update after challenger midpoint claim...";
        if (waitMessage !== lastWaitMessage) {
          console.log(waitMessage);
          lastWaitMessage = waitMessage;
        }
        await waitMs(pollSeconds * 1000);
        continue;
      }

      lastWaitMessage = undefined;
      const midpointStatesMatch = sequencerMid === challengerMid;
      const decisionText = midpointStatesMatch
        ? "Sequencer midpoint matches challenger midpoint, so challenger chooses the higher half next."
        : "Sequencer midpoint does not match challenger midpoint, so challenger chooses the lower half next.";

      console.log("Received sequencer midpoint claim. Comparing against challenger midpoint now.");
      console.log("Challenger midpoint comparison:", {
        currentRange: range,
        mid: mid.toString(),
        sequencerStateAtMid: sequencerMid.toString(),
        challengerStateAtMid: challengerMid.toString(),
        midpointStatesMatch,
        expectedNextRange,
        challengerExpression: formatComputation(batch.initialState, challengerDeltasForBatch!.slice(0, idx + 1)),
        decision: decisionText,
        onChainComparison:
          `${sequencerMid.toString()} ${midpointStatesMatch ? "==" : "!="} ${challengerMid.toString()} -> ${expectedNextRange}`,
        whereCompared: "Compared on-chain in DisputeBisected round advancement when both claims are submitted",
      });
      console.log("Challenger turn: sending midpoint claim now.");

      await waitForUser("Challenger will submit submitChallengerMidpointClaim", stepMode);

      // Re-check right before submit to avoid stale-range races during polling/user pause.
      const latestDispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;
      if (!latestDispute.active || latestDispute.resolved) {
        console.log("Bisect skipped: dispute is no longer active/resolvable; refreshing state.");
        continue;
      }
      if (latestDispute.start >= latestDispute.end) {
        console.log("Bisect skipped: dispute already reached single-step; moving to resolve phase.");
        continue;
      }
      if (!latestDispute.sequencerMidSubmitted) {
        console.log("Bisect skipped: sequencer midpoint claim not yet on-chain; waiting.");
        continue;
      }
      if (latestDispute.challengerMidSubmitted) {
        console.log("Bisect skipped: challenger midpoint claim already submitted; waiting for range advance.");
        continue;
      }

      let tx;
      let receipt;
      try {
        tx = await rollup
          .connect(challenger)
          .getFunction("submitChallengerMidpointClaim")(batchId, challengerMid);
        receipt = await tx.wait();
      } catch (error) {
        // DisputeNotAtSingleStep(uint256) => already narrowed; continue loop and resolve.
        if (revertSelector(error) === "0xb111df84") {
          console.log("Midpoint claim transaction reverted: dispute already at single-step. Continuing.");
          continue;
        }
        // MidpointAlreadySubmitted(uint256,bool) => round already submitted by this side.
        if (revertSelector(error) === "0xe34e893d") {
          console.log("Midpoint claim transaction reverted: challenger midpoint already submitted. Waiting.");
          continue;
        }
        throw error;
      }

      console.log("Challenger midpoint claim tx:", tx.hash);
      console.log("Challenger midpoint claim block:", receipt?.blockNumber ?? "unknown");
      console.log("Challenger midpoint claim input:", {
        mid: mid.toString(),
        challengerStateAtMid: challengerMid.toString(),
        challengerExpression: formatComputation(batch.initialState, challengerDeltasForBatch!.slice(0, idx + 1)),
      });
      continue;
    }

    const disputedIndex = toNum(dispute.start);
    const sequencerPost = dispute.sequencerSingleStepPostState;
    const challengerPost = challengerPostStates[disputedIndex];

    const deltas = sequencerDeltasForBatch;
    if (!deltas) {
      throw new Error("Missing sequencer deltas for single-step explanation");
    }
    const preState = disputedIndex === 0 ? batch.initialState : sequencerPostStates[disputedIndex - 1];
    const delta = deltas[disputedIndex];
    const expectedPostState = preState + delta;

    if (!dispute.sequencerSingleStepSubmitted) {
      const waitMessage = "Waiting for sequencer single-step claim...";
      if (waitMessage !== lastWaitMessage) {
        console.log(waitMessage);
        lastWaitMessage = waitMessage;
      }
      await waitMs(pollSeconds * 1000);
      continue;
    }

    lastWaitMessage = undefined;
    const snapshotKey = [
      disputedIndex.toString(),
      preState.toString(),
      delta.toString(),
      expectedPostState.toString(),
      sequencerPost.toString(),
      challengerPost.toString(),
      dispute.sequencerSingleStepSubmitted ? "1" : "0",
      dispute.challengerSingleStepSubmitted ? "1" : "0",
    ].join("|");
    if (snapshotKey !== lastSingleStepSnapshot) {
      lastSingleStepSnapshot = snapshotKey;
      console.log("Received sequencer single-step claim. Verifying transition against challenger computation.");
      console.log("Single-step computation (challenger view):", {
        disputedIndex: disputedIndex.toString(),
        preState: preState.toString(),
        delta: delta.toString(),
        expectedPostState: expectedPostState.toString(),
        sequencerClaimedPostState: sequencerPost.toString(),
        challengerClaimedPostState: challengerPost.toString(),
        challengerExpression: `${preState.toString()} + (${delta.toString()}) = ${challengerPost.toString()}`,
        onChainComparison:
          `${sequencerPost.toString()} vs ${challengerPost.toString()} against expected ${expectedPostState.toString()}`,
        whereCompared: "Compared on-chain in single-step resolver once both claims are submitted",
      });
    }

    if (sequencerPost === challengerPost) {
      throw new Error(
        `Cannot resolve index ${disputedIndex}: both post-state vectors are equal at this index`,
      );
    }

    if (dispute.challengerSingleStepSubmitted) {
      const waitMessage = "Waiting for dispute resolution after challenger single-step claim...";
      if (waitMessage !== lastWaitMessage) {
        console.log(waitMessage);
        lastWaitMessage = waitMessage;
      }
      await waitMs(pollSeconds * 1000);
      continue;
    }

    console.log("Challenger turn: sending single-step claim now.");
    await waitForUser("Challenger will submit submitChallengerSingleStepClaim", stepMode);

    const tx = await rollup
      .connect(challenger)
      .getFunction("submitChallengerSingleStepClaim")(batchId, challengerPost);
    const receipt = await tx.wait();
    const latestDispute = (await rollup.getFunction("disputes")(batchId)) as DisputeView;

    console.log("Challenger single-step claim tx:", tx.hash);
    console.log("Challenger single-step claim block:", receipt?.blockNumber ?? "unknown");

    if (!latestDispute.resolved) {
      console.log("Waiting: sequencer single-step claim not submitted yet.");
      await waitMs(pollSeconds * 1000);
      continue;
    }

    const claimable = (await rollup.getFunction("claimableBalances")(challenger.address)) as bigint;
    console.log("Final result:", {
      outcome: latestDispute.challengerWon ? "challenger-won" : "challenger-lost",
      challengerClaimable: claimableMessage(claimable),
    });
    return;
  }

  throw new Error(`Reached MAX_POLLS=${maxPolls} without terminal outcome`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
