import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("SimpleOptimisticRollup", function () {
  async function deployRollup() {
    const challengePeriod = 60;
    const rollup = await ethers.deployContract("SimpleOptimisticRollup", [challengePeriod]);
    await rollup.waitForDeployment();

    return { rollup, challengePeriod };
  }

  it("submits and finalizes a batch after challenge period", async function () {
    const { rollup, challengePeriod } = await deployRollup();

    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state-1"));
    const txRoot = ethers.keccak256(ethers.toUtf8Bytes("tx-1"));

    await expect(rollup.submitBatch(stateRoot, txRoot)).to.emit(rollup, "BatchSubmitted");

    await ethers.provider.send("evm_increaseTime", [challengePeriod + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(rollup.finalizeBatch(1)).to.emit(rollup, "BatchFinalized");

    const batch = await rollup.batches(1);
    expect(batch.finalized).to.equal(true);
  });

  it("prevents finalization when challenged", async function () {
    const { rollup, challengePeriod } = await deployRollup();
    const [, challenger] = await ethers.getSigners();

    const stateRoot = ethers.keccak256(ethers.toUtf8Bytes("state-2"));
    const txRoot = ethers.keccak256(ethers.toUtf8Bytes("tx-2"));
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("fraud-proof-placeholder"));

    await rollup.submitBatch(stateRoot, txRoot);
    await rollup.connect(challenger).challengeBatch(1, reasonHash);

    await ethers.provider.send("evm_increaseTime", [challengePeriod + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(rollup.finalizeBatch(1)).to.be.revertedWithCustomError(rollup, "BatchIsChallenged");
  });
});
