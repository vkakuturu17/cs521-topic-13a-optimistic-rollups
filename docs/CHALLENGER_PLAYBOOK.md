# Challenger Playbook (Laptop B)

This playbook is for the challenger operator only.

Use alongside [SEQUENCER_PLAYBOOK.md](SEQUENCER_PLAYBOOK.md).

## Single Program Mode (Recommended)

Instead of manually running challenge/bisect/resolve, you can run one challenger process.

It will:

1. wait for batch existence,
2. submit challenge with challenger bond,
3. run bisection rounds automatically,
4. resolve single-step when narrowed,
5. print terminal outcome and whether challenger funds are claimable.

Important inputs:

- `BATCH_ID`: batch to challenge.
- `CHALLENGER_DELTAS_CSV` (optional): challenger's local transaction deltas.

If `CHALLENGER_DELTAS_CSV` is omitted, challenger uses on-chain batch deltas and no disagreement is injected.

Scenario A (challenger right, batch 1):

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 CHALLENGER_DELTAS_CSV="5,-2,4,1" POLL_SECONDS=3 pnpm run interactive:challenger:runner:base-sepolia
```

Scenario B (challenger wrong, batch 2):

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 CHALLENGER_DELTAS_CSV="5,-2,5,2" POLL_SECONDS=3 pnpm run interactive:challenger:runner:base-sepolia
```

Optional:

- `MAX_POLLS=7200` (default) to cap total loop iterations.

Optional real-time monitor:

```bash
CONTRACT_ADDRESS=0x3DB05297BC19396f0c1B9c73DD8E78c44Ec498de BATCH_ID=1 POLL_SECONDS=20 pnpm run interactive:live:base-sepolia
```

## 0) One-Time Setup

1. Configure `.env` on challenger laptop:

```env
DEPLOYER_PRIVATE_KEY=0x<challenger-private-key>
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

2. Install:

```bash
pnpm install
pnpm run compile
```

## 1) Wait For Contract Address

Get `CONTRACT_ADDRESS` from sequencer after deployment.

## 2) Queue-Based Scenario A (Challenger Is Right)

### Challenger Turn C1

After sequencer Turn S1 (batch submit), open dispute:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 CHALLENGER_FINAL_STATE=18 pnpm run interactive:challenge:base-sepolia
```

Then notify sequencer to run Turn S2.

### Challenger Turn C2

After sequencer Turn S2, wait for sequencer Turn S3.

### Challenger Turn C3

After sequencer Turn S3, resolve disputed single step in challenger favor:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 SEQUENCER_CLAIMED_POST_STATE=14 CHALLENGER_CLAIMED_POST_STATE=13 pnpm run interactive:resolve:base-sepolia
```

Check status/reward:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 pnpm run interactive:status:base-sepolia
```

Optional withdraw:

```bash
CONTRACT_ADDRESS=0xYourContract pnpm run interactive:withdraw:base-sepolia
```

## 3) Queue-Based Scenario B (Sequencer Is Right)

### Challenger Turn C4

After sequencer Turn S5 (batch submit for id 2), start challenge with wrong final state claim:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 CHALLENGER_FINAL_STATE=20 pnpm run interactive:challenge:base-sepolia
```

Notify sequencer to run Turn S6.

### Challenger Turn C5

After sequencer Turn S6, wait for sequencer Turn S7.

### Challenger Turn C6

After sequencer Turn S7, resolve in sequencer favor:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 SEQUENCER_CLAIMED_POST_STATE=17 CHALLENGER_CLAIMED_POST_STATE=18 pnpm run interactive:resolve:base-sepolia
```

Then wait for sequencer finalize (Turn S8), and verify status:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=2 pnpm run interactive:status:base-sepolia
```

Expected: challenger loses this round.
