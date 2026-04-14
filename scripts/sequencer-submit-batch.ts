import { network } from "hardhat";

const { ethers } = await network.connect();

function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    return ethers.ZeroHash;
  }

  let level = [...leaves];

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      const parent = ethers.keccak256(ethers.concat([left, right]));
      nextLevel.push(parent);
    }

    level = nextLevel;
  }

  return level[0];
}

async function main() {
  const [argContractAddress, ...argPayloads] = process.argv.slice(2);
  const contractAddress = process.env.CONTRACT_ADDRESS ?? argContractAddress;
  const envPayloads = (process.env.TX_PAYLOADS ?? "")
    .split("||")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const txPayloads = envPayloads.length > 0 ? envPayloads : argPayloads;

  if (!contractAddress || txPayloads.length === 0) {
    throw new Error(
      "Set CONTRACT_ADDRESS and TX_PAYLOADS (joined by ||). Example: CONTRACT_ADDRESS=0x... TX_PAYLOADS='tx1||tx2||tx3' pnpm run sequencer:submit:batch:base",
    );
  }

  const [sequencer] = await ethers.getSigners();
  const rollup = await ethers.getContractAt("SimpleOptimisticRollup", contractAddress);

  const leafHashes = txPayloads.map((payload) => ethers.keccak256(ethers.toUtf8Bytes(payload)));
  const txRoot = merkleRoot(leafHashes);
  const stateRoot = ethers.keccak256(
    ethers.toUtf8Bytes(`state-after-${txPayloads.length}-txs-${Date.now()}`),
  );

  const tx = await rollup.connect(sequencer).submitBatch(stateRoot, txRoot);
  const receipt = await tx.wait();

  const latestBatchId = await rollup.latestBatchId();

  console.log("Sequencer:", sequencer.address);
  console.log("Contract:", contractAddress);
  console.log("Batch ID:", latestBatchId.toString());
  console.log("State root:", stateRoot);
  console.log("Tx root:", txRoot);
  console.log("Leaf count:", leafHashes.length);
  console.log("Submit tx hash:", tx.hash);
  console.log("Submit block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
