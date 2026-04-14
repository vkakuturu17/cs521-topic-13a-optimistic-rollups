import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [secondsArg] = process.argv.slice(2);

  if (!secondsArg) {
    throw new Error("Usage: pnpm run time:increase -- <seconds>");
  }

  const seconds = Number(secondsArg);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Seconds must be a positive number");
  }

  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);

  console.log("Increased local chain time by", seconds, "seconds");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
