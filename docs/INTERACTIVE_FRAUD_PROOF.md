# Interactive Fraud Proof Workflow

This guide demonstrates two outcomes using the `InteractiveOptimisticRollup` contract:

1. Challenger is right (sequencer submitted an invalid transition)
2. Sequencer is right (challenger made an incorrect claim)

This version includes staking and slashing economics.

## Contract Model

The contract stores transaction deltas for each batch on-chain, then uses an interactive bisection game:

1. Sequencer submits a batch with:
   - `initialState`
   - `claimedFinalState`
   - `deltas[]` (the transaction effects)
2. Challenger opens dispute with their own claimed final state.
3. Both sides iteratively provide mid-state claims (`bisectDispute`) to narrow the disputed range.
4. When one index remains, `resolveSingleStep` checks exactly that step against on-chain tx delta.
5. Winner is determined and batch either:
   - invalidates (challenger right), or
   - becomes finalizable (sequencer right).

## Staking / Slashing Rules

- Sequencer posts `sequencerBond` when submitting a batch.
- Challenger posts `challengerBond` when opening a dispute.
- If challenger wins, challenger receives both bonds.
- If sequencer wins, sequencer receives both bonds.
- If no challenge occurs and batch finalizes, sequencer receives their bond back.
- Payouts accumulate in `claimableBalances` and can be withdrawn via `withdrawClaimable()`.

## Why This Is "Interactive"

Instead of replaying all steps on L1, the dispute interval is halved each round.
Rounds are $O(\log_2 n)$ for $n$ transitions.
Only one transition is fully adjudicated at the end.

## Run It

Install and compile:

```bash
pnpm install
pnpm run compile
pnpm run test
```

Always run tests locally before deployment.

Run scenario A (challenger right):

```bash
pnpm run workflow:interactive:challenger-right
```

Expected outcome:

- dispute resolves in challenger favor
- batch is invalidated
- finalize reverts
- challenger has claimable bond rewards

Run scenario B (sequencer right):

```bash
pnpm run workflow:interactive:sequencer-right
```

Expected outcome:

- dispute resolves in sequencer favor
- batch challenge clears
- finalize succeeds
- sequencer has claimable bond rewards

## Where Transactions Are Stored

For this interactive model, transactions are stored on-chain in `batchDeltas` within:

- [contracts/InteractiveOptimisticRollup.sol](contracts/InteractiveOptimisticRollup.sol)

You can inspect them via:

- `getBatchDeltas(batchId)`
- `getDeltaAt(batchId, index)`

## Notes

- This is still a simplified educational model.
- A production rollup uses state commitments, proofs, and DA layers with stronger economics.
