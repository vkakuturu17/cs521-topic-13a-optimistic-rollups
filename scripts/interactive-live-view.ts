import { network } from "hardhat";

const { ethers } = await network.connect();

type BatchView = {
  sequencer: string;
  initialState: bigint;
  claimedFinalState: bigint;
  submittedAt: bigint;
  txCount: bigint;
  challenged: boolean;
  finalized: boolean;
  invalidated: boolean;
  bondSettled: boolean;
};

type DisputeView = {
  challenger: string;
  active: boolean;
  resolved: boolean;
  start: bigint;
  end: bigint;
  sequencerFinalState: bigint;
  challengerFinalState: bigint;
  sequencerWon: boolean;
  challengerWon: boolean;
};

function toNum(v: bigint): number {
  return Number(v);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDeltaList(deltas: bigint[]): string {
  return deltas.map((d) => (d >= 0n ? `+${d.toString()}` : d.toString())).join(", ");
}

async function getDeltas(contract: any, batchId: bigint): Promise<bigint[]> {
  const raw = (await contract.getFunction("getBatchDeltas")(batchId)) as bigint[];
  return raw.map((x) => BigInt(x.toString()));
}

function computeStates(initial: bigint, deltas: bigint[]): bigint[] {
  const states: bigint[] = [initial];
  let s = initial;
  for (const d of deltas) {
    s += d;
    states.push(s);
  }
  return states;
}

function printHeader() {
  console.log("\n============================================================");
  console.log("Interactive Rollup Live View");
  console.log("============================================================");
}

async function printSnapshot(contract: any, batchId: bigint, accountAddress?: string) {
  const batch = (await contract.getFunction("batches")(batchId)) as BatchView;
  const dispute = (await contract.getFunction("disputes")(batchId)) as DisputeView;

  const sequencerBond = (await contract.getFunction("sequencerBond")()) as bigint;
  const challengerBond = (await contract.getFunction("challengerBond")()) as bigint;
  const challengePeriod = (await contract.getFunction("challengePeriod")()) as bigint;

  const deltas = batch.txCount > 0n ? await getDeltas(contract, batchId) : [];
  const states = computeStates(batch.initialState, deltas);

  console.log("\n[Batch Snapshot]");
  console.log({
    batchId: batchId.toString(),
    sequencer: batch.sequencer,
    initialState: batch.initialState.toString(),
    claimedFinalState: batch.claimedFinalState.toString(),
    txCount: batch.txCount.toString(),
    submittedAt: batch.submittedAt.toString(),
    challengePeriod: challengePeriod.toString(),
    challenged: batch.challenged,
    finalized: batch.finalized,
    invalidated: batch.invalidated,
    bondSettled: batch.bondSettled,
  });

  console.log("\n[Bonds]");
  console.log({
    sequencerBondETH: ethers.formatEther(sequencerBond),
    challengerBondETH: ethers.formatEther(challengerBond),
    totalAtRiskETH: ethers.formatEther(sequencerBond + challengerBond),
  });

  console.log("\n[Transactions as Deltas]");
  if (deltas.length === 0) {
    console.log("No deltas stored for this batch yet.");
  } else {
    console.log(`deltas[${deltas.length}]: ${formatDeltaList(deltas)}`);
    console.log("state path:", states.map((s) => s.toString()).join(" -> "));
  }

  console.log("\n[Dispute]");
  console.log({
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

  if (deltas.length > 0 && dispute.start <= dispute.end && toNum(dispute.end) < deltas.length) {
    const startIdx = toNum(dispute.start);
    const endIdx = toNum(dispute.end);
    console.log("\n[Interactive Range]");
    console.log(`current disputed range: [${startIdx}..${endIdx}]`);

    if (startIdx === endIdx) {
      const idx = startIdx;
      const pre = states[idx];
      const delta = deltas[idx];
      const expectedPost = pre + delta;
      console.log("single-step verification target:", {
        disputedIndex: idx,
        preState: pre.toString(),
        delta: delta.toString(),
        expectedPostState: expectedPost.toString(),
      });
    }
  }

  if (accountAddress) {
    const claimable = (await contract.getFunction("claimableBalances")(accountAddress)) as bigint;
    console.log("\n[Tracked Account]");
    console.log({
      account: accountAddress,
      claimableETH: ethers.formatEther(claimable),
    });
  }
}

async function printNewEvents(contract: any, fromBlock: bigint, toBlock: bigint) {
  if (toBlock < fromBlock) return;

  const logs = await contract.queryFilter("*", fromBlock, toBlock);
  if (logs.length === 0) return;

  console.log(`\n[Events ${fromBlock.toString()}..${toBlock.toString()}]`);
  for (const log of logs) {
    const args = (log as any).args;
    const base = {
      event: (log as any).eventName,
      txHash: log.transactionHash,
      block: log.blockNumber,
    };

    if ((log as any).eventName === "BatchSubmitted") {
      console.log({
        ...base,
        batchId: args?.batchId?.toString(),
        initialState: args?.initialState?.toString(),
        claimedFinalState: args?.claimedFinalState?.toString(),
        txCount: args?.txCount?.toString(),
      });
      continue;
    }

    if ((log as any).eventName === "ChallengeInitiated") {
      console.log({
        ...base,
        batchId: args?.batchId?.toString(),
        challengerFinalState: args?.challengerFinalState?.toString(),
      });
      continue;
    }

    if ((log as any).eventName === "DisputeBisected") {
      console.log({
        ...base,
        batchId: args?.batchId?.toString(),
        start: args?.start?.toString(),
        end: args?.end?.toString(),
        mid: args?.mid?.toString(),
        lowerHalfDisputed: args?.lowerHalfDisputed,
      });
      continue;
    }

    if ((log as any).eventName === "DisputeResolved") {
      console.log({
        ...base,
        batchId: args?.batchId?.toString(),
        challengerWon: args?.challengerWon,
        sequencerWon: args?.sequencerWon,
        disputedIndex: args?.disputedIndex?.toString(),
      });
      continue;
    }

    if ((log as any).eventName === "BatchFinalized") {
      console.log({
        ...base,
        batchId: args?.batchId?.toString(),
        claimedFinalState: args?.claimedFinalState?.toString(),
      });
      continue;
    }

    console.log(base);
  }
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const pollSecondsRaw = process.env.POLL_SECONDS ?? "5";
  const accountAddress = process.env.ACCOUNT_ADDRESS;

  if (!contractAddress) {
    throw new Error("Set CONTRACT_ADDRESS. Optional: BATCH_ID, ACCOUNT_ADDRESS, POLL_SECONDS");
  }

  const pollSeconds = Number(pollSecondsRaw);
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) {
    throw new Error("POLL_SECONDS must be a positive number");
  }

  const contract = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const latestBatchId = (await contract.getFunction("latestBatchId")()) as bigint;

  const batchId = batchIdRaw ? BigInt(batchIdRaw) : latestBatchId;
  if (batchId === 0n) {
    throw new Error("No batches exist yet. Submit a batch first, then rerun live view.");
  }

  const currentBlock = await ethers.provider.getBlockNumber();
  let lastSeenBlock = BigInt(currentBlock);

  printHeader();
  console.log("Watching contract:", contractAddress);
  console.log("Watching batch:", batchId.toString());
  console.log("Poll interval (s):", pollSeconds.toString());
  if (accountAddress) {
    console.log("Tracking account:", accountAddress);
  }

  while (true) {
    const nowBlock = BigInt(await ethers.provider.getBlockNumber());

    await printNewEvents(contract, lastSeenBlock + 1n, nowBlock);
    await printSnapshot(contract, batchId, accountAddress);

    lastSeenBlock = nowBlock;
    await waitMs(pollSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
