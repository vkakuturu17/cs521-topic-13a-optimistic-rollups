import { network } from "hardhat";

const { ethers } = await network.connect();

function readPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(parsed);
}

function readPositiveEth(name: string, defaultValue: string): bigint {
  const raw = process.env[name] ?? defaultValue;
  const value = ethers.parseEther(raw);
  if (value <= 0n) {
    throw new Error(`${name} must be > 0`);
  }
  return value;
}

async function main() {
  const challengePeriodSeconds = readPositiveInt("CHALLENGE_PERIOD_SECONDS", 60);
  const sequencerBond = readPositiveEth("SEQUENCER_BOND_ETH", "0.01");
  const challengerBond = readPositiveEth("CHALLENGER_BOND_ETH", "0.005");

  const [deployer] = await ethers.getSigners();

  const rollup = await ethers.deployContract("InteractiveOptimisticRollup", [
    challengePeriodSeconds,
    sequencerBond,
    challengerBond,
  ]);
  await rollup.waitForDeployment();

  console.log("Deployer:", deployer.address);
  console.log("InteractiveOptimisticRollup deployed to:", await rollup.getAddress());
  console.log("Challenge period (s):", challengePeriodSeconds);
  console.log("Sequencer bond (ETH):", ethers.formatEther(sequencerBond));
  console.log("Challenger bond (ETH):", ethers.formatEther(challengerBond));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
