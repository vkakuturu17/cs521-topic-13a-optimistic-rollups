import { network } from "hardhat";
import { readInstructionsFromEnv } from "./utils/instructions.js";

const { ethers } = await network.connect();

function hashInt(state: bigint): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(abi.encode(["int256"], [state]));
}

function computeTrace(previousStateHash: string, instructions: bigint[]): string[] {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const hashes: string[] = [previousStateHash];
  for (const instruction of instructions) {
    hashes.push(ethers.keccak256(abi.encode(["bytes32", "int256"], [hashes[hashes.length - 1], instruction])));
  }
  return hashes;
}

async function main() {
  const initialStateRaw = process.env.INITIAL_STATE;
  const previousStateHashRaw = process.env.PREVIOUS_STATE_HASH;
  const rangeStartRaw = process.env.RANGE_START ?? "0";
  const rangeEndRaw = process.env.RANGE_END;
  const stepRaw = process.env.STEP ?? process.env.INDEX;

  if (!previousStateHashRaw && !initialStateRaw) {
    throw new Error(
      "Set DELTAS_CSV (or INSTRUCTIONS_CSV) and either PREVIOUS_STATE_HASH or INITIAL_STATE. Optional: RANGE_START, RANGE_END, STEP.",
    );
  }

  const instructions = readInstructionsFromEnv();
  const previousStateHash = previousStateHashRaw ?? hashInt(BigInt(initialStateRaw!));
  const trace = computeTrace(previousStateHash, instructions);

  const rangeStart = BigInt(rangeStartRaw);
  const rangeEnd = rangeEndRaw !== undefined ? BigInt(rangeEndRaw) : BigInt(instructions.length);
  if (rangeStart < 0n || rangeEnd < rangeStart || rangeEnd > BigInt(instructions.length)) {
    throw new Error("Range must satisfy 0 <= RANGE_START <= RANGE_END <= instruction count.");
  }

  console.log("Instruction count:", instructions.length.toString());
  console.log("Previous state hash (step 0):", previousStateHash);
  console.log("Instruction commitment:", ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["int256[]"], [instructions])));
  console.log("Computed post-state hash (final):", trace[trace.length - 1]);

  console.log("\n[Trace Hashes]");
  for (let i = 0; i < trace.length; i++) {
    console.log(`step ${i}: ${trace[i]}`);
  }

  console.log("\n[Dispute Window]");
  console.log(`range: [${rangeStart.toString()}, ${rangeEnd.toString()})`);
  if (rangeEnd > rangeStart + 1n) {
    const midpoint = (rangeStart + rangeEnd) / 2n;
    console.log("midpoint step:", midpoint.toString());
    console.log("hash at midpoint:", trace[Number(midpoint)]);
  } else {
    console.log("single-step window reached");
    console.log("agreed pre-state step:", rangeStart.toString());
    console.log("required PRE_STATE_HASH:", trace[Number(rangeStart)]);
  }

  if (stepRaw !== undefined) {
    const step = Number(stepRaw);
    if (!Number.isInteger(step) || step < 0 || step >= trace.length) {
      throw new Error(`STEP must be an integer in [0, ${trace.length - 1}]`);
    }
    console.log(`\n[Requested Step ${step}]`);
    console.log(trace[step]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
