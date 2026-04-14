import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const batchIdRaw = process.env.BATCH_ID;
  const sequencerStateAtMidRaw = process.env.SEQUENCER_STATE_AT_MID;
  const challengerStateAtMidRaw = process.env.CHALLENGER_STATE_AT_MID;

  if (!contractAddress || !batchIdRaw || !sequencerStateAtMidRaw || !challengerStateAtMidRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, BATCH_ID, SEQUENCER_STATE_AT_MID, CHALLENGER_STATE_AT_MID. Example: CONTRACT_ADDRESS=0x... BATCH_ID=1 SEQUENCER_STATE_AT_MID=13 CHALLENGER_STATE_AT_MID=13 pnpm run interactive:bisect:base-sepolia",
    );
  }

  const batchId = BigInt(batchIdRaw);
  const sequencerStateAtMid = BigInt(sequencerStateAtMidRaw);
  const challengerStateAtMid = BigInt(challengerStateAtMidRaw);

  const [caller] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);

  const tx = await rollup.connect(caller).bisectDispute(batchId, sequencerStateAtMid, challengerStateAtMid);
  const receipt = await tx.wait();

  const dispute = await rollup.disputes(batchId);

  console.log("Caller:", caller.address);
  console.log("Dispute tx hash:", tx.hash);
  console.log("Dispute block:", receipt?.blockNumber ?? "unknown");
  console.log("New range:", `${dispute.start.toString()}..${dispute.end.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
