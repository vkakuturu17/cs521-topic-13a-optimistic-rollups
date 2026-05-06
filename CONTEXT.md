Final Report
• Each pair submits one final report (approximately 10 pages) combining a conceptual
synthesis of the topic with a technical description of the implementation.
• The report should incorporate all feedback received over the semester and serve as a
comprehensive reference on the chosen topic.
• Both partners are credited equally on the report; individual differentiation comes from the
reflections and git history.


Feedback:
Round 1 + Round 2 Presentations — score so far: 9/10

Peer evaluation by classmates (from each round's Q&A form):
Round 1: 58 A / 3 B / 1 C / 0 N/A — mean 1.92 / 2
Round 2: 58 A / 4 B / 1 C / 1 N/A — mean 1.9 / 2


(This score covers the Recorded Presentations component only, which is 25% of the final grade per the syllabus. It is the combined assessment of Round 1 + Round 2 — the technical content, level of knowledge shown, and quality of the presentation as a product. Codebase quality, individual coding contributions, and reflections will be graded separately.)

A note on the grading process: I have personally spent at least an hour evaluating each project — watching the recorded videos, reading the scripts, and reviewing the presentations and supporting materials. I have also used AI tools to assist with the review and the cross-checking of scripts and content. I believe the grades are fair, but mistakes are possible. If you think I missed something or got something wrong, please reply here and let me know — I will reconsider.

Akhil and Vaasu, your Round 1 framed optimistic rollups through Ethereum L1's 15–30 TPS bottleneck, the off-chain execution with on-chain data-availability-and-dispute-resolution model, the 7-day challenge window with the "valid unless challenged" assumption resting on at least one honest challenger, the contrast between non-interactive fraud proofs (re-execute the whole batch on L1) and interactive bisection (binary-search to a single disputed step), and the data-availability requirement that lets challengers reconstruct state.

Round 2 delivered an InteractiveOptimisticRollup Solidity contract deployed to a live Ethereum testnet, with bond posting, batch submission carrying state-root hashes and integer-delta transactions, midpoint bisection narrowing the dispute range until a single-step on-chain verification, slashing of the losing party's bond, and two TypeScript runner scripts driving the sequencer and challenger end-to-end through every phase including the asynchronous polling required to detect dispute-range advances.

The arc from Round 1 to Round 2 moves from the conceptual survey to a working bisection game on real testnet infrastructure. Peer reception was at the top end of the class for both rounds.

For the final report and coding deliverable, report the actual on-chain numbers from the dispute walkthrough — gas cost per bisection step, total dispute resolution time, transaction hashes for the bond posting, midpoint claims, single-step verification, and slashing — rather than only describing the protocol; and write up the deliberate simplification of state-as-integer-deltas explicitly, with a note on what the bisection mechanics would require differently if state were Merkle-committed (proof posting at each midpoint, witness construction at the single-step level). Good job!




