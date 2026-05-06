# Interactive Fraud-Proof Workflow (Phases 1-6)

This document maps the exact game flow used in this repository.

## Phase 1: Commit

1. Sequencer executes transactions off-chain.
2. Sequencer submits:
   - raw instruction data commitment (`instructionCommitment`)
   - claimed post-state hash
3. Sequencer bond is locked.

## Phase 2: Detection

1. Challenger syncs raw instruction data.
2. Challenger re-executes locally and computes post-state hash.
3. If mismatch is detected, challenger opens dispute.

## Phase 3: Dispute

1. Challenger submits challenge and challenger bond.
2. Batch enters active dispute state.

## Phase 4: Bisection Game

1. Sequencer posts midpoint hash for current window.
2. Challenger compares against local midpoint hash and posts challenger midpoint hash.
3. Contract halves disputed window:
   - if midpoint hashes differ -> lower half remains disputed
   - if midpoint hashes match -> upper half remains disputed
4. Repeat until window width is exactly one instruction.

## Phase 5: One-Step Execution

1. Contract takes agreed pre-state hash at step X.
2. Contract applies instruction X and computes expected post-state hash for step X+1.

## Phase 6: Settlement

1. Contract compares expected hash to sequencer and challenger claimed hashes.
2. Wrong party loses bond; winner receives sequencerBond + challengerBond.
3. If sequencer loses, batch is invalidated.
4. If challenger loses, batch remains valid and can finalize after challenge period.

## Example A: Sequencer Fraud (Challenger Wins)

```bash
pnpm run scenario:sequencer-fraud:local
```

Expected result:

- `challengerWon = true`
- `sequencerWon = false`
- `batchInvalidated = true`

## Example B: Challenger False Alarm (Sequencer Wins)

```bash
pnpm run scenario:challenger-fraud:local
```

Expected result:

- `challengerWon = false`
- `sequencerWon = true`
- `batchInvalidated = false`
