import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [argTarget, argAmountEth] = process.argv.slice(2);
  const target = process.env.TARGET_ADDRESS ?? argTarget;
  const amountEth = process.env.FUND_AMOUNT_ETH ?? argAmountEth ?? "0.25";

  if (!target) {
    throw new Error(
      "Set TARGET_ADDRESS (and optional FUND_AMOUNT_ETH). Example: TARGET_ADDRESS=0x... FUND_AMOUNT_ETH=1 pnpm run faucet:local",
    );
  }

  const [funder] = await ethers.getSigners();
  const value = ethers.parseEther(amountEth);

  const tx = await funder.sendTransaction({
    to: target,
    value,
  });
  const receipt = await tx.wait();

  const targetBalance = await ethers.provider.getBalance(target);

  console.log("Funder:", funder.address);
  console.log("Target:", target);
  console.log("Amount ETH:", amountEth);
  console.log("Fund tx hash:", tx.hash);
  console.log("Fund block:", receipt?.blockNumber ?? "unknown");
  console.log("Target balance (wei):", targetBalance.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
