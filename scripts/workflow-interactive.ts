import { network } from "hardhat";

const { ethers } = await network.connect();

type Mode = "challenger-right" | "sequencer-right";

function parseMode(): Mode {
  const mode = (process.env.INTERACTIVE_MODE ?? "challenger-right").trim();
  if (mode === "challenger-right" || mode === "sequencer-right") {
    return mode;
  }
  throw new Error("INTERACTIVE_MODE must be challenger-right or sequencer-right");
}

async function main() {
  const mode = parseMode();
  const [sequencer, challenger] = await ethers.getSigners();

  console.log("=== Interactive Fraud Proof Workflow ===");
  console.log("Mode:", mode);
  console.log("Sequencer:", sequencer.address);
  console.log("Challenger:", challenger.address);

  const challengePeriod = 60;
  const sequencerBond = ethers.parseEther("1");
  const challengerBond = ethers.parseEther("0.5");
  const rollup = await ethers.deployContract("InteractiveOptimisticRollup", [
    challengePeriod,
    sequencerBond,
    challengerBond,
  ]);
  await rollup.waitForDeployment();
  const address = await rollup.getAddress();

  console.log("Contract:", address);
  console.log("Sequencer bond:", ethers.formatEther(sequencerBond), "ETH");
  console.log("Challenger bond:", ethers.formatEther(challengerBond), "ETH");

  const initial = 10n;
  const deltas = [5n, -2n, 4n, 1n];

  const sequencerFinal = mode === "challenger-right" ? 19n : 18n;
  const challengerFinal = mode === "challenger-right" ? 18n : 20n;

  const submitTx = await rollup
    .connect(sequencer)
    .submitBatch(initial, sequencerFinal, deltas, { value: sequencerBond });
  await submitTx.wait();
  console.log("Submit tx:", submitTx.hash);

  const challengeTx = await rollup
    .connect(challenger)
    .initiateChallenge(1, challengerFinal, { value: challengerBond });
  await challengeTx.wait();
  console.log("Challenge tx:", challengeTx.hash);

  if (mode === "challenger-right") {
    // [0,3] mid=1 -> disagree => [0,1]
    const b1 = await rollup.connect(sequencer).bisectDispute(1, 16n, 13n);
    await b1.wait();
    // [0,1] mid=0 -> agree => [1,1]
    const b2 = await rollup.connect(sequencer).bisectDispute(1, 15n, 15n);
    await b2.wait();

    // index=1, expected=13. Sequencer wrong, challenger right.
    const resolveTx = await rollup.connect(challenger).resolveSingleStep(1, 14n, 13n);
    await resolveTx.wait();
    console.log("Resolve tx:", resolveTx.hash);

    const batch = await rollup.batches(1);
    console.log({ invalidated: batch.invalidated, challenged: batch.challenged, finalized: batch.finalized });
    console.log(
      "Challenger claimable ETH:",
      ethers.formatEther(await rollup.claimableBalances(challenger.address)),
    );

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    try {
      await rollup.finalizeBatch(1);
      console.log("Unexpected: finalize succeeded");
    } catch (error) {
      console.log("Expected: finalize reverted for invalidated batch");
      if (error instanceof Error) {
        console.log("Reason:", error.message);
      }
    }
  } else {
    // [0,3] mid=1 -> agree => [2,3]
    const b1 = await rollup.connect(sequencer).bisectDispute(1, 13n, 13n);
    await b1.wait();
    // [2,3] mid=2 -> disagree => [2,2]
    const b2 = await rollup.connect(sequencer).bisectDispute(1, 18n, 19n);
    await b2.wait();

    // index=2, expected=17. Sequencer right, challenger wrong.
    const resolveTx = await rollup.connect(challenger).resolveSingleStep(1, 17n, 18n);
    await resolveTx.wait();
    console.log("Resolve tx:", resolveTx.hash);

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    const finalizeTx = await rollup.finalizeBatch(1);
    await finalizeTx.wait();
    console.log("Finalize tx:", finalizeTx.hash);

    const batch = await rollup.batches(1);
    console.log({ invalidated: batch.invalidated, challenged: batch.challenged, finalized: batch.finalized });
    console.log(
      "Sequencer claimable ETH:",
      ethers.formatEther(await rollup.claimableBalances(sequencer.address)),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
