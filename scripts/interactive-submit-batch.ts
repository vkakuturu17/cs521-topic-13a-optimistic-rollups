import { network } from "hardhat";

const { ethers } = await network.connect();

function parseDeltas(raw: string): bigint[] {
  const items = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .map((x) => BigInt(x));

  if (items.length === 0) {
    throw new Error("DELTAS_CSV must include at least one integer delta");
  }

  return items;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const initialStateRaw = process.env.INITIAL_STATE;
  const claimedFinalStateRaw = process.env.CLAIMED_FINAL_STATE;
  const deltasRaw = process.env.DELTAS_CSV;

  if (!contractAddress || !initialStateRaw || !claimedFinalStateRaw || !deltasRaw) {
    throw new Error(
      "Set CONTRACT_ADDRESS, INITIAL_STATE, CLAIMED_FINAL_STATE, DELTAS_CSV. Example: CONTRACT_ADDRESS=0x... INITIAL_STATE=10 CLAIMED_FINAL_STATE=18 DELTAS_CSV='5,-2,4,1' pnpm run interactive:submit:base-sepolia",
    );
  }

  const initialState = BigInt(initialStateRaw);
  const claimedFinalState = BigInt(claimedFinalStateRaw);
  const deltas = parseDeltas(deltasRaw);

  const [sequencer] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("InteractiveOptimisticRollup", contractAddress);
  const sequencerBond = (await rollup.getFunction("sequencerBond")()) as bigint;

  const tx = await rollup
    .connect(sequencer)
    .submitBatch(initialState, claimedFinalState, deltas, { value: sequencerBond });
  const receipt = await tx.wait();

  const latestBatchId = await rollup.latestBatchId();

  console.log("Sequencer:", sequencer.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", latestBatchId.toString());
  console.log("Deltas:", deltas.map((d) => d.toString()).join(","));
  console.log("Bond sent (ETH):", ethers.formatEther(sequencerBond));
  console.log("Submit tx hash:", tx.hash);
  console.log("Submit block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
