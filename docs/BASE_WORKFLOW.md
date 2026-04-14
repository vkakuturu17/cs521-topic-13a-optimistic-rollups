# Base Workflow Runbook (Two Laptops)

This runbook is fully updated for testing the interactive fraud-proof contract with two real operators on separate laptops:

1. Sequencer laptop
2. Challenger laptop

Both laptops call the same deployed contract address.

Role-specific playbooks:

- [SEQUENCER_PLAYBOOK.md](SEQUENCER_PLAYBOOK.md)
- [CHALLENGER_PLAYBOOK.md](CHALLENGER_PLAYBOOK.md)

## Shared Queue (Who Runs Next)

Use this exact queue so both operators stay synchronized:

1. `S1` Sequencer submit batch 1 (wrong final state)
2. `C1` Challenger challenge batch 1
3. `S2` Sequencer bisect round 1 (batch 1)
4. `S3` Sequencer bisect round 2 (batch 1)
5. `C3` Challenger resolve batch 1 (challenger right)
6. `S5` Sequencer submit batch 2 (honest final state)
7. `C4` Challenger challenge batch 2 with wrong claim
8. `S6` Sequencer bisect round 1 (batch 2)
9. `S7` Sequencer bisect round 2 (batch 2)
10. `C6` Challenger resolve batch 2 (sequencer right)
11. `S8` Sequencer finalize batch 2
12. `S9/C6` Both check status and withdraw claimable rewards

Rule: do not run your next step until the previous step's tx hash is shared in chat.

## 1) Local Validation First (Required)

Run this before any live deployment:

```bash
pnpm install
pnpm run compile
pnpm run test
pnpm run workflow:interactive:challenger-right
pnpm run workflow:interactive:sequencer-right
```

This ensures interactive verification plus staking/slashing logic works locally.

## 2) Wallet And .env Per Laptop

Use a separate `.env` file on each laptop.

### Sequencer laptop

```env
DEPLOYER_PRIVATE_KEY=0x<sequencer-private-key>
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
CHALLENGE_PERIOD_SECONDS=60
```

### Challenger laptop

```env
DEPLOYER_PRIVATE_KEY=0x<challenger-private-key>
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Each side uses its own key as `DEPLOYER_PRIVATE_KEY` for signing role actions.

## 3) Fund Both Wallets

Run this on each laptop:

```bash
TARGET_ADDRESS=0xYourWallet pnpm run balance:base-sepolia
```

Ensure enough Base Sepolia ETH for multiple transactions and bonds.

## 4) Deploy Interactive Contract (Sequencer Laptop)

```bash
pnpm run deploy:interactive:base-sepolia
```

Copy and share the deployed `CONTRACT_ADDRESS` with challenger laptop.

## 5) Scenario A: Challenger Is Right

### Sequencer submits batch with wrong final state

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 CLAIMED_FINAL_STATE=19 DELTAS_CSV="5,-2,4,1" pnpm run interactive:submit:base-sepolia
```

### Challenger opens dispute

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 CHALLENGER_FINAL_STATE=18 pnpm run interactive:challenge:base-sepolia
```

### Bisection rounds

Round 1:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_STATE_AT_MID=16 CHALLENGER_STATE_AT_MID=13 pnpm run interactive:bisect:base-sepolia
```

Round 2:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_STATE_AT_MID=15 CHALLENGER_STATE_AT_MID=15 pnpm run interactive:bisect:base-sepolia
```

### Resolve single-step dispute

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_CLAIMED_POST_STATE=14 CHALLENGER_CLAIMED_POST_STATE=13 pnpm run interactive:resolve:base-sepolia
```

### Check status and challenger claimable rewards

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 ACCOUNT_ADDRESS=0xChallengerWallet pnpm run interactive:status:base-sepolia
```

Expected: `challengerWon=true`, `invalidated=true`, challenger claimable includes both bonds.

## 6) Scenario B: Sequencer Is Right

Use a new batch (`BATCH_ID=2`).

### Sequencer submits honest batch

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 CLAIMED_FINAL_STATE=18 DELTAS_CSV="5,-2,4,1" pnpm run interactive:submit:base-sepolia
```

### Challenger makes incorrect dispute

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 CHALLENGER_FINAL_STATE=20 pnpm run interactive:challenge:base-sepolia
```

### Bisection rounds

Round 1:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_STATE_AT_MID=13 CHALLENGER_STATE_AT_MID=13 pnpm run interactive:bisect:base-sepolia
```

Round 2:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_STATE_AT_MID=18 CHALLENGER_STATE_AT_MID=19 pnpm run interactive:bisect:base-sepolia
```

### Resolve in sequencer favor

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_CLAIMED_POST_STATE=17 CHALLENGER_CLAIMED_POST_STATE=18 pnpm run interactive:resolve:base-sepolia
```

### Wait challenge period and finalize

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 pnpm run interactive:finalize:base-sepolia
```

### Check status and sequencer claimable rewards

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 ACCOUNT_ADDRESS=0xSequencerWallet pnpm run interactive:status:base-sepolia
```

Expected: `sequencerWon=true`, `invalidated=false`, `finalized=true`, sequencer claimable includes both bonds.

## 7) Withdraw Claimable Rewards

Run from whichever wallet should receive payout:

```bash
CONTRACT_ADDRESS=0xYourContract pnpm run interactive:withdraw:base-sepolia
```

## 8) Optional Local Two-Laptop Mode

If both laptops are on same LAN and one runs Hardhat node accessible on LAN IP, both can target that RPC and use `interactive:*:local` commands. Base Sepolia is usually simpler and more realistic for two-machine testing.

## 9) On-Chain Storage In Interactive Contract

Stored on-chain:

- `batchDeltas` (transaction effects)
- dispute range/state/winner
- claimable balances for bond payouts

Helpers:

- `interactive:status:*`
- `getBatchDeltas(batchId)`
- `getDeltaAt(batchId, index)`
