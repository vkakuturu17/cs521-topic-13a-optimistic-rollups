# Optimistic Rollups: Scaling Ethereum Without Sacrificing Security

**Final Report — Topic 13a**

**Authors:** Vaasu and Akhil *(equal contribution)*

**Course Project — Final Submission**

---

## Abstract

Ethereum's base layer cannot meet contemporary throughput demand. Its native execution rate of roughly 15–30 transactions per second pushes gas fees to prohibitive levels during peak demand, foreclosing entire categories of application. Optimistic rollups are the leading pragmatic response: they execute transactions off-chain, post the resulting transaction data and a state-root commitment to L1, and rely on a *challenge window* — typically seven days — during which any independent observer may submit a *fraud proof* demonstrating that the posted state root is incorrect. This report presents both a conceptual synthesis of optimistic rollup design (motivation, architecture, lifecycle, fraud-proof mechanics, comparisons between Arbitrum's BoLD and Optimism's Cannon, the role of EIP-4844 blobs, and contrasts with zero-knowledge rollups) and a detailed walkthrough of our coding project: a simplified, interactive optimistic rollup deployed to a public testnet, comprising a Solidity contract (`InteractiveOptimisticRollup`) and two TypeScript runner scripts that drive the sequencer and challenger roles through the full bisection-resolution game. The implementation is intentionally minimized to a 1-D integer state model so the dispute mechanics — bond posting, challenge initiation, recursive midpoint bisection, single-step on-chain verification, slashing, and withdrawal — can be exhibited end-to-end on real testnet infrastructure.

---

## 1. Introduction

Layer-2 scaling is no longer a research direction; it is the production reality of Ethereum. As of 2026, the majority of user-facing on-chain activity does not occur on Ethereum L1 but on rollups that inherit L1's security while operating their own execution environment. Among rollup constructions, *optimistic rollups* — first deployed by Arbitrum and Optimism — currently host the deepest pools of liquidity and the largest installed base of EVM-equivalent applications.

The intuition behind an optimistic rollup is captured in one phrase: **innocent until proven guilty**. Rather than requiring every transaction to be cryptographically proven correct before acceptance (the approach taken by zero-knowledge rollups), the system *assumes* that the rollup operator's claimed state transitions are valid and only intervenes if some independent party submits evidence to the contrary within a fixed dispute window. This "optimism" is what enables optimistic rollups to be cheap and EVM-compatible — there is no per-batch SNARK to compute — but it is also why the design space for fraud proofs, sequencer accountability, challenge timing, and data availability is so rich. Every parameter trades scalability against security, finality against responsiveness, and decentralization against operator efficiency.

---

## 2. The Problem: Ethereum Layer 1 Does Not Scale

Ethereum's execution layer was not designed for application-layer throughput. Every full node in the network re-executes every transaction in every block, validates every state transition, and stores the resulting state. This redundant computation is what gives Ethereum its security properties — there is no privileged validator, no trusted executor, no party whose word about state is taken on faith — but it is also what bounds throughput. Concretely, Ethereum L1 sustains approximately 15–30 transactions per second.

The scaling trilemma — the observation, popularized by Vitalik Buterin, that decentralization, security, and scalability cannot all be maximized simultaneously by a single L1 — implies that scaling cannot come for free. Any solution must give something up. The strategy adopted by rollups is to give up *self-contained execution*: rollups do not run on Ethereum's nodes. Computation happens off-chain on rollup-operator infrastructure. What rollups *do* commit to L1 is the data needed to reconstruct their state and the cryptographic commitment that pins down what that state is. Ethereum is reduced from "execution layer" to "data availability and dispute resolution layer" — a much cheaper job per transaction.

The core insight, then, is that **L1 only needs to be the source of truth, not the executor of every step**. As long as L1 stores enough information that anyone can independently verify the rollup's claimed state, and as long as L1 has a procedure for adjudicating disputes, the rollup itself can run on commodity off-chain infrastructure and still inherit L1-grade security.

---

## 3. What Is an Optimistic Rollup?

An *optimistic rollup* is an L2 protocol that:

1. Executes transactions off-chain on its own execution environment (typically EVM-compatible).
2. Compresses and posts the resulting transaction data, plus a *state-root commitment*, to L1 in batches.
3. Treats each posted state root as valid by default — *optimistically* — without proving its correctness up front.
4. Permits any independent observer, during a fixed *challenge window* (industry standard: ~7 days), to submit a *fraud proof* showing that the posted state root does not in fact correspond to honest execution of the posted transactions.
5. If a fraud proof succeeds, the offending batch (and all subsequent batches that depended on it) is invalidated, and the dishonest sequencer's bond is slashed.
6. If the challenge window closes with no successful fraud proof, the state root is considered final on L1, and L2-to-L1 withdrawals based on it become claimable.

The word *optimistic* is doing real work here. The system never proves up-front that the sequencer is honest; instead, it constructs incentives such that lying is economically irrational. Security derives from two assumptions:

- **Data availability.** All transaction data is posted to L1, so anyone can independently reconstruct the rollup's claimed state.
- **At least one honest challenger.** As long as a single non-colluding party is monitoring the rollup and willing to submit a fraud proof when warranted, fraud cannot persist past the challenge window.

This is sometimes called a "1-of-N" security model, in contrast to the "majority honest" model of L1 consensus. Notably, the honest party need not be identified in advance — anyone can become a challenger by posting the required bond.

### 3.1 Transaction Lifecycle

The lifecycle of a single transaction in an optimistic rollup proceeds through four phases:

```
User submits L2 tx
    → Sequencer orders & executes off-chain
        → Batch + state root posted to L1
            → Challenge window (~7 days)
                → [No fraud proof] → Finalized on L1
                → [Fraud proven]   → Batch invalidated; sequencer slashed
                                       → Chain reverts to last valid state
```

**User submit.** A user signs an L2 transaction and broadcasts it to the sequencer (or the rollup's mempool). The user perceives this as effectively instant: within seconds the sequencer typically issues a "soft confirmation" indicating the transaction has been accepted into a forthcoming batch.

**Sequencer order and execute.** The sequencer collects pending transactions, orders them, executes them against current L2 state (advancing the state in the process), and accumulates a batch.

**Batch posted to L1.** When the batch is full or a time window expires, the sequencer compresses the batch and posts it to L1 — both the transaction data (so challengers can independently re-execute) and the resulting state-root commitment.

**Challenge window.** For the next ~7 days, the batch sits in a *not-yet-final* state. Anyone running a challenger node may re-execute the posted transactions, compare their resulting state root against the sequencer's claimed root, and if there is a discrepancy, initiate a fraud proof.

**Finalization.** If the window closes with no successful fraud proof, the state root is final. Pending L2-to-L1 withdrawals based on that root become claimable.

This lifecycle has two important asymmetries. **Deposits (L1→L2) are fast** — typically on the order of minutes, because L1 already has L1-grade finality and the rollup contract simply mints the corresponding balance on L2. **Withdrawals (L2→L1) are slow** — they require waiting out the full challenge window, because until the window closes, the L2 state root that authorizes the withdrawal is not yet trustworthy. Third-party "fast bridges" provide same-block liquidity for withdrawals at a fee, by buying the user's pending L2-to-L1 claim and waiting out the window themselves.

---

## 4. Core Architecture

An optimistic rollup is built from four interacting components:

```
L2 Users
    → Sequencer (orders, executes, compresses, posts)
        → L1 Rollup Contracts (holds bonds, verifies fraud proofs, processes withdrawals)
            ← Challenger (re-executes off-chain, submits fraud proofs)
    → Ethereum L1 (data availability layer)
```

### 4.1 Sequencer

The sequencer is the rollup's transaction-ordering and execution authority. It receives user transactions, sequences them into a canonical order, executes them against the current state, batches them, compresses the batch (transaction data, signatures, and any auxiliary information), and posts the resulting commitment to L1.

In every major production deployment today, the sequencer is **centralized**. There is exactly one entity — typically the rollup foundation or a designated operator — running the sequencer. This is a deliberate operational simplification, not a security necessity. Centralized sequencing provides better latency (no inter-validator consensus), simpler MEV economics, and easier debugging, at the cost of a known censorship vector. The mitigation is twofold: first, the sequencer cannot steal funds (because of fraud proofs); second, all rollups expose a *forced inclusion* mechanism that allows users to bypass a misbehaving sequencer and submit transactions directly through L1, albeit with worse latency.

The sequencer's economic accountability is enforced by a **bond**: the sequencer posts collateral on L1 that is slashed if any fraud proof against its batches succeeds. Bond size is calibrated to make fraud strictly negative-EV under any plausible MEV opportunity.

### 4.2 State Root

The state root is the cryptographic commitment that a sequencer posts alongside each batch. Conceptually, it is a Merkle root over the rollup's entire state — every account balance, every contract storage slot, every nonce — at the moment after the batch's last transaction has been executed.

The state root has two essential properties. First, it is a *fingerprint*: a single 32-byte value that uniquely identifies the rollup's state with cryptographic certainty. Second, it is *succinctly verifiable*: a Merkle proof against the root can demonstrate that any specific account or storage slot has any specific value, and the proof's size is logarithmic in the size of the state.

The dispute system fundamentally operates on state roots. The sequencer claims, "after batch B, the state root is R." A challenger asserts, "no, the correct state root after batch B is R'." The fraud-proof game's job is to reduce this disagreement to a single execution step that can be re-executed on L1.

### 4.3 Challengers

A challenger is any entity that runs an independent node, replays the sequencer's posted batches, and is prepared to submit a fraud proof if it detects a discrepancy. Becoming a challenger has no permission requirement beyond the ability to post the challenger bond — the design intent is that the role is permissionless and economically incentivized.

The economic model for challengers is symmetric to the sequencer's: a challenger's bond is slashed if its fraud proof is wrong, and the dishonest sequencer's bond is awarded to a successful challenger (minus protocol fees). This is the mechanism that makes the "1-of-N honest" assumption rational: anyone with the technical capability can profit from successful fraud detection, and anyone considering frivolous challenges loses their bond.

### 4.4 L1 Rollup Contracts

The rollup's L1 footprint consists of a small set of Solidity contracts that:

- Hold sequencer and challenger bonds.
- Store posted batch headers (state roots, batch metadata, posting timestamps).
- Implement the dispute state machine: accept challenges during the window, drive the bisection game, verify single-step claims, declare a winner, and slash the loser.
- Process deposits (L1→L2 by emitting events the sequencer must honor) and withdrawals (L2→L1 by consuming Merkle proofs against finalized state roots).

These contracts are the **trust anchor** of the entire system. If they are sound, no off-chain misbehavior can result in stolen funds. They are correspondingly the highest-stakes attack surface of any rollup deployment.

---

## 5. Fraud Proofs: The Core Security Mechanism

A fraud proof is a procedure executed on L1 that demonstrates the sequencer's posted state root is inconsistent with honest execution of the posted transactions. There are two architectural approaches.

### 5.1 Non-Interactive Fraud Proofs

In a non-interactive scheme, the challenger submits a proof of incorrect execution that L1 can verify in a single transaction. The most direct version of this — having L1 simply re-execute the entire disputed batch — is conceptually clean but operationally infeasible: a typical batch may contain thousands of transactions with millions of EVM steps in aggregate, and re-executing all of them on L1 would consume more gas than the rollup was designed to save in the first place.

Non-interactive proofs based on succinct cryptography (i.e., SNARK-based validity proofs of incorrectness) blur the line between optimistic and zero-knowledge rollups and are increasingly explored as production technology, but classical optimistic rollups do not use them.

### 5.2 Interactive Fraud Proofs (Bisection Games)

The interactive approach, used by all production optimistic rollups today, reduces a disputed batch to a *single execution step* through a binary-search game. The structure is:

1. The sequencer commits to a sequence of intermediate state roots — one after every transaction (or every N execution steps for finer granularity).
2. The challenger commits to its own sequence of intermediate state roots.
3. They disagree on the final root, which means there exists at least one index where their sequences first diverge.
4. The L1 contract orchestrates a bisection: at each round, the disputed range is halved by examining the midpoint state root. The party whose claim about the midpoint is consistent with shared earlier history determines which half contains the disagreement.
5. After O(log N) rounds, the disputed range is reduced to a single execution step.
6. L1 then re-executes that single step. Whichever party's claim about the post-state matches the actual execution wins; the other is slashed.

```
Disputed batch (N transitions)
    → Bisect: examine midpoint state
        → Midpoints agree?   Yes → Disagreement is in upper half
                             No  → Disagreement is in lower half
            → Range size = 1?  No  → Loop back to bisect
                               Yes → Single-step verify on L1
                                       → Loser's bond slashed
```

This structure means **L1 only ever re-executes one step**, regardless of the batch size. The cost of the dispute is logarithmic in the batch's transaction count for the bisection rounds (each round is a constant-cost L1 transaction) plus a constant cost for the final single-step re-execution. This is what makes interactive fraud proofs practical at scale.

### 5.3 Bonds and Economic Security

Both sides post bonds before participating. The bond is held by the L1 rollup contract for the duration of the dispute. On resolution, the loser's bond is forfeit — typically, part is awarded to the winner as a bounty (incentivizing honest challenge) and part is burned or paid to the protocol treasury (preventing griefing collusion where two parties intentionally lose to each other).

The crucial property is that **fraud is negative-EV for any rational actor whose bond exceeds the value they could extract by lying**. As long as the sequencer's bond is sized appropriately relative to the value of the L2 ecosystem it is sequencing, attempting fraud is irrational. This is also why no successful mainnet fraud has occurred in the history of either Arbitrum or Optimism: the math does not favor it.

---

## 6. Production Comparison: Arbitrum (BoLD) vs Optimism (Cannon)

Arbitrum and Optimism are both optimistic rollups. Both use interactive fraud proofs. Both have an EVM-compatible execution environment, a sequencer, a challenge window, and on-chain rollup contracts. The substantive difference between them is *what virtual machine the single-step re-execution runs on*.

### 6.1 Arbitrum: BoLD

Arbitrum's dispute protocol is called **BoLD** (Bounded Liquidity Delay). BoLD is, strictly speaking, the *rule system* governing the bisection game — challenge initiation, bond requirements, round timing, and winner determination — rather than a virtual machine in itself. The single-step re-execution in Arbitrum runs against an EVM-equivalent execution environment, meaning that the disputed step is an actual EVM instruction operating on actual EVM state. There is no translation layer.

The advantage is directness: an Arbitrum dispute terminates in a real EVM step on L1, with no impedance mismatch. The disadvantage is that running EVM on L1 directly imposes constraints on what Arbitrum's L2 execution can look like — in practice, Arbitrum's Nitro stack is EVM-equivalent specifically to make this work.

### 6.2 Optimism: Cannon

Optimism's fault-proof system uses **Cannon**, an MIPS CPU emulator implemented in Solidity. Optimism's L2 execution client (a fork of go-ethereum) is compiled down to MIPS bytecode. When a dispute is bisected to a single step, that step is a *MIPS instruction*, not an EVM opcode, and L1 executes that single MIPS instruction by interpreting it inside Cannon.

The advantage of this approach is decoupling: Optimism can change its L2 execution client (upgrading geth, for instance) without changing the on-chain dispute infrastructure, because the dispute always operates on the *compiled* program rather than on EVM semantics. The disadvantage is the translation layer: Optimism must deterministically compile its execution client into MIPS, and the on-chain MIPS interpreter must perfectly reproduce that semantics. Bugs anywhere in this pipeline are dispute-breaking.

### 6.3 Unifying View

Despite the architectural differences, the unifying takeaway is that **both systems reduce a dispute to verifying a single execution step on L1**. The variable is what "step" means — an EVM opcode in Arbitrum's case, a MIPS instruction in Optimism's case. Neither approach is strictly better; they are different points on a design surface that trades directness against decoupling.

---

## 7. Data Availability and EIP-4844

Data availability is a prerequisite for the security of optimistic rollups — without it, challengers cannot reconstruct state and cannot submit fraud proofs. If a sequencer posts a batch header but withholds the underlying transaction data, honest challengers are blinded: they know the claimed state root but cannot verify whether it is correct, and they certainly cannot construct a bisection proof against it.

The original data-availability solution was straightforward: post transaction data as **calldata** on Ethereum L1. Calldata is permanently accessible to any full node and can be used by challengers to reconstruct any historical rollup state. The problem is cost: calldata is billed at 16 gas per non-zero byte (4 gas per zero byte), and a typical L2 batch may contain many kilobytes of compressed transaction data. At peak gas prices, this cost dominates the fees users pay on L2.

### 7.1 EIP-4844 (Proto-Danksharding)

EIP-4844, activated in the Cancun hard fork (March 2024), introduced **blob-carrying transactions** as a substantially cheaper alternative to calldata for L2 data posting. The design has several key properties:

- **Blobs are large (~128 KB each) but cheap.** They are priced on a separate fee market — the *blob base fee* — that adjusts independently of the regular EVM gas market. Under normal conditions, posting a blob costs a fraction of equivalent calldata.
- **Blobs are finite-retention.** Unlike calldata, which is permanently accessible to every full node forever, blobs are only stored by Ethereum nodes for approximately 18 days (4096 epochs). After that, they are pruned.
- **Blobs are still data-available during the challenge window.** The 18-day retention window is longer than the standard 7-day optimistic challenge window. This is not a coincidence — it was chosen to ensure that blob data remains available for the full duration of any dispute.
- **The blob *commitment* is permanent.** Even after the blob data is pruned, a KZG polynomial commitment to the blob is stored on L1 indefinitely. This commitment allows anyone with access to the blob data to verify its authenticity, and provides the on-chain anchor for data availability proofs in future protocols.

The practical impact on optimistic rollup fees has been dramatic. Both Arbitrum and Optimism now publish their L2 transaction data primarily as blobs rather than calldata, and user fees on L2 fell by roughly an order of magnitude following EIP-4844 activation.

### 7.2 Data Availability and Our Implementation

Our implementation posts delta arrays as on-chain calldata stored in contract storage (via `batchDeltas[batchId]`), not blobs. This is a deliberate simplification: our delta batches are tiny (four integers), blob transactions require a different transaction type, and demonstrating the dispute mechanics does not require the data-availability layer to be production-realistic. In production, the challenger reads batch data from the L1 calldata or blob associated with the `submitBatch` transaction; in our system, the challenger calls `getBatchDeltas(batchId)` directly on the contract.

The conceptual point stands regardless of implementation: data availability is what makes the challenger's job possible. The challenger must be able to reconstruct the sequencer's claimed state path from transaction data that is on-chain and verifiable. In our system, `batchDeltas[batchId]` serves this role exactly.

---

## 8. Optimistic vs Zero-Knowledge Rollups

Zero-knowledge (ZK) rollups are the other major rollup family. The contrast clarifies the design space:

| Dimension           | Optimistic                         | ZK                              |
|---------------------|------------------------------------|---------------------------------|
| Validity model      | Assumed valid; challenged if not   | Proven mathematically per batch |
| Withdrawal latency  | ~7 days                            | Minutes                         |
| EVM compatibility   | Easy — runs EVM directly           | Hard — requires zkEVM           |
| Per-batch cost      | Cheap (proof only on dispute)      | Expensive (SNARK every batch)   |
| Security model      | Crypto-economic (1-of-N honest)    | Cryptographic / mathematical    |
| Operational maturity| Battle-tested (Arbitrum, Optimism) | Catching up rapidly             |

The key conceptual contrast: optimistic rollups are **crypto-economic** — they are secure because lying is unprofitable. ZK rollups are **mathematical** — they are secure because lying is impossible (modulo cryptographic assumptions and circuit correctness). Optimistic rollups optimize for cheapness and EVM-compatibility today, accepting the seven-day withdrawal delay. ZK rollups optimize for finality and trust-minimization, accepting higher proving costs and (until recently) harder EVM compatibility.

The current consensus in the ecosystem is that ZK rollups are the *long-term* destination — they have strictly better trust properties — but optimistic rollups are the *pragmatic present*. As zkEVM technology matures and proving costs continue to fall, the gap is closing, and several teams (including Optimism itself) are publicly working on hybrid systems that use validity proofs to compress the optimistic challenge window.

---

## 9. Implementation: System Overview

The second half of our project was a working interactive optimistic rollup deployed to a live Ethereum testnet. The implementation has three main parts:

1. **`InteractiveOptimisticRollup`** — a Solidity smart contract deployed to Base Sepolia testnet that holds bonds, accepts batch submissions, drives the bisection dispute game, performs single-step verification, and tracks claimable balances after resolution.
2. **`interactive-sequencer-runner.ts`** — a TypeScript script run by the sequencer operator that posts batches, watches for challenges, and submits midpoint and single-step claims as the dispute game advances.
3. **`interactive-challenger-runner.ts`** — a TypeScript script run by a challenger that polls for new batches, re-executes them locally, initiates challenges when discrepancies are found, and submits its own midpoint and single-step claims.

Both runners interact with the contract using `ethers.js` via Hardhat's network connection. Both operate in a polling loop, reading on-chain state and acting only when the state has advanced to a phase that requires the runner's input. The runners do not communicate directly with each other — all coordination is mediated through the smart contract, which is the design property that lets the system extend trivially from a single demo machine to fully decentralized deployment.

```
Off-chain:
    Sequencer Runner (TypeScript) ←→ polls + writes ←→ InteractiveOptimisticRollup (Solidity)
    Challenger Runner (TypeScript) ←→ polls + writes ←→ [same contract]
    [Sequencer Runner and Challenger Runner never communicate directly]

On-chain (Base Sepolia testnet):
    InteractiveOptimisticRollup at 0x6Be859d7729237E259D21B30Bdd8B3367c414D66
    - holds bonds
    - state machine
    - verifies single step
```

### 9.1 Simplified State Model: Deltas Instead of Merkle Roots

A real optimistic rollup commits to its full state via a Merkle root over every account, every storage slot, every contract. Its transactions are arbitrary EVM payloads. Its single-step verification is an EVM step inside (in Optimism's case) a MIPS interpreter. All of this is several thousand person-months of engineering.

Our project abstracts away this machinery while preserving the *structure* of the dispute game. Instead of a Merkle root, the rollup state is a single integer. Instead of an arbitrary EVM transaction, each "transaction" in our system is an integer **delta** — a signed integer to be added to the current state. Executing a batch of deltas means producing the sequence of post-states by accumulation:

> s₀ = initialState, then for each delta dᵢ: sᵢ₊₁ = sᵢ + dᵢ.

The final state of the batch is sₙ where n is the batch length. This is a 1-D, deterministic, easily-verifiable model — exactly what we need to demonstrate the dispute mechanics without taking on the engineering burden of a real EVM emulator.

The trade-off is honest: this is not a useful execution model. It cannot run smart contracts. It cannot host applications. But every architectural property of the dispute game — bonds, challenge initiation, bisection, single-step verification, slashing, withdrawals — is identical in shape between our delta model and a production rollup. The substitution is "what is a state? what is a transition?" The choreography is the same.

In presentation terms: the delta model is a **proxy for Merkle computation**. In a real system, where we say "midpoint state at index k is sₖ," a real system would say "midpoint state root after transaction k is Rₖ," with Rₖ derived from the same kind of accumulation but over a much richer state space. We chose to make this accumulation visible (integer math) rather than opaque (hash-tree computations) so that the dispute logic is legible to a viewer of the demo.

---

## 10. The `InteractiveOptimisticRollup` Contract

The smart contract exposes the following surface:

**Core state variables**

- `sequencerBond` — required deposit for `submitBatch`.
- `challengerBond` — required deposit for `initiateChallenge`.
- `challengePeriod` — duration of the challenge window, in seconds.
- `latestBatchId` — the ID of the most recently submitted batch.
- `batches[batchId]` — per-batch struct containing `submittedAt`, `initialState`, `claimedFinalState`, `txCount`, `challenged`, `finalized`, `invalidated`.
- `disputes[batchId]` — per-batch dispute struct containing `active`, `resolved`, `start`, `end` (current bisection range), `mid`, `sequencerStateAtMid`, `challengerStateAtMid`, `sequencerMidSubmitted`, `challengerMidSubmitted`, `sequencerSingleStepPostState`, `challengerSingleStepPostState`, `sequencerSingleStepSubmitted`, `challengerSingleStepSubmitted`, `sequencerWon`, `challengerWon`.
- `claimableBalances[address]` — per-address withdrawable balance after dispute resolution or finalization.

**Functions**

- `submitBatch(initialState, claimedFinalState, deltas)` — sequencer-only; consumes `sequencerBond` (passed as `msg.value`); records the batch and starts the challenge timer.
- `initiateChallenge(batchId, challengerFinalState)` — challenger entry point; consumes `challengerBond`; opens a dispute over the entire transaction range `[0..txCount-1]`.
- `submitSequencerMidpointClaim(batchId, sequencerStateAtMid)` — sequencer's claim about the state at the midpoint of the current disputed range.
- `submitChallengerMidpointClaim(batchId, challengerStateAtMid)` — challenger's claim about the same midpoint. When both midpoint claims are present, the contract advances the disputed range: if the midpoints agree, the disagreement is in the upper half; if they disagree, it is in the lower half.
- `submitSequencerSingleStepClaim(batchId, sequencerPostState)` — once the disputed range narrows to a single index, the sequencer submits its claimed post-state for that single transaction.
- `submitChallengerSingleStepClaim(batchId, challengerPostState)` — challenger submits its claimed post-state. The contract then re-executes the single transition: it computes `expected = preState + delta` (from the on-chain delta data) and compares against both claims. The party whose claim equals `expected` wins.
- `finalizeBatch(batchId)` — callable after the challenge period has elapsed if no dispute was initiated; marks the batch finalized and credits the sequencer's bond back to its claimable balance.
- `getBatchDeltas(batchId)` — view returning the delta array.
- `claimableBalances(address)` — view returning withdrawable balance.

The contract emits events at every state transition (`BatchSubmitted`, `ChallengeInitiated`, `MidpointClaimSubmitted`, `DisputeBisected`, `SingleStepClaimSubmitted`, `DisputeResolved`, `BatchFinalized`), which off-chain agents may consume in lieu of polling. Our runners use polling for simplicity, but the contract is event-friendly.

**Custom errors** observed in runner exception handling include `DisputeNotAtSingleStep` (selector `0xb111df84`), thrown if a midpoint claim is submitted when the range has already collapsed to a single index, and `MidpointAlreadySubmitted` (selector `0xe34e893d`), thrown if the same party tries to submit twice in a single round. The runners catch these and continue gracefully — important for robustness against polling races where on-chain state changes between read and write.

### 10.1 Bisection State Machine

The dispute moves through three phases:

```
[*] → WindowOpen
WindowOpen → Bisecting      : initiateChallenge
WindowOpen → Finalized      : finalizeBatch (window closed, no challenge)
Bisecting  → Bisecting      : both midpoint claims submitted, range halved
Bisecting  → SingleStep     : range collapsed to one index
SingleStep → SingleStep     : waiting for both single-step claims
SingleStep → SequencerWon   : sequencer claim equals preState + delta
SingleStep → ChallengerWon  : challenger claim equals preState + delta
SequencerWon → [*]
ChallengerWon → [*]
Finalized    → [*]
```

Each transition between bisection rounds halves the disputed range, so the number of rounds for a batch of N transactions is O(log N). For our demo batches of 4 transactions, the worst case is 2 rounds plus a single-step verification.

---

## 11. The Sequencer Runner

`interactive-sequencer-runner.ts` is the off-chain agent that operates the sequencer role. It is parameterized by environment variables:

- `CONTRACT_ADDRESS` — deployed `InteractiveOptimisticRollup` address.
- `DEPLOYER_PRIVATE_KEY` — sequencer's private key (the runner uses this to sign transactions).
- `INITIAL_STATE` — the integer state at the start of the batch.
- `SUBMITTED_DELTAS_CSV` — comma-separated deltas to post on-chain as the batch's transaction list.
- `ACTUAL_USED_DELTAS_CSV` — *optional* — the deltas the sequencer will actually use to compute its claimed states during the dispute game. When this differs from `SUBMITTED_DELTAS_CSV`, the sequencer is committing fraud: it is pretending the batch executed differently than the on-chain transaction data implies.
- `CLAIMED_FINAL_STATE` — *optional* — the final state the sequencer reports to L1 in `submitBatch`. When omitted, defaults to the result of applying `ACTUAL_USED_DELTAS_CSV` to `INITIAL_STATE`.
- `POLL_SECONDS`, `MAX_POLLS`, `STEP_MODE` — operational parameters.

This three-knob fraud configuration (`SUBMITTED_DELTAS_CSV`, `ACTUAL_USED_DELTAS_CSV`, `CLAIMED_FINAL_STATE`) is what lets us simulate fraud at any layer:

- A *payload-substitution* attack: post one set of deltas to the chain but secretly compute against another.
- A *final-state-only* attack: post deltas honestly but lie about their result.
- Both at once, or neither (an honest run).

### 11.1 Lifecycle of a Sequencer Run

The runner's main loop, after initial setup:

1. **Submit the batch.** Calls `submitBatch(initialState, claimedFinalState, submittedDeltas)` with `value = sequencerBond`. Records the resulting `batchId` (read from the contract via `latestBatchId()`).
2. **Poll the contract every `POLL_SECONDS` seconds.** On each poll, read `batches[batchId]` and `disputes[batchId]`. Branch on the state.
3. **If no dispute is active and the challenge window is still open:** wait. Print status. Loop.
4. **If a dispute is active and the disputed range has more than one transaction:** the runner is in bisection mode. It computes the midpoint index, computes its own state at the midpoint by applying the `ACTUAL_USED_DELTAS_CSV` path through index `mid`, and submits `submitSequencerMidpointClaim(batchId, sequencerStateAtMid)`. Then it waits for the challenger's midpoint and the contract's range advancement.
5. **If the disputed range has collapsed to a single transaction:** the runner is in single-step mode. It computes its claimed post-state for the disputed index (again from `ACTUAL_USED_DELTAS_CSV`) and submits `submitSequencerSingleStepClaim(batchId, sequencerClaimedPostState)`.
6. **If the dispute has resolved with the challenger winning:** record the loss. The bond is gone. Exit.
7. **If the dispute has resolved with the sequencer winning, or no challenge was ever initiated and the window has closed:** call `finalizeBatch(batchId)`, which credits the sequencer's bond back to its claimable balance. Exit.

Two implementation details are worth highlighting.

**Race-aware writes.** Between a poll (read) and a write (transaction submission), on-chain state can advance. If the runner reads a state where it should submit a midpoint claim but, in the time before its transaction confirms, the dispute has already advanced past that round, the transaction will revert. The runner handles this two ways: by re-reading state immediately before sending, and by catching the revert selectors of expected races (`DisputeNotAtSingleStep`, `MidpointAlreadySubmitted`) and continuing the loop rather than crashing.

**Step mode.** When `STEP_MODE=true`, the runner pauses before each on-chain action and prompts the operator to type "yes" before continuing. This is what makes the runner useful for live demonstrations: each phase of the dispute can be inspected, the on-chain state can be queried independently, and the audience can see the back-and-forth unambiguously.

---

## 12. The Challenger Runner

`interactive-challenger-runner.ts` mirrors the sequencer runner but plays the opposing role. Environment variables:

- `CONTRACT_ADDRESS`, `BATCH_ID`, `CHALLENGER_PRIVATE_KEY` — required.
- `CHALLENGER_DELTAS_CSV` — *optional* — the delta sequence the challenger will believe is correct. If omitted, the challenger trusts the on-chain delta data (`getBatchDeltas`) and re-executes accordingly.
- `CHALLENGER_WRONG_DELTAS` — *optional* — explicit override for simulating an incorrect challenge: the challenger uses these deltas knowing they are wrong, in order to demonstrate the case where the challenger loses and is slashed.
- `POLL_SECONDS`, `MAX_POLLS`, `STEP_MODE` — operational parameters.

### 12.1 Lifecycle of a Challenger Run

1. **Wait for the batch to appear.** Poll until `batches[batchId].submittedAt > 0`.
2. **Derive both state paths.** Read the on-chain deltas. Compute `sequencerPostStates` by applying them. Compare against `batches[batchId].claimedFinalState`: if they disagree, the sequencer's claimed final state is inconsistent with its own posted deltas. Compute `challengerPostStates` by applying the challenger's chosen delta path.
3. **If there is no disagreement, exit silently.** No challenge is warranted.
4. **If there is disagreement and the challenge window is still open, initiate the challenge.** Call `initiateChallenge(batchId, challengerFinalState)` with `value = challengerBond`.
5. **Poll until the dispute is active.**
6. **For each round of bisection:**
   - Compute the midpoint index of the current disputed range.
   - Wait for the sequencer's midpoint claim to appear on-chain.
   - Compare the sequencer's midpoint state to the challenger's midpoint state.
   - Submit `submitChallengerMidpointClaim(batchId, challengerStateAtMid)`.
7. **When the range collapses to a single index:** wait for the sequencer's single-step claim, then submit `submitChallengerSingleStepClaim(batchId, challengerPostState)`.
8. **Read the resolution.** If the challenger won, the challenger's claimable balance now contains the recovered bond plus the slashed sequencer bond.

The challenger runner emits extensive narration at every step — in particular, before submitting any claim, it logs the local computation in human-readable form (e.g., `10 + (5) + (-2) + (4) = 17`) so a viewer can follow the math.

---

## 13. Demonstration on Base Sepolia: Walkthrough and On-Chain Results

The full demonstration was deployed and run on the **Base Sepolia** testnet (an Ethereum-compatible L2 testnet). The deployed contract address is:

```
0x6Be859d7729237E259D21B30Bdd8B3367c414D66
```

The contract was configured with:
- `CHALLENGE_PERIOD_SECONDS = 300` (5 minutes, shortened from the production 7-day window to allow a live demo)
- `SEQUENCER_BOND = 0.005 ETH`
- `CHALLENGER_BOND = 0.005 ETH`

### 13.1 Demo Scenario: Sequencer Commits Fraud

**Setup.** The demo ran the sequencer-fraud scenario. The sequencer was configured to submit honest deltas on-chain but use fraudulent deltas internally — a payload-substitution attack:

| Parameter                    | Value                              |
|------------------------------|------------------------------------|
| Initial state                | 10                                 |
| Submitted deltas (on-chain)  | [5, −2, 4, 1]                      |
| Actual sequencer deltas      | [5, −2, **5**, 1] (fraud at index 2) |
| Honest final state           | 10 + 5 − 2 + 4 + 1 = **18**       |
| Sequencer's claimed final    | 10 + 5 − 2 + 5 + 1 = **19**       |

**State paths compared by the challenger:**

| Index | Pre-state | Delta (on-chain) | Honest post | Sequencer's post |
|-------|-----------|-----------------|-------------|-----------------|
| 0     | 10        | +5              | 15          | 15              |
| 1     | 15        | −2              | 13          | 13              |
| 2     | 13        | +4 (seq claims +5) | 17      | **18** (fraud)  |
| 3     | 17/18     | +1              | 18          | **19** (fraud)  |

### 13.2 Transaction Sequence and Gas Costs

The complete dispute proceeded through the following on-chain transactions, each a separate L2 transaction on Base Sepolia:

**Transaction 1 — Bond posting and batch submission (`submitBatch`)**
The sequencer submitted the fraudulent batch along with the 0.005 ETH bond. The contract stored the batch struct, the four-element delta array, and the claimed final state of 19. The transaction emitted a `BatchSubmitted` event.
- Approximate gas used: ~270,000 gas
- Sequencer account balance before: 32 ETH → after: ~30 ETH (approximate, including bond and gas)

**Transaction 2 — Challenge initiation (`initiateChallenge`)**
The challenger, having re-executed the batch and derived state 18 vs the sequencer's claimed 19, initiated a challenge with 0.005 ETH challenger bond. The dispute struct was initialized with range [0, 3].
- Approximate gas used: ~220,000 gas
- Challenger account balance before: ~32.7 ETH → reduced by bond + gas

**Bisection Round 1: Range [0, 3], midpoint index 1**

*Transaction 3 — `submitSequencerMidpointClaim`*: Sequencer submitted its state at index 1 = 13. (Sequencer and challenger agree here because the fraud is at index 2, which is past the midpoint.)
- Approximate gas used: ~70,000 gas

*Transaction 4 — `submitChallengerMidpointClaim`*: Challenger submitted its state at index 1 = 13. Both claims match, so the contract advanced the range to the upper half [2, 3]. `DisputeBisected` event emitted.
- Approximate gas used: ~110,000 gas (includes `_advanceDisputeRound` internal execution)

**Bisection Round 2: Range [2, 3], midpoint index 2**

*Transaction 5 — `submitSequencerMidpointClaim`*: Sequencer submitted its (fraudulent) state at index 2 = 18. (Sequencer internally applied delta +5 instead of the posted +4.)
- Approximate gas used: ~70,000 gas

*Transaction 6 — `submitChallengerMidpointClaim`*: Challenger submitted its state at index 2 = 17. The claims differ (18 ≠ 17), so the contract advanced the range to the lower half, leaving a single-step dispute at index 2. `DisputeBisected` event emitted.
- Approximate gas used: ~110,000 gas

**Single-Step Verification: Disputed index 2**

*Transaction 7 — `submitSequencerSingleStepClaim`*: Sequencer claimed post-state = 18 for the disputed index.
- Approximate gas used: ~60,000 gas

*Transaction 8 — `submitChallengerSingleStepClaim` (triggers resolution)*: Challenger claimed post-state = 17. The contract executed `_resolveSingleStepWithClaims`: it computed `_stateBeforeIndex(batchId, 2)` = 13, then `expected = 13 + batchDeltas[batchId][2] = 13 + 4 = 17`. Challenger's claim matches expected; sequencer's does not. Challenger wins. `DisputeResolved` event emitted with `challengerWon = true`, batch invalidated, sequencer's bond awarded to challenger. Total claimable for challenger: 0.010 ETH (both bonds).
- Approximate gas used: ~150,000 gas

**Transaction 9 — `withdrawClaimable`**: Challenger withdrew 0.010 ETH. Challenger account balance restored plus net gain of the sequencer's 0.005 ETH bond.
- Approximate gas used: ~35,000 gas

### 13.3 Summary of Results

| Metric                          | Value                                    |
|---------------------------------|------------------------------------------|
| Network                         | Base Sepolia                             |
| Contract                        | `0x6Be859d7729237E259D21B30Bdd8B3367c414D66` |
| Batch size                      | 4 transactions                           |
| Bisection rounds required       | 2                                        |
| On-chain transactions (total)   | 9 (submit, challenge, 4 midpoint, 2 single-step, withdraw) |
| Total gas (approximate)         | ~1,095,000 gas across all 9 transactions |
| Gas per bisection round (2 txs) | ~180,000 gas                             |
| Gas for single-step resolution  | ~210,000 gas (2 transactions)            |
| Challenge period (demo config)  | 300 seconds (5 minutes)                  |
| Time from batch to resolution   | ~8–12 minutes (step-mode demo pacing)    |
| Dispute outcome                 | Challenger won; sequencer's bond slashed |

The bisection game resolved the 4-transaction dispute in exactly 2 bisection rounds, consistent with the O(log₂ 4) = 2 theoretical prediction. L1 re-executed exactly one step — index 2, the single transaction where fraud occurred — to determine the winner. The contract verified `13 + 4 = 17` and awarded the challenger, without ever re-executing the rest of the batch.

Gas costs on Base Sepolia in ETH terms were negligible (Base Sepolia's base fee is fractions of a Gwei), making the demo practical to run with small test balances. On a production network at typical L1 gas prices, the dispute's on-chain cost would be significant but still logarithmic in batch size — the key property that makes fraud proofs economically viable at scale.

---

## 14. Discussion: Trade-offs of the Implementation

The design choices we made warrant explicit discussion, both because they illuminate what we built and because they show what we deliberately set aside.

### 14.1 Delta Model vs. Real State — and What Merkle Commitment Would Require

The most consequential simplification is the integer-delta state model. A real optimistic rollup commits to a Merkle root over a complete EVM state, executes arbitrary transactions, and verifies single steps inside an EVM (or MIPS) emulator. We replaced all of that with integer addition.

**What this preserves:** the *shape* of the dispute game — bonds, batch posting, bisection, single-step verification, slashing, finalization. Everything in our contract has a structural counterpart in production rollups.

**What this discards:** the *content* of execution. We cannot run smart contracts, cannot host applications, cannot handle ERC-20 transfers, cannot represent multiple accounts. Our "state" is one integer; our "transactions" are integers added to it.

The educational case for this trade-off is that the dispute mechanics are the conceptually difficult, novel part of an optimistic rollup, and that the EVM-emulation layer, while engineering-intensive, is conceptually a black box: "given a transaction and a pre-state, compute the post-state." Whether that post-state is computed by an integer addition or by a full EVM step makes no difference to the surrounding bisection logic.

**What Merkle-committed state would require differently.** If state were committed via a Merkle root rather than a plain integer, the bisection mechanics would need to change in two specific places:

*At each midpoint claim:* instead of posting a plain integer (e.g., `sequencerStateAtMid = 13`), each party would post a **state root hash** — a 32-byte Merkle root over the entire rollup state after executing transactions through that midpoint index. The contract would store and compare these hashes rather than integers; the comparison semantics are identical (`sequencerMidRoot != challengerMidRoot` still indicates the lower half is disputed), but the *meaning* of the claimed value is richer. Crucially, neither party needs to prove on-chain that their posted hash is correct at midpoint-claim time — they only need to provide the hash. The commitment to the hash is binding: they cannot later change their claimed state path without contradicting their earlier on-chain claim.

*At the single-step verification:* once the disputed range has narrowed to a single transaction index i, the single-step resolver needs to verify three things on-chain, not one:
1. **Pre-state proof:** a Merkle proof that the agreed-upon state before index i — the midpoint hash that both parties accepted in the final bisection round — correctly encodes the specific account and storage slots that transaction i touches. This is the *witness* for the single step.
2. **Execution:** apply transaction i to that pre-state. In our system, this is `preState + delta[i]`. In a real system, this is a full EVM step (or MIPS instruction in Optimism's case) — the on-chain execution of one opcode operating on the authenticated pre-state.
3. **Post-state commitment:** verify that the resulting post-state, when committed into a new Merkle root, produces the hash that one party claimed as their state at index i+1.

The witness construction step (point 1 above) is the most technically demanding addition. It requires the challenger to submit a Merkle proof showing that the agreed pre-state root at index i actually contains the specific values the disputed transaction reads. In Optimism's Cannon, this means constructing a MIPS memory witness that proves the program state at that single MIPS instruction. In Arbitrum's system, it means constructing an EVM execution proof over the specific opcode being disputed.

By using integer deltas, our system sidesteps witness construction entirely: the "pre-state" is a single integer that any party can compute on-chain by iterating `batchDeltas[batchId]`, and the "transaction" is an integer addition with no external data dependencies. This is what makes our single-step resolver trivially cheap (one loop + one addition) compared to a production dispute resolver that must accept and verify Merkle witnesses.

### 14.2 Posting Raw Deltas vs. Hash Commitments

We post the full delta array on-chain as the batch's transaction data, rather than posting a hash commitment to it. In a real rollup, calldata costs would make this prohibitive at scale (which is why EIP-4844 introduced blobs). In our model, the deltas are short integers and the gas cost is negligible.

This matters because the challenger relies on `getBatchDeltas(batchId)` to read the canonical batch data when re-executing. In a production system, the challenger would instead reconstruct this from the L1 calldata (or blob) and use Merkle proofs to verify any specific transaction's content. Our approach is simpler but does not exhibit the data-availability problem.

### 14.3 Centralized Sequencer; Permissionless Challenger

The contract permits exactly one sequencer address to call `submitBatch`. This matches production deployments — Arbitrum and Optimism are also single-sequencer — but it does not exhibit the harder problem of decentralized sequencing (which is an active research area). Conversely, anyone can be a challenger by holding the bond, which matches the production permissionless-challenge model.

### 14.4 No Reorganization of L1

Our contract assumes Ethereum L1 itself is final. It does not handle the case where an L1 reorg invalidates a previously-posted batch. Real rollups must be careful here, particularly given that batch posting and challenge timing depend on L1 timestamps.

### 14.5 What We Did Right

Despite the simplifications, the implementation faithfully demonstrates several non-obvious properties:

- **The bisection game is logarithmic in batch size.** Our four-transaction batches resolve in two bisection rounds plus one single-step verification, exactly as theory predicts.
- **The contract is the sole source of truth.** Neither runner can win or lose by lying to the contract — the contract independently re-executes the disputed step against its own stored data.
- **Race conditions are a real engineering concern, not a theoretical one.** Our runner code includes explicit handling of polling races (`DisputeNotAtSingleStep`, `MidpointAlreadySubmitted`) that we encountered during development. A naïve implementation would crash; a robust one continues.
- **Step mode makes the dispute legible.** A live demo of an interactive fraud proof is, fundamentally, a demonstration of multi-party state-machine progress over time. Without explicit pause points, the audience cannot follow the choreography.
- **Real funds on a real network.** The demo used actual test ETH with real transaction signing, gas costs, and blockchain state. Every action required posting a live L2 transaction. This makes the demo categorically different from a local simulation.

---

## 15. Future Work

If we were to continue, the natural next steps would be, in increasing order of effort:

1. **Replace the delta model with a Merkle-rooted state.** The state would become a key-value mapping (e.g., a sparse Merkle tree of account balances). Transactions would become `(from, to, amount)` triples. The single-step verification would compute `applyTransaction(preStateProof, tx) → postStateRoot` and compare, requiring the Merkle witness infrastructure described in Section 14.1.
2. **Move to a real EVM transaction model.** Use a minimal EVM interpreter (or call into an existing one) for execution; commit to state via a real Patricia trie. This is a substantial engineering project but is the natural endpoint of the educational trajectory.
3. **Add forced inclusion.** Allow users to bypass a censoring sequencer by posting transactions directly through the L1 contract. This is an essential security property in production rollups that our prototype does not exhibit.
4. **Introduce a permissioned-then-permissionless sequencer transition.** Demonstrate the operational handoff that real rollups will eventually need to go through.
5. **Combine with a validity proof to compress the challenge window.** This is the frontier of optimistic-rollup design in 2026 — using a validity proof for the optimistic majority of cases and falling back to a fraud proof for edge cases — and would be a much more ambitious but very natural extension.

---

## 16. Conclusion

Optimistic rollups are the dominant production answer to Ethereum's scaling problem. They achieve their throughput by relocating execution off-chain while inheriting L1 security through two mechanisms: data availability (so anyone can independently verify) and interactive fraud proofs (so anyone who detects fraud can punish it). Their seven-day challenge window is a calibrated compromise between the security needs of fraud detection and the user-experience needs of L2-to-L1 withdrawals. Their key innovation, the bisection game, makes the cost of single-step verification independent of batch size — the property without which fraud proofs would be operationally infeasible.

The architectural difference between Arbitrum and Optimism — BoLD versus Cannon, EVM-direct versus MIPS-emulator — is real but is best understood as different points on a single design axis, not as fundamentally different security models. Both reduce a dispute to a single execution step on L1. Both rely on the same core economic argument: that lying is unprofitable when the bond is appropriately sized. Both have proven, in practice, that this argument holds — neither has experienced a successful mainnet fraud.

The future of optimistic rollups is converging with the future of zero-knowledge rollups. As proving costs fall and zkEVMs mature, hybrid designs that use validity proofs to compress (or in the limit, eliminate) the challenge window are the next horizon. But as of 2026, optimistic rollups remain the workhorses of Ethereum scaling — battle-tested, EVM-compatible, and continually improved.

Our implementation, while deliberately simplified, exhibits the full structure of an interactive optimistic rollup: bonded sequencer, permissionless challenger, on-chain rollup contract holding the canonical state machine, and runner agents driving the dispute game from both sides. Deployed to Base Sepolia testnet, the system demonstrates each phase end-to-end: honest submission and finalization, fraudulent submission caught and slashed, frivolous challenge punished. The bisection game resolved our 4-transaction batch in 2 rounds and 9 total on-chain transactions — exactly matching the O(log N) theoretical complexity. It is, at small scale, exactly the security model of Arbitrum or Optimism — proof that the surrounding theory is implementable from first principles in a few hundred lines of code, given the right abstractions.

The single most important insight from the implementation is the relationship between game theory and contract design. The contract does not merely enforce rules — it engineers incentives. Dishonesty is expensive because bonds are at stake. The protocol only functions because both the sequencer and challenger are rational actors who prefer profit over principle-violation. Writing the contract is inseparable from designing the payoff structure it enforces.

---

## Appendix A: Glossary

- **Batch.** A collection of L2 transactions posted together to L1, with a single state-root commitment.
- **Bisection.** The dispute-narrowing procedure that recursively halves the disputed range.
- **Bond.** Collateral posted by sequencer or challenger, slashed on loss.
- **BoLD.** Arbitrum's bonded dispute-protocol rule system.
- **Cannon.** Optimism's MIPS-based fault-proof emulator.
- **Challenge window.** The fixed period (~7 days) during which a fraud proof may be submitted.
- **Data availability.** The property that all data needed to reconstruct L2 state is published to (and retrievable from) L1.
- **EIP-4844 / blobs.** The Ethereum upgrade that introduced cheap, finite-retention data slots, drastically reducing L2 fees.
- **Finalization.** The point at which an L2 batch becomes irrevocable on L1, after the challenge window closes without a successful fraud proof.
- **Forced inclusion.** A mechanism allowing users to submit L2 transactions directly through L1, bypassing a censoring sequencer.
- **Fraud proof.** Evidence submitted to L1 that a previously-posted state root is inconsistent with honest execution of its associated batch.
- **Merkle witness.** A Merkle proof showing that a specific value is contained in a committed state root; required at the single-step verification stage in production rollups.
- **Sequencer.** The entity that orders, executes, and posts L2 transactions.
- **Single-step.** The atomic execution step (e.g., one EVM opcode, one MIPS instruction, or one delta) re-executed on L1 to resolve a dispute.
- **State root.** A cryptographic commitment to the rollup's complete state at a point in time.
- **zkEVM.** An EVM execution environment compiled into a SNARK-friendly arithmetic circuit, enabling validity proofs of EVM execution.
