# Runner Scripts Only

Both runners now participate in a turn-based dispute protocol.

- Sequencer submits sequencer midpoint and single-step claims.
- Challenger submits challenger midpoint and single-step claims.
- Keep both terminals running during dispute rounds.
- Commands below assume wallet/network values are already present in your `.env`.

## Quick Start

Sequencer:

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 SUBMITTED_DELTAS_CSV="5,-2,4,1" POLL_SECONDS=3 pnpm run interactive:sequencer:runner:base-sepolia
```

Challenger:

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 POLL_SECONDS=3 pnpm run interactive:challenger:runner:base-sepolia
```

## Sequencer Runner

```bash
CONTRACT_ADDRESS=0xYourContract INITIAL_STATE=10 SUBMITTED_DELTAS_CSV="5,-2,4,1" POLL_SECONDS=3 pnpm run interactive:sequencer:runner:base-sepolia
```

Optional:

```bash
# Deltas used by sequencer assertion math (defaults to SUBMITTED_DELTAS_CSV)
ACTUAL_USED_DELTAS_CSV="5,-2,5,1"

# Step-by-step demo mode is ON by default. Type yes to continue each action.
# Set STEP_MODE=false to run without pauses.
STEP_MODE=false

# Stop after N polls
MAX_POLLS=7200
```

## Challenger Runner

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 POLL_SECONDS=3 pnpm run interactive:challenger:runner:base-sepolia
```

Optional:

```bash

# Intentional wrong-challenger simulation path (takes precedence over CHALLENGER_DELTAS_CSV)
CHALLENGER_WRONG_DELTAS="5,-2,5,2"

# Step-by-step demo mode is ON by default. Type yes to continue each action.
# Set STEP_MODE=false to run without pauses.
STEP_MODE=false

# Stop after N polls
MAX_POLLS=7200
```

## Local Network Variants

```bash
pnpm run interactive:sequencer:runner:local
pnpm run interactive:challenger:runner:local
```

## Scenario 1: Sequencer Wrong (Challenger Honest)

Goal: sequencer submits one delta batch but uses a different assertion path, so challenger should win.

Terminal 1 (sequencer):

```bash
CONTRACT_ADDRESS=0xYourContract \
INITIAL_STATE=10 \
SUBMITTED_DELTAS_CSV="5,-2,4,1" \
ACTUAL_USED_DELTAS_CSV="5,-2,5,1" \
POLL_SECONDS=3 \
pnpm run interactive:sequencer:runner:base-sepolia
```

Terminal 2 (challenger, honest/default):

```bash
CONTRACT_ADDRESS=0xYourContract \
BATCH_ID=1 \
POLL_SECONDS=3 \
pnpm run interactive:challenger:runner:base-sepolia
```

Expected outcome: challenger wins and batch is invalidated.

## Scenario 2: Challenger Wrong (Sequencer Honest)

Goal: sequencer stays consistent, challenger intentionally uses wrong deltas via CHALLENGER_WRONG_DELTAS.

Terminal 1 (sequencer, honest):

```bash
CONTRACT_ADDRESS=0xYourContract \
INITIAL_STATE=10 \
SUBMITTED_DELTAS_CSV="5,-2,4,1" \
POLL_SECONDS=3 \
pnpm run interactive:sequencer:runner:base-sepolia
```

Terminal 2 (challenger, intentionally wrong):

```bash
CONTRACT_ADDRESS=0xYourContract \
BATCH_ID=1 \
CHALLENGER_WRONG_DELTAS="5,-2,5,2" \
POLL_SECONDS=3 \
pnpm run interactive:challenger:runner:base-sepolia
```

Expected outcome: challenger challenge fails, sequencer can finalize after dispute/challenge flow completes.
