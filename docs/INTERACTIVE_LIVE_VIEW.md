# Interactive Live View (Real-Time Contract State)

Use this during your two-laptop workflow to see an always-updated on-chain view.

What it shows in real time:

- Batch core state (`challenged`, `finalized`, `invalidated`)
- Deltas (your transaction effects) and derived state path
- Dispute range (`start..end`) during bisection
- Single-step expected verification values when narrowed to one index
- Stakes/bonds and current total at risk
- Decoded contract events with tx hash and block
- Optional claimable balance for one tracked account

## Command

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 ACCOUNT_ADDRESS=0xYourWallet POLL_SECONDS=5 pnpm run interactive:live:base-sepolia
```

Notes:

- `BATCH_ID` optional: defaults to latest batch.
- `ACCOUNT_ADDRESS` optional: shows claimable balance for that address.
- `POLL_SECONDS` optional: default `5`.

## What "bad transaction" means in this model

Each transaction is represented as one delta in `batchDeltas`.

When dispute narrows to single index `i`, the script prints:

- `preState`
- `delta[i]`
- `expectedPostState = preState + delta[i]`

The side whose claimed post-state matches `expectedPostState` is correct.

## Useful Pairing During Workflow

Terminal 1 (live monitor):

```bash
CONTRACT_ADDRESS=0xYourContract BATCH_ID=1 ACCOUNT_ADDRESS=0xSequencerOrChallenger POLL_SECONDS=3 pnpm run interactive:live:base-sepolia
```

Terminal 2 (role actions):

- Sequencer follows [SEQUENCER_PLAYBOOK.md](SEQUENCER_PLAYBOOK.md)
- Challenger follows [CHALLENGER_PLAYBOOK.md](CHALLENGER_PLAYBOOK.md)

As each tx is mined, the monitor prints the decoded event and updated state snapshot.
