import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const challengePeriodSeconds = 60;

  const rollup = await ethers.deployContract("SimpleOptimisticRollup", [challengePeriodSeconds]);
  await rollup.waitForDeployment();

  const address = await rollup.getAddress();
  console.log("SimpleOptimisticRollup deployed to:", address);
  console.log("Challenge period (s):", challengePeriodSeconds);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
