import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const [sequencer, challenger] = await ethers.getSigners();
  const challengePeriodSeconds = 60;

  console.log("=== Workflow: Challenger Is Wrong ===");
  console.log("Sequencer:", sequencer.address);
  console.log("Challenger:", challenger.address);

  const rollup = await ethers.deployContract("SimpleOptimisticRollup", [challengePeriodSeconds]);
  await rollup.waitForDeployment();
  const address = await rollup.getAddress();

  console.log("Rollup deployed:", address);

  const stateRoot = ethers.keccak256(ethers.toUtf8Bytes(`state-${Date.now()}`));
  const txRoot = ethers.keccak256(ethers.toUtf8Bytes(`tx-${Date.now()}`));

  const submitTx = await rollup.connect(sequencer).submitBatch(stateRoot, txRoot);
  await submitTx.wait();
  console.log("Submitted batch #1, tx:", submitTx.hash);

  await ethers.provider.send("evm_increaseTime", [challengePeriodSeconds + 1]);
  await ethers.provider.send("evm_mine", []);
  console.log("Advanced time beyond challenge window");

  const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("late challenge"));
  try {
    const challengeTx = await rollup.connect(challenger).challengeBatch(1, reasonHash);
    await challengeTx.wait();
    console.log("Unexpected: challenge succeeded", challengeTx.hash);
  } catch (error) {
    console.log("Expected: late challenge reverted (challenger was wrong)");
    if (error instanceof Error) {
      console.log("Reason:", error.message);
    }
  }

  const finalizeTx = await rollup.connect(sequencer).finalizeBatch(1);
  await finalizeTx.wait();
  console.log("Finalize succeeded, tx:", finalizeTx.hash);

  const batch = await rollup.batches(1);
  console.log({
    challenged: batch.challenged,
    finalized: batch.finalized,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
