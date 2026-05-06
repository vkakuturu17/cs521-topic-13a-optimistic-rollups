/**
 * Deploys a fresh InteractiveOptimisticRollup and runs a full sequencer-fraud demo.
 * Outputs every transaction hash and actual gas used for the final report.
 */
import { network } from "hardhat";

const { ethers } = await network.connect();

function computeStates(init: bigint, deltas: bigint[]): bigint[] {
  const out: bigint[] = [];
  let s = init;
  for (const d of deltas) { s += d; out.push(s); }
  return out;
}

async function main() {
  const DEPLOYER_PK   = process.env.DEPLOYER_PRIVATE_KEY!;
  const CHALLENGER_PK = process.env.CHALLENGER_PRIVATE_KEY!;

  const sequencer  = new ethers.Wallet(DEPLOYER_PK,   ethers.provider);
  const challenger = new ethers.Wallet(CHALLENGER_PK, ethers.provider);

  console.log("=== DEPLOY + FRAUD DEMO — BASE SEPOLIA ===");
  console.log("Sequencer:  ", sequencer.address);
  console.log("Challenger: ", challenger.address);
  console.log("");

  // ── Deploy ───────────────────────────────────────────────────────────────
  const CHALLENGE_PERIOD = 300n;        // 5 min
  const SEQ_BOND   = ethers.parseEther("0.005");
  const CHALL_BOND = ethers.parseEther("0.005");

  console.log("── Deploying InteractiveOptimisticRollup ───────────────────────");
  const factory = await ethers.getContractFactory("InteractiveOptimisticRollup", sequencer);
  const rollup  = await factory.deploy(CHALLENGE_PERIOD, SEQ_BOND, CHALL_BOND);
  const deployReceipt = await rollup.deploymentTransaction()!.wait();
  const contractAddr  = await rollup.getAddress();
  console.log("  contract:    ", contractAddr);
  console.log("  deploy tx:   ", deployReceipt!.hash);
  console.log("  deploy block:", deployReceipt!.blockNumber);
  console.log("  deploy gas:  ", deployReceipt!.gasUsed.toString());
  console.log("  challengePeriod:", CHALLENGE_PERIOD.toString(), "s");
  console.log("  sequencerBond:  ", ethers.formatEther(SEQ_BOND), "ETH");
  console.log("  challengerBond: ", ethers.formatEther(CHALL_BOND), "ETH");
  console.log("");

  // ── Scenario ─────────────────────────────────────────────────────────────
  const init         = 10n;
  const onChain      = [5n, -2n, 4n, 1n];   // posted to chain (honest)
  const fraud        = [5n, -2n, 5n, 1n];   // sequencer uses internally (fraud at idx 2)
  const honestStates = computeStates(init, onChain);
  const fraudStates  = computeStates(init, fraud);
  const claimedFinal = fraudStates[fraudStates.length - 1];
  const challFinal   = honestStates[honestStates.length - 1];

  console.log("Scenario: sequencer fraud at delta index 2");
  console.log("  Initial state:        ", init.toString());
  console.log("  On-chain deltas:      ", onChain.map(String).join(", "));
  console.log("  Honest final state:   ", challFinal.toString());
  console.log("  Sequencer fraud deltas:", fraud.map(String).join(", "));
  console.log("  Sequencer claimed:    ", claimedFinal.toString(), "(LIE)");
  console.log("");

  // ── Tx 1: submitBatch ───────────────────────────────────────────────────
  console.log("── Tx 1: submitBatch ──────────────────────────────────────────");
  const tx1 = await rollup.connect(sequencer).submitBatch(
    init, claimedFinal, onChain, { value: SEQ_BOND }
  );
  const r1 = await tx1.wait();
  const batchId = await rollup.latestBatchId() as bigint;
  console.log("  hash:   ", tx1.hash);
  console.log("  block:  ", r1!.blockNumber);
  console.log("  gas:    ", r1!.gasUsed.toString());
  console.log("  batchId:", batchId.toString());
  console.log("");

  // ── Tx 2: initiateChallenge ─────────────────────────────────────────────
  console.log("── Tx 2: initiateChallenge ─────────────────────────────────────");
  const tx2 = await rollup.connect(challenger).initiateChallenge(
    batchId, challFinal, { value: CHALL_BOND }
  );
  const r2 = await tx2.wait();
  console.log("  hash:   ", tx2.hash);
  console.log("  block:  ", r2!.blockNumber);
  console.log("  gas:    ", r2!.gasUsed.toString());
  console.log("  challenger claims final state:", challFinal.toString());
  console.log("  sequencer claimed:            ", claimedFinal.toString());
  console.log("");

  // ── Bisection + single-step ──────────────────────────────────────────────
  let txN = 3;
  let round = 1;
  while (true) {
    type DisputeT = { active: boolean; resolved: boolean; start: bigint; end: bigint;
      sequencerMidSubmitted: boolean; challengerMidSubmitted: boolean;
      sequencerSingleStepSubmitted: boolean; challengerSingleStepSubmitted: boolean;
      challengerWon: boolean; sequencerWon: boolean; };
    const d = await rollup.disputes(batchId) as unknown as DisputeT;
    if (d.resolved) break;

    if (d.start === d.end) {
      const idx = Number(d.start);
      const seqPost  = fraudStates[idx];
      const challPost = honestStates[idx];
      const preState  = idx === 0 ? init : honestStates[idx - 1];

      console.log(`── Tx ${txN}: submitSequencerSingleStepClaim (disputed index ${idx}) ──`);
      const txS = await rollup.connect(sequencer).submitSequencerSingleStepClaim(batchId, seqPost);
      const rS  = await txS.wait();
      console.log("  hash:    ", txS.hash);
      console.log("  block:   ", rS!.blockNumber);
      console.log("  gas:     ", rS!.gasUsed.toString());
      console.log("  seq claims:", seqPost.toString());
      txN++;

      console.log(`── Tx ${txN}: submitChallengerSingleStepClaim (triggers resolution) ──`);
      const txC = await rollup.connect(challenger).submitChallengerSingleStepClaim(batchId, challPost);
      const rC  = await txC.wait();
      console.log("  hash:    ", txC.hash);
      console.log("  block:   ", rC!.blockNumber);
      console.log("  gas:     ", rC!.gasUsed.toString());
      console.log("  chall claims:", challPost.toString());
      console.log("  on-chain delta:", onChain[idx].toString(), "→ preState + delta =", preState.toString(), "+", onChain[idx].toString(), "=", (preState + onChain[idx]).toString());
      txN++;
      break;
    }

    const mid    = (d.start + d.end) / 2n;
    const midIdx = Number(mid);
    const seqMid  = fraudStates[midIdx];
    const challMid = honestStates[midIdx];
    const agree = seqMid === challMid;

    console.log(`── Round ${round}: range [${d.start}, ${d.end}] midpoint=${mid}  seq=${seqMid} chall=${challMid} agree=${agree}`);

    console.log(`── Tx ${txN}: submitSequencerMidpointClaim (round ${round}) ──────────`);
    const txSM = await rollup.connect(sequencer).submitSequencerMidpointClaim(batchId, seqMid);
    const rSM  = await txSM.wait();
    console.log("  hash:  ", txSM.hash);
    console.log("  block: ", rSM!.blockNumber);
    console.log("  gas:   ", rSM!.gasUsed.toString());
    txN++;

    console.log(`── Tx ${txN}: submitChallengerMidpointClaim (round ${round}) ──────────`);
    const txCM = await rollup.connect(challenger).submitChallengerMidpointClaim(batchId, challMid);
    const rCM  = await txCM.wait();
    console.log("  hash:  ", txCM.hash);
    console.log("  block: ", rCM!.blockNumber);
    console.log("  gas:   ", rCM!.gasUsed.toString());
    txN++;

    console.log(`   → next range: ${agree ? `[${mid+1n}, ${d.end}]` : `[${d.start}, ${mid}]`}`);
    console.log("");
    round++;
  }

  // ── Resolution ────────────────────────────────────────────────────────────
  type DisputeFinal = { challengerWon: boolean; sequencerWon: boolean; };
  type BatchFinal   = { invalidated: boolean; };
  const fd = await rollup.disputes(batchId) as unknown as DisputeFinal;
  const fb = await rollup.batches(batchId) as unknown as BatchFinal;
  const claimable = await rollup.claimableBalances(challenger.address) as bigint;

  console.log("");
  console.log("=== RESOLUTION ===");
  console.log("  challengerWon:      ", fd.challengerWon);
  console.log("  sequencerWon:       ", fd.sequencerWon);
  console.log("  batchInvalidated:   ", fb.invalidated);
  console.log("  challenger claimable:", ethers.formatEther(claimable), "ETH");
  console.log("");

  // ── Tx N: withdrawClaimable ──────────────────────────────────────────────
  if (claimable > 0n) {
    console.log(`── Tx ${txN}: withdrawClaimable ─────────────────────────────────`);
    const txW = await rollup.connect(challenger).withdrawClaimable();
    const rW  = await txW.wait();
    console.log("  hash:      ", txW.hash);
    console.log("  block:     ", rW!.blockNumber);
    console.log("  gas:       ", rW!.gasUsed.toString());
    console.log("  withdrawn: ", ethers.formatEther(claimable), "ETH → challenger");
  }

  console.log("");
  console.log("=== CONTRACT USED ===");
  console.log("  address:", contractAddr);
  console.log("  network: Base Sepolia");
  console.log("  explorer: https://sepolia.basescan.org/address/" + contractAddr);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
