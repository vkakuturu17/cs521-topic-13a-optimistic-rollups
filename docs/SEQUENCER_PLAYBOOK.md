# Sequencer Playbook (Laptop A)

This playbook is for the sequencer operator only.

Use alongside [CHALLENGER_PLAYBOOK.md](CHALLENGER_PLAYBOOK.md).

## 0) One-Time Setup

1. Configure `.env` on sequencer laptop:

```env
DEPLOYER_PRIVATE_KEY=0x<sequencer-private-key>
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
CHALLENGE_PERIOD_SECONDS=60
```

2. Install and validate locally:

```bash
pnpm install
pnpm run compile
pnpm run test
```

## 1) Deploy Contract

Run:

```bash
pnpm run deploy:interactive:base-sepolia
```

Copy deployed `CONTRACT_ADDRESS` and send it to challenger.

## 2) Queue-Based Scenario A (Challenger Is Right)

### Sequencer Turn S1

Submit batch with intentionally wrong final state:

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 CLAIMED_FINAL_STATE=19 DELTAS_CSV="5,-2,4,1" pnpm run interactive:submit:base-sepolia
```

Then wait for challenger Turn C1.

### Sequencer Turn S2

After challenger confirms challenge submitted, run bisection round 1:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_STATE_AT_MID=16 CHALLENGER_STATE_AT_MID=13 pnpm run interactive:bisect:base-sepolia
```

Then wait for challenger Turn C2.

### Sequencer Turn S3

Run bisection round 2:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_STATE_AT_MID=15 CHALLENGER_STATE_AT_MID=15 pnpm run interactive:bisect:base-sepolia
```

Then wait for challenger Turn C3 (resolve).

### Sequencer Turn S4

After challenger resolves, inspect status:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 ACCOUNT_ADDRESS=0xSequencerWallet pnpm run interactive:status:base-sepolia
```

Expected: sequencer loses this round, batch invalidated.

## 3) Queue-Based Scenario B (Sequencer Is Right)

### Sequencer Turn S5

Submit honest batch for `BATCH_ID=2`:

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 CLAIMED_FINAL_STATE=18 DELTAS_CSV="5,-2,4,1" pnpm run interactive:submit:base-sepolia
```

Wait for challenger Turn C4.

### Sequencer Turn S6

After challenger starts dispute, run bisection round 1:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_STATE_AT_MID=13 CHALLENGER_STATE_AT_MID=13 pnpm run interactive:bisect:base-sepolia
```

Wait for challenger Turn C5.

### Sequencer Turn S7

Run bisection round 2:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_STATE_AT_MID=18 CHALLENGER_STATE_AT_MID=19 pnpm run interactive:bisect:base-sepolia
```

Wait for challenger Turn C6 (resolve).

### Sequencer Turn S8

Finalize winning batch after resolve:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 pnpm run interactive:finalize:base-sepolia
```

### Sequencer Turn S9

Check claimable rewards:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 ACCOUNT_ADDRESS=0xSequencerWallet pnpm run interactive:status:base-sepolia
```

Optional withdraw:

```bash
CONTRACT_ADDRESS=0xYourContract pnpm run interactive:withdraw:base-sepolia
```
