import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
  const challengedMode = process.env.CHALLENGED === "1";

  const [sequencer, challenger] = await ethers.getSigners();

  console.log("=== Simplified Optimistic Rollup Workflow ===");
  console.log("Mode:", challengedMode ? "challenged" : "honest");
  console.log("Sequencer:", sequencer.address);
  console.log("Challenger:", challenger.address);

  const challengePeriodSeconds = 60;
  const rollup = await ethers.deployContract("SimpleOptimisticRollup", [challengePeriodSeconds]);
  await rollup.waitForDeployment();

  console.log("Rollup deployed:", await rollup.getAddress());

  const stateRoot = ethers.keccak256(ethers.toUtf8Bytes(`state-${Date.now()}`));
  const txRoot = ethers.keccak256(ethers.toUtf8Bytes(`tx-${Date.now()}`));

  console.log("\n1) Sequencer submits a batch");
  const submitTx = await rollup.connect(sequencer).submitBatch(stateRoot, txRoot);
  await submitTx.wait();
  console.log("Submitted batch #1");

  if (challengedMode) {
    console.log("\n2) Challenger challenges the batch within challenge window");
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("fraud-proof-placeholder"));
    const challengeTx = await rollup.connect(challenger).challengeBatch(1, reasonHash);
    await challengeTx.wait();
    console.log("Batch #1 challenged");
  } else {
    console.log("\n2) No challenge submitted");
  }

  console.log("\n3) Advance time beyond challenge period");
  await ethers.provider.send("evm_increaseTime", [challengePeriodSeconds + 1]);
  await ethers.provider.send("evm_mine", []);

  console.log("\n4) Sequencer tries to finalize");
  try {
    const finalizeTx = await rollup.connect(sequencer).finalizeBatch(1);
    await finalizeTx.wait();
    console.log("Finalize succeeded");
  } catch (error) {
    console.log("Finalize failed (expected in challenged mode)");
    if (error instanceof Error) {
      console.log("Reason:", error.message);
    }
  }

  const batch = await rollup.batches(1);
  console.log("\n5) Final batch state");
  console.log({
    stateRoot: batch.stateRoot,
    txRoot: batch.txRoot,
    submittedAt: batch.submittedAt.toString(),
    challenged: batch.challenged,
    finalized: batch.finalized,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
