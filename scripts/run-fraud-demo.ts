/**
 * Full end-to-end fraud demo: sequencer commits fraud, challenger catches it.
 * Runs both roles from a single process, logging every transaction hash and gas used.
 * Used to capture on-chain proof numbers for the final report.
 */
import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS!;
  const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY!;
  const CHALLENGER_PK = process.env.CHALLENGER_PRIVATE_KEY!;

  const sequencer = new ethers.Wallet(DEPLOYER_PK, ethers.provider);
  const challenger = new ethers.Wallet(CHALLENGER_PK, ethers.provider);

  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", CONTRACT_ADDRESS);
  const sequencerBond = await rollup.sequencerBond() as bigint;
  const challengerBond = await rollup.challengerBond() as bigint;
  const challengePeriod = await rollup.challengePeriod() as bigint;

  console.log("=== FRAUD DEMO — BASE SEPOLIA ===");
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Sequencer:", sequencer.address);
  console.log("Challenger:", challenger.address);
  console.log("Sequencer bond:", ethers.formatEther(sequencerBond), "ETH");
  console.log("Challenger bond:", ethers.formatEther(challengerBond), "ETH");
  console.log("Challenge period:", challengePeriod.toString(), "seconds");
  console.log("");

  // Parameters
  const initialState = 10n;
  const onChainDeltas  = [5n, -2n, 4n, 1n];   // posted to chain (honest)
  const fraudDeltas    = [5n, -2n, 5n, 1n];   // sequencer uses internally (fraud at index 2)

  function computeStates(init: bigint, deltas: bigint[]): bigint[] {
    const states: bigint[] = [];
    let s = init;
    for (const d of deltas) { s += d; states.push(s); }
    return states;
  }

  const honestStates   = computeStates(initialState, onChainDeltas);
  const fraudStates    = computeStates(initialState, fraudDeltas);
  const claimedFinal   = fraudStates[fraudStates.length - 1];

  console.log("On-chain deltas:  ", onChainDeltas.map(String).join(", "));
  console.log("Fraud deltas:     ", fraudDeltas.map(String).join(", "));
  console.log("Honest states:    ", honestStates.map(String).join(", "), "→ final:", honestStates[honestStates.length-1].toString());
  console.log("Fraud states:     ", fraudStates.map(String).join(", "), "→ final:", claimedFinal.toString());
  console.log("");

  // ── Tx 1: submitBatch ────────────────────────────────────────────────────
  console.log("── Tx 1: submitBatch ──────────────────────────────────────────");
  const tx1 = await rollup.connect(sequencer).submitBatch(
    initialState, claimedFinal, onChainDeltas, { value: sequencerBond }
  );
  const r1 = await tx1.wait();
  const batchId = await rollup.latestBatchId() as bigint;
  console.log("  tx hash:    ", tx1.hash);
  console.log("  block:      ", r1!.blockNumber);
  console.log("  gas used:   ", r1!.gasUsed.toString());
  console.log("  batch ID:   ", batchId.toString());
  console.log("");

  // ── Tx 2: initiateChallenge ──────────────────────────────────────────────
  const challengerFinal = honestStates[honestStates.length - 1];
  console.log("── Tx 2: initiateChallenge ─────────────────────────────────────");
  const tx2 = await rollup.connect(challenger).initiateChallenge(
    batchId, challengerFinal, { value: challengerBond }
  );
  const r2 = await tx2.wait();
  console.log("  tx hash:    ", tx2.hash);
  console.log("  block:      ", r2!.blockNumber);
  console.log("  gas used:   ", r2!.gasUsed.toString());
  console.log("  challenger final state:", challengerFinal.toString(), "(honest)");
  console.log("  sequencer claimed:     ", claimedFinal.toString(), "(fraud)");
  console.log("");

  // ── Bisection rounds ─────────────────────────────────────────────────────
  let round = 1;
  let txCount = 3;

  while (true) {
    const dispute = await rollup.disputes(batchId) as {
      active: boolean; resolved: boolean;
      start: bigint; end: bigint; mid: bigint;
      sequencerMidSubmitted: boolean; challengerMidSubmitted: boolean;
      sequencerSingleStepSubmitted: boolean; challengerSingleStepSubmitted: boolean;
      challengerWon: boolean; sequencerWon: boolean;
    };

    if (dispute.resolved) break;

    const start = dispute.start;
    const end   = dispute.end;

    if (start === end) {
      // ── Single-step phase ────────────────────────────────────────────────
      const idx = Number(start);
      const seqPost  = fraudStates[idx];
      const challPost = honestStates[idx];

      console.log(`── Tx ${txCount}: submitSequencerSingleStepClaim (index ${idx}) ────────────`);
      const txS = await rollup.connect(sequencer).submitSequencerSingleStepClaim(batchId, seqPost);
      const rS  = await txS.wait();
      console.log("  tx hash:    ", txS.hash);
      console.log("  block:      ", rS!.blockNumber);
      console.log("  gas used:   ", rS!.gasUsed.toString());
      console.log("  seq claims: ", seqPost.toString());
      txCount++;

      console.log(`── Tx ${txCount}: submitChallengerSingleStepClaim (index ${idx}) ──────────`);
      const txC = await rollup.connect(challenger).submitChallengerSingleStepClaim(batchId, challPost);
      const rC  = await txC.wait();
      console.log("  tx hash:    ", txC.hash);
      console.log("  block:      ", rC!.blockNumber);
      console.log("  gas used:   ", rC!.gasUsed.toString());
      console.log("  chall claims:", challPost.toString());
      console.log("  on-chain delta at index:", onChainDeltas[idx].toString());

      // Compute expected
      const preState = idx === 0 ? initialState : honestStates[idx - 1];
      const expected = preState + onChainDeltas[idx];
      console.log("  pre-state:  ", preState.toString());
      console.log("  expected:   ", expected.toString(), "(preState + on-chain delta)");
      console.log("  challenger matches expected →", challPost === expected ? "CHALLENGER WINS" : "SEQUENCER WINS");
      txCount++;
      break;
    }

    // ── Midpoint round ───────────────────────────────────────────────────
    const mid = (start + end) / 2n;
    const midIdx = Number(mid);
    const seqMid  = fraudStates[midIdx];
    const challMid = honestStates[midIdx];
    const agree = seqMid === challMid;

    console.log(`── Round ${round}: bisection range [${start}, ${end}], midpoint index ${mid} ──`);
    console.log(`   seq mid=${seqMid}, chall mid=${challMid}, agree=${agree} → next range: ${agree ? `[${mid+1n}, ${end}]` : `[${start}, ${mid}]`}`);

    console.log(`── Tx ${txCount}: submitSequencerMidpointClaim (round ${round}) ──────────────`);
    const txSM = await rollup.connect(sequencer).submitSequencerMidpointClaim(batchId, seqMid);
    const rSM  = await txSM.wait();
    console.log("  tx hash:    ", txSM.hash);
    console.log("  block:      ", rSM!.blockNumber);
    console.log("  gas used:   ", rSM!.gasUsed.toString());
    txCount++;

    console.log(`── Tx ${txCount}: submitChallengerMidpointClaim (round ${round}) ────────────`);
    const txCM = await rollup.connect(challenger).submitChallengerMidpointClaim(batchId, challMid);
    const rCM  = await txCM.wait();
    console.log("  tx hash:    ", txCM.hash);
    console.log("  block:      ", rCM!.blockNumber);
    console.log("  gas used:   ", rCM!.gasUsed.toString());
    txCount++;
    console.log("");
    round++;
  }

  console.log("");

  // ── Final state ──────────────────────────────────────────────────────────
  const finalDispute = await rollup.disputes(batchId) as { challengerWon: boolean; sequencerWon: boolean };
  const finalBatch   = await rollup.batches(batchId) as { invalidated: boolean; finalized: boolean };
  const challClaimable = await rollup.claimableBalances(challenger.address) as bigint;

  console.log("=== RESOLUTION ===");
  console.log("  challengerWon:  ", finalDispute.challengerWon);
  console.log("  sequencerWon:   ", finalDispute.sequencerWon);
  console.log("  batchInvalidated:", finalBatch.invalidated);
  console.log("  challengerClaimable:", ethers.formatEther(challClaimable), "ETH");
  console.log("");

  // ── Tx N: withdrawClaimable ───────────────────────────────────────────────
  if (challClaimable > 0n) {
    console.log(`── Tx ${txCount}: withdrawClaimable ─────────────────────────────────────`);
    const txW = await rollup.connect(challenger).withdrawClaimable();
    const rW  = await txW.wait();
    console.log("  tx hash:    ", txW.hash);
    console.log("  block:      ", rW!.blockNumber);
    console.log("  gas used:   ", rW!.gasUsed.toString());
    console.log("  withdrawn:  ", ethers.formatEther(challClaimable), "ETH to", challenger.address);
  }

  console.log("");
  console.log("=== DEMO COMPLETE ===");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
