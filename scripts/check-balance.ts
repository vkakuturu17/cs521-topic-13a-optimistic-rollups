import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argAddress] = process.argv.slice(2);
  const address = process.env.TARGET_ADDRESS ?? argAddress;

  if (!address) {
    throw new Error("Set TARGET_ADDRESS. Example: TARGET_ADDRESS=0x... pnpm run balance:local");
  }

  const balance = await ethers.provider.getBalance(address);
  console.log("Address:", address);
  console.log("Balance (wei):", balance.toString());
  console.log("Balance (ETH):", ethers.formatEther(balance));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
