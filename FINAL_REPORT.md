# Optimistic Rollups: Scaling Ethereum Without Sacrificing Security

**Final Report — Topic 13a**  
Vaasu & Akhil (equal contribution)  
CS 521 — Course Project — Final Submission

---

## Abstract

Ethereum's base layer cannot meet contemporary throughput demand. Its native execution rate of roughly 15–30 transactions per second pushes gas fees to prohibitive levels during peak demand, foreclosing entire categories of application. Optimistic rollups are the leading pragmatic response: they execute transactions off-chain, post the resulting transaction data and a state-root commitment to L1, and rely on a *challenge window*—typically seven days—during which any independent observer may submit a *fraud proof* demonstrating that the posted state root is incorrect. This report presents both a conceptual synthesis of optimistic rollup design (motivation, architecture, lifecycle, fraud-proof mechanics, comparisons between Arbitrum's BoLD and Optimism's Cannon, the role of EIP-4844 blobs, and contrasts with zero-knowledge rollups) and a detailed walkthrough of our coding project: a simplified, interactive optimistic rollup deployed to a public testnet, comprising a Solidity contract (`InteractiveOptimisticRollup`) and two TypeScript runner scripts that drive the sequencer and challenger roles through the full bisection-resolution game. The implementation is intentionally minimized to a 1-D integer state model so the dispute mechanics—bond posting, challenge initiation, recursive midpoint bisection, single-step on-chain verification, slashing, and withdrawal—can be exhibited end-to-end on real testnet infrastructure.

---

## 1. Introduction

Layer-2 scaling is no longer a research direction; it is the production reality of Ethereum. As of 2026, the majority of user-facing on-chain activity does not occur on Ethereum L1 but on rollups that inherit L1's security while operating their own execution environment. Among rollup constructions, *optimistic rollups*—first deployed by Arbitrum and Optimism—currently host the deepest pools of liquidity and the largest installed base of EVM-equivalent applications.

The intuition behind an optimistic rollup is captured in one phrase: **innocent until proven guilty**. Rather than requiring every transaction to be cryptographically proven correct before acceptance (the approach taken by zero-knowledge rollups), the system *assumes* that the rollup operator's claimed state transitions are valid and only intervenes if some independent party submits evidence to the contrary within a fixed dispute window. This "optimism" is what enables optimistic rollups to be cheap and EVM-compatible—there is no per-batch SNARK to compute—but it is also why the design space for fraud proofs, sequencer accountability, challenge timing, and data availability is so rich. Every parameter trades scalability against security, finality against responsiveness, and decentralization against operator efficiency.

---

## 2. The Problem: Ethereum Layer 1 Does Not Scale

Ethereum's execution layer was not designed for application-layer throughput. Every full node in the network re-executes every transaction in every block, validates every state transition, and stores the resulting state. This redundant computation is what gives Ethereum its security properties—there is no privileged validator, no trusted executor, no party whose word about state is taken on faith—but it is also what bounds throughput. Concretely, Ethereum L1 sustains approximately 15–30 transactions per second.

The *scaling trilemma*—the observation, popularized by Vitalik Buterin, that decentralization, security, and scalability cannot all be maximized simultaneously by a single L1—implies that scaling cannot come for free. Any solution must give something up. The strategy adopted by rollups is to give up *self-contained execution*: rollups do not run on Ethereum's nodes. Computation happens off-chain on rollup-operator infrastructure. What rollups *do* commit to L1 is the data needed to reconstruct their state and the cryptographic commitment that pins down what that state is. Ethereum is reduced from "execution layer" to "data availability and dispute resolution layer"—a much cheaper job per transaction.

The core insight is that **L1 only needs to be the source of truth, not the executor of every step**. As long as L1 stores enough information that anyone can independently verify the rollup's claimed state, and as long as L1 has a procedure for adjudicating disputes, the rollup itself can run on commodity off-chain infrastructure and still inherit L1-grade security.

---

## 3. What Is an Optimistic Rollup?

An *optimistic rollup* is an L2 protocol that:

1. Executes transactions off-chain on its own execution environment (typically EVM-compatible).
2. Compresses and posts the resulting transaction data, plus a *state-root commitment*, to L1 in batches.
3. Treats each posted state root as valid by default—*optimistically*—without proving its correctness up front.
4. Permits any independent observer, during a fixed *challenge window* (~7 days), to submit a *fraud proof* showing that the posted state root does not correspond to honest execution of the posted transactions.
5. If a fraud proof succeeds, the offending batch (and all subsequent batches that depended on it) is invalidated, and the dishonest sequencer's bond is slashed.
6. If the challenge window closes with no successful fraud proof, the state root is considered final on L1.

Security derives from two assumptions: **data availability** (all transaction data is posted to L1, so anyone can independently reconstruct state) and **at least one honest challenger** (a single non-colluding party can submit a fraud proof when warranted). This is a "1-of-N" security model—anyone can become a challenger by posting the required bond.

### Transaction Lifecycle

The lifecycle of a single transaction proceeds through four phases. The user submits an L2 transaction and receives a soft confirmation from the sequencer within seconds. The sequencer batches and executes transactions off-chain, then posts the batch and a state-root commitment to L1. During the subsequent ~7 day challenge window, any party may re-execute the batch and challenge the result. If no challenge succeeds, the state root is finalized and L2-to-L1 withdrawals become claimable.

Two asymmetries matter in practice. **Deposits (L1→L2) are fast**—typically minutes. **Withdrawals (L2→L1) are slow**—they must wait out the full challenge window. Third-party "fast bridges" provide same-block liquidity for withdrawals at a fee.

---

## 4. Core Architecture

An optimistic rollup is built from four interacting components.

### Sequencer

The sequencer is the rollup's transaction-ordering and execution authority. It receives user transactions, sequences them, executes them against current state, batches them, and posts the resulting commitment to L1. In every major production deployment today the sequencer is **centralized**—a deliberate operational simplification providing better latency and simpler MEV economics, at the cost of a known censorship vector. The mitigation is twofold: the sequencer cannot steal funds (because of fraud proofs), and all rollups expose a *forced inclusion* mechanism allowing users to bypass a misbehaving sequencer via L1 directly.

The sequencer's economic accountability is enforced by a **bond**: collateral posted on L1 that is slashed if any fraud proof against its batches succeeds.

### State Root

The state root is the cryptographic commitment posted alongside each batch—a Merkle root over the rollup's entire state at the moment after the batch's last transaction. It is a 32-byte fingerprint uniquely identifying rollup state, succinctly verifiable via Merkle proofs. The dispute system fundamentally operates on state roots: the sequencer claims "after batch B, the state root is R"; the challenger asserts "no, it is R'".

### Challengers

A challenger is any entity running an independent node that replays the sequencer's posted batches and submits a fraud proof on discrepancy. The role is permissionless—anyone can become a challenger by posting the required bond. The economic model is symmetric: a challenger's bond is slashed on a wrong proof, and the dishonest sequencer's bond is awarded to a successful challenger.

### L1 Rollup Contracts

The L1 contracts hold sequencer and challenger bonds, store posted batch headers, implement the dispute state machine (bisection, single-step verification, slashing), and process deposits and withdrawals. These contracts are the **trust anchor** of the entire system.

---

## 5. Fraud Proofs: The Core Security Mechanism

A fraud proof is a procedure executed on L1 demonstrating that the sequencer's posted state root is inconsistent with honest execution of the posted transactions. There are two architectural approaches.

### Non-Interactive Fraud Proofs

In a non-interactive scheme, the challenger submits a proof of incorrect execution verifiable in a single transaction. The direct version—L1 re-executes the entire disputed batch—is conceptually clean but operationally infeasible: a typical batch may contain thousands of transactions whose re-execution would consume more gas than the rollup was designed to save.

### Interactive Fraud Proofs (Bisection Games)

The interactive approach, used by all production optimistic rollups today, reduces a disputed batch to a *single execution step* through a binary-search game:

1. The sequencer and challenger each commit to a sequence of intermediate state roots—one per transaction.
2. They disagree on the final root, so there exists a first index of divergence.
3. The L1 contract orchestrates bisection: at each round, the disputed range is halved by examining the midpoint state root.
4. After O(log N) rounds, the range is a single step.
5. L1 re-executes that one step; the party whose claim matches actual execution wins, the other is slashed.

This means **L1 only ever re-executes one step**, regardless of batch size. The cost of the dispute is logarithmic in transaction count for bisection rounds plus a constant for single-step verification.

### Bonds and Economic Security

Both sides post bonds before participating. On resolution, the loser's bond is forfeit—part awarded to the winner as a bounty (incentivizing honest challenge), part burned or paid to the protocol treasury (preventing griefing collusion). **Fraud is negative-EV for any rational actor whose bond exceeds the extractable value from lying.** No successful mainnet fraud has occurred in either Arbitrum or Optimism.

---

## 6. Production Comparison: Arbitrum (BoLD) vs. Optimism (Cannon)

Both systems use interactive fraud proofs, EVM-compatible execution, a single sequencer, a challenge window, and on-chain rollup contracts. The substantive difference is *what virtual machine the single-step re-execution runs on*.

### Arbitrum: BoLD

Arbitrum's dispute protocol is called **BoLD** (Bounded Liquidity Delay)—the rule system governing the bisection game. The single-step re-execution runs against an EVM-equivalent environment: the disputed step is an actual EVM instruction on actual EVM state, with no translation layer. The advantage is directness; the constraint is that Arbitrum's L2 execution must remain EVM-equivalent.

### Optimism: Cannon

Optimism's fault-proof system uses **Cannon**, a MIPS CPU emulator implemented in Solidity. Optimism's L2 execution client (a fork of go-ethereum) is compiled to MIPS bytecode; a single disputed step is a MIPS instruction executed inside Cannon. The advantage is decoupling—Optimism can upgrade its execution client without changing on-chain dispute infrastructure. The cost is the translation layer.

### Unifying View

Both systems reduce a dispute to verifying a single execution step on L1—an EVM opcode in Arbitrum's case, a MIPS instruction in Optimism's case. These are different points on a design surface trading directness against decoupling, not fundamentally different security models.

---

## 7. Data Availability and EIP-4844

Data availability is a prerequisite for the security of optimistic rollups. Without it, challengers cannot reconstruct state and cannot submit fraud proofs: if a sequencer posts a batch header but withholds the underlying transaction data, honest challengers are blinded.

The original data-availability solution was to post transaction data as **calldata** on Ethereum L1—permanently accessible, billed at 16 gas per non-zero byte, and dominant in the fees users pay on L2 at peak prices.

### EIP-4844 (Proto-Danksharding)

EIP-4844, activated in the Cancun hard fork (March 2024), introduced **blob-carrying transactions** as a substantially cheaper alternative. Key properties:

- **Large and cheap.** Blobs are ~128 KB each, priced on a separate fee market (the *blob base fee*) that adjusts independently of EVM gas. Under normal conditions, a blob costs a fraction of equivalent calldata.
- **Finite retention.** Blobs are stored by Ethereum nodes for approximately 18 days, then pruned. This window exceeds the 7-day challenge window, so blob data remains available for the full duration of any dispute.
- **Permanent commitment.** Even after pruning, a KZG polynomial commitment to the blob is stored on L1 indefinitely, anchoring data availability proofs for future protocols.

Both Arbitrum and Optimism now publish L2 transaction data primarily as blobs rather than calldata. User fees on L2 fell by roughly an order of magnitude following EIP-4844 activation.

### Data Availability in Our Implementation

Our implementation posts delta arrays as contract storage (via `batchDeltas[batchId]`), not blobs. This is a deliberate simplification: our batches are tiny (four integers), blob transactions require a special transaction type, and demonstrating the dispute mechanics does not require a production-realistic data layer. In production, the challenger reads batch data from the L1 calldata or blob; in our system, the challenger calls `getBatchDeltas(batchId)` directly.

---

## 8. Optimistic vs. Zero-Knowledge Rollups

| Dimension | Optimistic | ZK |
|---|---|---|
| Validity model | Assumed valid; challenged if not | Proven mathematically per batch |
| Withdrawal latency | ~7 days | Minutes |
| EVM compatibility | Easy — runs EVM directly | Hard — requires zkEVM |
| Per-batch cost | Cheap (proof only on dispute) | Expensive (SNARK every batch) |
| Security model | Crypto-economic (1-of-N honest) | Cryptographic / mathematical |
| Operational maturity | Battle-tested (Arbitrum, Optimism) | Catching up rapidly |

Optimistic rollups are **crypto-economic**—secure because lying is unprofitable. ZK rollups are **mathematical**—secure because lying is impossible (modulo cryptographic assumptions and circuit correctness). Optimistic rollups optimize for cheapness and EVM-compatibility, accepting the seven-day delay. ZK rollups optimize for finality and trust-minimization, accepting higher proving costs.

The current ecosystem consensus is that ZK rollups are the long-term destination, but optimistic rollups are the pragmatic present.

---

## 9. Implementation: System Overview

The second half of our project was a working interactive optimistic rollup deployed to Base Sepolia testnet. The implementation has three main parts:

1. `InteractiveOptimisticRollup` — a Solidity smart contract that holds bonds, accepts batch submissions, drives the bisection dispute game, performs single-step verification, and tracks claimable balances after resolution.
2. `interactive-sequencer-runner.ts` — a TypeScript script that posts batches, watches for challenges, and submits midpoint and single-step claims as the dispute game advances.
3. `interactive-challenger-runner.ts` — a TypeScript script that polls for new batches, re-executes them locally, initiates challenges on discrepancy, and submits midpoint and single-step claims.

Both runners interact with the contract via `ethers.js` through Hardhat's network connection. All coordination is mediated through the smart contract—both runners read on-chain state and respond; they do not communicate directly with each other.

### Simplified State Model: Deltas Instead of Merkle Roots

A real optimistic rollup commits to a Merkle root over every account and storage slot, executes arbitrary EVM transactions, and verifies single steps inside an EVM or MIPS emulator. Our project abstracts away this machinery while preserving the *structure* of the dispute game.

Instead of a Merkle root, the rollup state is a single integer. Instead of an EVM transaction, each "transaction" is an integer **delta** added to the current state:

```
s₀ = initialState,    s_{i+1} = sᵢ + dᵢ
```

The final state of the batch is sₙ. This is a 1-D, deterministic, easily-verifiable model that demonstrates dispute mechanics without the engineering burden of a real EVM emulator.

In presentation terms: the delta model is a **proxy for Merkle computation**. In a real system, the "midpoint state at index k" would be a Merkle root Rₖ over the full rollup state after transaction k. We made the accumulation visible (integer math) rather than opaque (hash-tree computations) so that the dispute logic is legible during the demo.

---

## 10. The `InteractiveOptimisticRollup` Contract

### Core State Variables

- `sequencerBond`, `challengerBond` — required deposits for batch submission and challenge initiation.
- `challengePeriod` — duration of the challenge window in seconds.
- `batches[batchId]` — per-batch struct: `submittedAt`, `initialState`, `claimedFinalState`, `txCount`, `challenged`, `finalized`, `invalidated`.
- `disputes[batchId]` — per-batch dispute struct tracking the bisection range (`start`, `end`, `mid`), both parties' midpoint and single-step claims, and resolution flags (`sequencerWon`, `challengerWon`).
- `claimableBalances[address]` — withdrawable balance after resolution or finalization.

### Key Functions

- `submitBatch(initialState, claimedFinalState, deltas)` — consumes `sequencerBond`; records the batch; starts the challenge timer.
- `initiateChallenge(batchId, challengerFinalState)` — consumes `challengerBond`; opens a dispute over range [0..txCount-1].
- `submitSequencerMidpointClaim` / `submitChallengerMidpointClaim` — each party submits their claimed state at the current range midpoint. When both claims are present, the contract advances the range: if midpoints differ, the lower half is disputed; if they match, the upper half is disputed.
- `submitSequencerSingleStepClaim` / `submitChallengerSingleStepClaim` — once the range is a single index, each party submits their claimed post-state. The contract computes `expected = preState + delta` from its stored data and awards the party whose claim matches.
- `finalizeBatch(batchId)` — callable after the challenge period elapses with no dispute; credits the sequencer's bond back.

The contract emits events at every state transition (`BatchSubmitted`, `ChallengeInitiated`, `MidpointClaimSubmitted`, `DisputeBisected`, `SingleStepClaimSubmitted`, `DisputeResolved`, `BatchFinalized`).

### Bisection State Machine

The dispute moves through three phases. From **WindowOpen**, a call to `initiateChallenge` enters **Bisecting**; expiry with no challenge enters **Finalized**. In **Bisecting**, each round where both midpoint claims are submitted halves the range; when the range collapses to one index the machine enters **SingleStep**. Once both single-step claims are submitted the contract resolves to **ChallengerWon** or **SequencerWon** based on which party's claim matches `preState + delta`.

For our demo batches of 4 transactions, the worst case is 2 bisection rounds plus one single-step verification, consistent with O(log₂ 4) = 2.

---

## 11. The Sequencer Runner

`interactive-sequencer-runner.ts` is the off-chain agent for the sequencer role. Key environment variables:

- `SUBMITTED_DELTAS_CSV` — deltas posted on-chain as the batch's transaction list.
- `ACTUAL_USED_DELTAS_CSV` *(optional)* — deltas the sequencer uses internally for its dispute assertions. When this differs from `SUBMITTED_DELTAS_CSV`, the sequencer is committing fraud.
- `CLAIMED_FINAL_STATE` *(optional)* — the final state reported in `submitBatch`; defaults to applying `ACTUAL_USED_DELTAS_CSV` to `INITIAL_STATE`.

This three-knob configuration enables simulating fraud at any layer: *payload-substitution* (post one set of deltas, compute against another), *final-state-only* (honest deltas, fraudulent result), both, or neither.

`CHALLENGER_WRONG_DELTAS` enables simulating a frivolous challenge—the challenger intentionally uses wrong deltas, demonstrating the case where the challenger loses and is slashed.

---

## 12. The Challenger Runner

`interactive-challenger-runner.ts` is the off-chain agent for the challenger role. It polls for new batches, re-executes each batch locally by applying the on-chain deltas to the stated initial state, and compares its derived final state against the sequencer's claimed final state.

On a mismatch, the challenger calls `initiateChallenge`. The challenger runner then follows the dispute game: at each bisection round it computes the midpoint state from the honest delta path and calls `submitChallengerMidpointClaim`; at single-step it submits `submitChallengerSingleStepClaim`. Race conditions between poll reads and writes are handled by re-reading state immediately before sending and catching known revert selectors (`DisputeNotAtSingleStep` = `0xb111df84`, `MidpointAlreadySubmitted` = `0xe34e893d`).

---

## 13. Demonstration on Base Sepolia: Walkthrough and On-Chain Results

The full demonstration was deployed and run on the **Base Sepolia** testnet.

**Contract address:** `0xA0ECD0679E087a4E821776eAA139E4adc265807d`  
**Block explorer:** https://sepolia.basescan.org/address/0xA0ECD0679E087a4E821776eAA139E4adc265807d

Contract configuration: `CHALLENGE_PERIOD = 300 s` (5 minutes, shortened from the production 7-day window for the demo); `SEQUENCER_BOND = CHALLENGER_BOND = 0.005 ETH`.

### Demo Scenario: Sequencer Commits Fraud

The demo ran the sequencer-fraud scenario. The sequencer posted honest deltas on-chain but used fraudulent deltas internally (a payload-substitution attack):

| Parameter | Value |
|---|---|
| Initial state | 10 |
| Submitted deltas (on-chain) | [5, -2, 4, 1] |
| Actual sequencer deltas | [5, -2, **5**, 1] (fraud at index 2) |
| Honest final state | 10 + 5 - 2 + 4 + 1 = **18** |
| Sequencer's claimed final | 10 + 5 - 2 + 5 + 1 = **19** |

The challenger re-executed the batch using the on-chain deltas and derived state 18, disagreeing with the sequencer's claimed 19. State paths:

| Index | Pre-state | On-chain delta | Honest post | Seq. (fraud) post | Agree? |
|---|---|---|---|---|---|
| 0 | 10 | +5 | 15 | 15 | ✓ |
| 1 | 15 | -2 | 13 | 13 | ✓ |
| 2 | 13 | +4 (seq claims +5) | 17 | **18** | ✗ |
| 3 | 17/18 | +1 | 18 | **19** | ✗ |

### Transaction Sequence and Gas Costs

The complete dispute proceeded through **8 on-chain transactions** across blocks 41136677–41136693, a span of **16 blocks ≈ 32 seconds** on Base Sepolia's 2-second block time.

---

**Tx 1 — `submitBatch`** (bond posting + batch submission)  
Hash: `0x10dd9a73298db741a7098aa8ec4be64a2cf590f2771e7e15fdfc44ed74b54015`  
Block: 41136677 | Gas used: **273,306**  
The sequencer submitted deltas [5,-2,4,1], claimed final state 19, and locked 0.005 ETH bond. The contract stored the batch struct, the four-element delta array, and emitted `BatchSubmitted`.

---

**Tx 2 — `initiateChallenge`**  
Hash: `0xd9087c186e1e1ce802fb801adcd36a0f4b0120d663e70cb1c848690eea819e93`  
Block: 41136679 | Gas used: **158,322**  
The challenger, having derived state 18 vs. the claimed 19, initiated a challenge with 0.005 ETH bond. The dispute struct was initialized with range [0, 3].

---

**Bisection Round 1 — range [0, 3], midpoint index 1**

**Tx 3 — `submitSequencerMidpointClaim`**  
Hash: `0xb762c1a72c87183a4595ab1f8d228f76dc6544f78ea15ba9a04eed4fa329990e`  
Block: 41136682 | Gas used: **101,205**  
Sequencer's state at index 1 = 13.

**Tx 4 — `submitChallengerMidpointClaim`**  
Hash: `0x972f75af1bcff9fd1a0acb830eb02dea94ac35160969be14882bdbf9b47a3c9b`  
Block: 41136684 | Gas used: **70,873**  
Challenger's state at index 1 = 13. Both claims match; the contract advanced the range to the upper half [2, 3] and emitted `DisputeBisected`. *Round 1 total: 172,078 gas.*

---

**Bisection Round 2 — range [2, 3], midpoint index 2**

**Tx 5 — `submitSequencerMidpointClaim`**  
Hash: `0xd357df80d9bff6d12b2abcc69481f41d5264be650a092e001858f80b592e46b8`  
Block: 41136686 | Gas used: **84,105**  
Sequencer's (fraudulent) state at index 2 = 18.

**Tx 6 — `submitChallengerMidpointClaim`**  
Hash: `0x609959182c6b0b41c5386da7f648c21b3aab2987c8b2ac1c71d69f862cd6109d`  
Block: 41136688 | Gas used: **57,154**  
Challenger's state at index 2 = 17. Claims differ (18 ≠ 17); the contract narrowed the range to [2, 2] (single step). `DisputeBisected` emitted. *Round 2 total: 141,259 gas.*

---

**Single-Step Verification — disputed index 2**

**Tx 7 — `submitSequencerSingleStepClaim`**  
Hash: `0x5abcf661d1ab0f392638597629cfdc6a90b25e5738eb8a01f8f361cff97a52ab`  
Block: 41136691 | Gas used: **79,237**  
Sequencer claimed post-state = 18.

**Tx 8 — `submitChallengerSingleStepClaim`** (triggers resolution)  
Hash: `0xf425df21f6aedd301cf40326ef90a46efeccce36177d40dbde3fe9855ff42fc2`  
Block: 41136693 | Gas used: **110,039**  
Challenger claimed post-state = 17. The contract executed `_resolveSingleStepWithClaims`: computed `preState = _stateBeforeIndex(2) = 13`, then `expected = 13 + batchDeltas[2] = 13 + 4 = 17`. Challenger's claim 17 = expected; sequencer's claim 18 ≠ expected. **Challenger wins.** Batch invalidated; sequencer's 0.005 ETH bond credited to challenger (total claimable: 0.010 ETH). *Single-step total: 189,276 gas.*

---

### Summary of On-Chain Results

| Metric | Value |
|---|---|
| Network | Base Sepolia |
| Contract address | `0xA0ECD0679E087a4E821776eAA139E4adc265807d` |
| Batch size | 4 transactions |
| Bisection rounds | 2 |
| Total on-chain transactions | 8 |
| Tx 1: `submitBatch` | 273,306 gas |
| Tx 2: `initiateChallenge` | 158,322 gas |
| Round 1 bisection (2 txs) | 172,078 gas |
| Round 2 bisection (2 txs) | 141,259 gas |
| Single-step verification (2 txs) | 189,276 gas |
| **Total gas used** | **934,241** |
| Block span (Tx 1 to Tx 8) | 16 blocks (≈ 32 seconds) |
| Challenge period (demo config) | 300 s (5 minutes) |
| Dispute outcome | Challenger won; sequencer's bond slashed |

The bisection game resolved the 4-transaction dispute in exactly 2 rounds—consistent with the O(log₂ 4) = 2 theoretical prediction. L1 re-executed exactly *one* step (index 2) to determine the winner, without ever re-executing the rest of the batch. The entire on-chain dispute settled in approximately 32 seconds of wall-clock time.

---

## 14. Discussion: Trade-offs of the Implementation

### 14.1 Delta Model vs. Real State — and What Merkle Commitment Would Require

The most consequential simplification is the integer-delta state model.

**What this preserves:** the *shape* of the dispute game—bonds, batch posting, bisection, single-step verification, slashing, finalization. Everything in our contract has a structural counterpart in production rollups.

**What this discards:** the *content* of execution. We cannot run smart contracts, host applications, or represent multiple accounts. Our "state" is one integer; our "transactions" are integers added to it.

**What Merkle-committed state would require differently.** If state were committed via a Merkle root rather than a plain integer, the bisection mechanics would need to change in two specific places.

*At each midpoint claim*: instead of posting a plain integer (e.g., `sequencerStateAtMid = 13`), each party would post a **32-byte state root hash**—a Merkle root over the entire rollup state after executing transactions through that midpoint index. The contract would store and compare these hashes. The comparison semantics are identical (`sequencerMidRoot != challengerMidRoot` still indicates the lower half is disputed), but the claimed value now represents a full EVM state commitment. The parties are bound to this commitment without needing to prove its correctness on-chain at claim time; they cannot later contradict their earlier claim.

*At the single-step verification*: once the range is a single index *i*, the single-step resolver must verify three things on-chain rather than one:

1. **Pre-state witness**: a Merkle proof showing that the agreed-upon state before index *i*—the hash accepted by both parties in the final bisection round—correctly encodes the specific account balances and storage slots that transaction *i* reads. This *witness* authenticates the pre-state for the disputed step.
2. **Execution**: apply transaction *i* to the authenticated pre-state. In a production rollup this is a full EVM opcode (Arbitrum) or a MIPS instruction (Optimism's Cannon); in our system it is `preState + delta[i]`.
3. **Post-state commitment**: verify that the resulting post-state, when re-committed into a new Merkle root, produces the hash that one party claimed as their state at index *i*+1.

The witness construction step (point 1) is the most technically demanding addition. It requires the challenger to submit a Merkle proof showing that the agreed pre-state root at index *i* contains the specific values the disputed transaction reads. In Optimism's Cannon, this is a MIPS memory witness proving the program state at that single instruction. In Arbitrum, it is an EVM execution proof over the disputed opcode.

Our integer-delta model sidesteps witness construction entirely: the pre-state is a single integer computable on-chain by iterating `batchDeltas[batchId]`, and the "transaction" is integer addition with no external data dependencies. This is why our single-step resolver is trivially cheap (one loop plus one addition) compared to a production dispute resolver that must accept, validate, and apply Merkle witnesses.

### 14.2 Posting Raw Deltas vs. Hash Commitments

We post the full delta array as contract storage rather than a hash commitment. In a real rollup, calldata costs would make this prohibitive at scale—hence EIP-4844 blobs. In our model the deltas are short integers and gas cost is negligible. In production, the challenger reconstructs batch data from L1 calldata or blob and uses Merkle proofs to verify specific transaction content; in our system, `getBatchDeltas(batchId)` serves this role.

### 14.3 Centralized Sequencer; Permissionless Challenger

The contract permits exactly one sequencer address to call `submitBatch`, matching production deployments (Arbitrum and Optimism are also single-sequencer). Conversely, anyone can be a challenger by holding the bond, which matches the production permissionless-challenge model.

### 14.4 What We Did Right

Despite the simplifications, the implementation faithfully demonstrates several non-obvious properties:

- **Logarithmic bisection.** Four-transaction batches resolve in 2 rounds plus 1 single-step verification, exactly as theory predicts.
- **Contract as sole source of truth.** Neither runner can win by lying to the contract—the contract independently re-executes the disputed step against its own stored data.
- **Race conditions are real.** Our runner code handles `DisputeNotAtSingleStep` and `MidpointAlreadySubmitted` reverts encountered during development. A naïve implementation would crash.
- **Real funds on a real network.** Every action required a live L2 transaction, making the demo categorically different from a local simulation.
- **Step mode makes the dispute legible.** Without explicit pause points, a demo audience cannot follow multi-party state-machine progress over time.

---

## 15. Future Work

Natural next steps, in increasing order of effort:

1. **Replace the delta model with Merkle-rooted state.** State becomes a sparse Merkle tree of account balances; transactions become `(from, to, amount)` triples; single-step verification requires Merkle witness infrastructure as described in Section 14.1.
2. **Move to a real EVM transaction model.** Minimal EVM interpreter; Patricia trie state commitment.
3. **Add forced inclusion.** Allow users to bypass a censoring sequencer via L1 directly—an essential production security property.
4. **Permissioned-then-permissionless sequencer transition.** Demonstrate the operational handoff real rollups must eventually execute.
5. **Combine with a validity proof.** Use a SNARK for the optimistic majority of batches and fall back to a fraud proof for edge cases—the frontier of optimistic-rollup design in 2026.

---

## 16. Conclusion

Optimistic rollups are the dominant production answer to Ethereum's scaling problem. They achieve their throughput by relocating execution off-chain while inheriting L1 security through data availability and interactive fraud proofs. Their seven-day challenge window is a calibrated compromise between fraud-detection needs and withdrawal-latency user experience. The bisection game makes single-step verification cost independent of batch size—the property without which fraud proofs would be operationally infeasible.

The architectural difference between Arbitrum and Optimism—BoLD versus Cannon, EVM-direct versus MIPS-emulator—is real but represents different points on a single design axis, not fundamentally different security models. Both reduce a dispute to one execution step on L1; both rely on the same economic argument that lying is unprofitable with a properly-sized bond; both have demonstrated in practice that this argument holds.

Our implementation, while deliberately simplified, exhibits the full structure of an interactive optimistic rollup: bonded sequencer, permissionless challenger, on-chain state machine, and runner agents driving the dispute from both sides. Deployed to Base Sepolia testnet at `0xA0ECD0679E087a4E821776eAA139E4adc265807d`, the system demonstrated each phase end-to-end in 8 on-chain transactions consuming **934,241 gas total**—exactly 2 bisection rounds plus a single-step verification for a 4-transaction batch, matching O(log N) complexity. The contract re-executed exactly one step, index 2, to determine the winner in 16 blocks (≈ 32 seconds). It is, at small scale, the security model of Arbitrum or Optimism—proof that the surrounding theory is implementable from first principles in a few hundred lines of code, given the right abstractions.

The single most important insight from the implementation is the inseparability of contract logic and incentive design. The contract does not merely enforce rules—it engineers payoffs. The protocol functions because dishonesty is expensive. Writing the contract is, fundamentally, writing game theory.

---

## Appendix: Glossary

| Term | Definition |
|---|---|
| Batch | A collection of L2 transactions posted together to L1, with a single state-root commitment. |
| Bisection | The dispute-narrowing procedure that recursively halves the disputed transaction range. |
| Blob | A large (~128 KB), cheaply-priced data object attached to an EIP-4844 transaction; stored on L1 for ~18 days. |
| BoLD | Arbitrum's bonded dispute-protocol rule system (Bounded Liquidity Delay). |
| Bond | Collateral posted by sequencer or challenger; slashed on loss. |
| Cannon | Optimism's MIPS-based fault-proof CPU emulator, implemented in Solidity. |
| Challenge window | The fixed period (~7 days) during which a fraud proof may be submitted. |
| Data availability | The property that all data needed to reconstruct L2 state is published to and retrievable from L1. |
| EIP-4844 | The Cancun hard fork upgrade introducing blob-carrying transactions; drastically reduced L2 data posting costs. |
| Finalization | The point at which an L2 batch becomes irrevocable on L1, after the challenge window closes without a successful fraud proof. |
| Forced inclusion | A mechanism allowing users to submit L2 transactions directly through L1, bypassing a censoring sequencer. |
| Fraud proof | Evidence submitted to L1 that a previously-posted state root is inconsistent with honest execution of its associated batch. |
| Merkle witness | A Merkle proof showing that a specific value is contained in a committed state root; required at single-step verification in production rollups. |
| Sequencer | The entity that orders, executes, and posts L2 transactions. |
| Single-step | The atomic execution step (EVM opcode, MIPS instruction, or delta) re-executed on L1 to resolve a dispute. |
| State root | A 32-byte cryptographic commitment (Merkle root) to the rollup's complete state at a point in time. |
| zkEVM | An EVM execution environment compiled into a SNARK-friendly arithmetic circuit, enabling validity proofs of EVM execution. |
