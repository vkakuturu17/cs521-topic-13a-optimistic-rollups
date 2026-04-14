import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("InteractiveOptimisticRollup", function () {
  async function deployRollup() {
    const challengePeriod = 60;
    const sequencerBond = ethers.parseEther("1");
    const challengerBond = ethers.parseEther("0.5");
    const rollup = await ethers.deployContract("InteractiveOptimisticRollup", [
      challengePeriod,
      sequencerBond,
      challengerBond,
    ]);
    await rollup.waitForDeployment();
    return { rollup, challengePeriod, sequencerBond, challengerBond };
  }

  it("challenger wins when sequencer's disputed step is wrong", async function () {
    const { rollup, sequencerBond, challengerBond } = await deployRollup();

    const initial = 10n;
    const honestDeltas = [5n, -2n, 4n, 1n];
    const claimedFinalBySequencer = 19n; // Wrong (honest final is 18)
    const challengerFinal = 18n;

    const [, challenger] = await ethers.getSigners();

    await rollup.submitBatch(initial, claimedFinalBySequencer, honestDeltas, { value: sequencerBond });
    await rollup.connect(challenger).initiateChallenge(1, challengerFinal, { value: challengerBond });

    // Round 1: range [0,3], mid=1. Force disagreement on lower half.
    await rollup.bisectDispute(1, 16n, 13n);

    // Round 2: range [0,1], mid=0. Agree on lower half so dispute becomes upper half (index 1).
    await rollup.bisectDispute(1, 15n, 15n);

    // Disputed index is 1. preState=15, expectedPost=13.
    await rollup.resolveSingleStep(1, 14n, 13n);

    const batch = await rollup.batches(1);
    const dispute = await rollup.disputes(1);

    expect(batch.invalidated).to.equal(true);
    expect(dispute.challengerWon).to.equal(true);
    expect(dispute.sequencerWon).to.equal(false);
    expect(await rollup.claimableBalances(challenger.address)).to.equal(sequencerBond + challengerBond);

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    await expect(rollup.finalizeBatch(1)).to.be.revertedWithCustomError(rollup, "BatchInvalidated");
  });

  it("sequencer wins when challenger's disputed step is wrong", async function () {
    const { rollup, sequencerBond, challengerBond } = await deployRollup();

    const initial = 10n;
    const deltas = [5n, -2n, 4n, 1n];
    const sequencerFinal = 18n;
    const challengerFinal = 20n;

    await rollup.submitBatch(initial, sequencerFinal, deltas, { value: sequencerBond });
    await rollup.initiateChallenge(1, challengerFinal, { value: challengerBond });

    // Round 1: [0,3], mid=1, agree so dispute -> [2,3]
    await rollup.bisectDispute(1, 13n, 13n);

    // Round 2: [2,3], mid=2, disagree so dispute -> [2,2]
    await rollup.bisectDispute(1, 18n, 19n);

    // Disputed index is 2. preState=13, expectedPost=17.
    await rollup.resolveSingleStep(1, 17n, 18n);

    const batch = await rollup.batches(1);
    const dispute = await rollup.disputes(1);

    expect(batch.invalidated).to.equal(false);
    expect(batch.challenged).to.equal(false);
    expect(dispute.challengerWon).to.equal(false);
    expect(dispute.sequencerWon).to.equal(true);
    const [sequencer] = await ethers.getSigners();
    expect(await rollup.claimableBalances(sequencer.address)).to.equal(sequencerBond + challengerBond);

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    await expect(rollup.finalizeBatch(1)).to.emit(rollup, "BatchFinalized");
  });

  it("can expose stored tx deltas", async function () {
    const { rollup, sequencerBond } = await deployRollup();
    const deltas = [1n, 2n, 3n];
    await rollup.submitBatch(0n, 6n, deltas, { value: sequencerBond });

    const stored = await rollup.getBatchDeltas(1);
    expect(stored.map((x) => BigInt(x.toString()))).to.deep.equal(deltas);
  });

  it("returns sequencer bond on unchallenged finalize", async function () {
    const { rollup, sequencerBond } = await deployRollup();
    const [sequencer] = await ethers.getSigners();

    await rollup.submitBatch(0n, 2n, [1n, 1n], { value: sequencerBond });
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);
    await rollup.finalizeBatch(1);

    expect(await rollup.claimableBalances(sequencer.address)).to.equal(sequencerBond);
  });
});
