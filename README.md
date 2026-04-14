# CS521 Topic 13A: Simplified Optimistic Rollup (Hardhat 3 + pnpm)

This repository sets up a local Ethereum development environment using Hardhat 3, managed with pnpm, to build and test a simplified optimistic rollup flow.

## Stack

- pnpm (package manager)
- Hardhat (local EVM node, compile, test, deploy)
- Solidity 0.8.24

## What Is Included

- `contracts/SimpleOptimisticRollup.sol`
	- Submit batches (`submitBatch`)
	- Challenge batches within a challenge window (`challengeBatch`)
	- Finalize unchallenged batches after challenge period (`finalizeBatch`)
- `scripts/deploy.ts`
	- Deploys `SimpleOptimisticRollup` with a default 60-second challenge period
- `test/SimpleOptimisticRollup.ts`
	- Basic flow tests: finalize-after-window and block-finalize-if-challenged

## Getting Started

Install dependencies:

```bash
pnpm install
```

Compile contracts:

```bash
pnpm run compile
```

Run tests:

```bash
pnpm run test
```

## Run a Local Blockchain

Start a local Hardhat node in one terminal:

```bash
pnpm run node
```

Deploy the contract from another terminal:

```bash
pnpm run deploy:local
```

You can also deploy to the in-memory Hardhat network directly:

```bash
pnpm run deploy:hardhat
```

## Deploy To Base Network

Create a `.env` from `.env.example` and set:

- `DEPLOYER_PRIVATE_KEY` (0x-prefixed deployer EOA private key)
- Optional `BASE_RPC_URL` and `BASE_SEPOLIA_RPC_URL`

Recommended: deploy to Base Sepolia first.

```bash
pnpm run deploy:base-sepolia
```

Then deploy to Base mainnet:

```bash
pnpm run deploy:base
```

Important: your deployer wallet must hold ETH on the target Base network for gas.

## Roleplay The Full Rollup Workflow

### Fast simulation (single command)

Run a full in-memory workflow where sequencer submits and then finalizes:

```bash
pnpm run workflow:honest
```

Run the challenged path where finalization should fail:

```bash
pnpm run workflow:challenged
```

### Manual role-by-role flow (two terminals)

Terminal A: start local chain

```bash
pnpm run node
```

Terminal B: deploy contract and copy the printed address

```bash
pnpm run deploy:local
```

Use that contract address below as <ROLLUP_ADDRESS>.

Sequencer submits a batch:

```bash
pnpm run sequencer:submit -- <ROLLUP_ADDRESS> demo1
```

Optional challenger action:

```bash
pnpm run challenger:challenge -- <ROLLUP_ADDRESS> 1 "invalid state transition"
```

Advance time beyond challenge window (60s):

```bash
pnpm run time:increase -- 61
```

Try to finalize:

```bash
pnpm run finalize:batch -- <ROLLUP_ADDRESS> 1
```

Inspect resulting batch state:

```bash
pnpm run batch:status -- <ROLLUP_ADDRESS> 1
```

## Suggested Next Build Steps

1. Add an `L2OutputOracle` contract to track finalized state roots.
2. Add stake/bond logic for batch submitters and challengers.
3. Replace placeholder challenge logic with a real fraud-proof game.
4. Add an L1 bridge mock (deposit/withdraw queue) to simulate cross-domain messaging.
