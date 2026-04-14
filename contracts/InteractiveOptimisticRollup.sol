// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract InteractiveOptimisticRollup {
    struct Batch {
        address sequencer;
        int256 initialState;
        int256 claimedFinalState;
        uint256 submittedAt;
        uint256 txCount;
        bool challenged;
        bool finalized;
        bool invalidated;
        bool bondSettled;
    }

    struct Dispute {
        address challenger;
        bool active;
        bool resolved;
        uint256 start;
        uint256 end;
        int256 sequencerFinalState;
        int256 challengerFinalState;
        bool sequencerWon;
        bool challengerWon;
    }

    uint256 public immutable challengePeriod;
    uint256 public immutable sequencerBond;
    uint256 public immutable challengerBond;
    uint256 public latestBatchId;

    mapping(uint256 => Batch) public batches;
    mapping(uint256 => int256[]) private batchDeltas;
    mapping(uint256 => Dispute) public disputes;
    mapping(address => uint256) public claimableBalances;

    event BatchSubmitted(
        uint256 indexed batchId,
        int256 indexed initialState,
        int256 claimedFinalState,
        uint256 txCount,
        uint256 submittedAt
    );
    event ChallengeInitiated(uint256 indexed batchId, int256 challengerFinalState);
    event DisputeBisected(uint256 indexed batchId, uint256 start, uint256 end, uint256 mid, bool lowerHalfDisputed);
    event DisputeResolved(uint256 indexed batchId, bool challengerWon, bool sequencerWon, uint256 disputedIndex);
    event BatchFinalized(uint256 indexed batchId, int256 claimedFinalState);

    error BatchDoesNotExist(uint256 batchId);
    error EmptyBatch();
    error BatchAlreadyChallenged(uint256 batchId);
    error BatchAlreadyFinalized(uint256 batchId);
    error BatchInvalidated(uint256 batchId);
    error ChallengeWindowClosed(uint256 batchId);
    error ChallengeWindowStillOpen(uint256 batchId);
    error DisputeNotActive(uint256 batchId);
    error DisputeAlreadyResolved(uint256 batchId);
    error DisputeNotAtSingleStep(uint256 batchId);
    error ClaimsMustDiffer();
    error InvalidDisputedIndex();
    error InvalidSequencerBond(uint256 expected, uint256 actual);
    error InvalidChallengerBond(uint256 expected, uint256 actual);
    error NoWithdrawableBalance(address account);

    constructor(uint256 _challengePeriodSeconds, uint256 _sequencerBond, uint256 _challengerBond) {
        challengePeriod = _challengePeriodSeconds;
        sequencerBond = _sequencerBond;
        challengerBond = _challengerBond;
    }

    function submitBatch(
        int256 _initialState,
        int256 _claimedFinalState,
        int256[] calldata _deltas
    ) external payable returns (uint256 batchId) {
        if (_deltas.length == 0) revert EmptyBatch();
        if (msg.value != sequencerBond) revert InvalidSequencerBond(sequencerBond, msg.value);

        batchId = ++latestBatchId;

        Batch storage batch = batches[batchId];
        batch.sequencer = msg.sender;
        batch.initialState = _initialState;
        batch.claimedFinalState = _claimedFinalState;
        batch.submittedAt = block.timestamp;
        batch.txCount = _deltas.length;
        batch.challenged = false;
        batch.finalized = false;
        batch.invalidated = false;
        batch.bondSettled = false;

        for (uint256 i = 0; i < _deltas.length; i++) {
            batchDeltas[batchId].push(_deltas[i]);
        }

        emit BatchSubmitted(batchId, _initialState, _claimedFinalState, _deltas.length, block.timestamp);
    }

    function initiateChallenge(uint256 _batchId, int256 _challengerFinalState) external payable {
        Batch storage batch = _mustGetBatch(_batchId);

        if (msg.value != challengerBond) revert InvalidChallengerBond(challengerBond, msg.value);

        if (batch.finalized) revert BatchAlreadyFinalized(_batchId);
        if (batch.invalidated) revert BatchInvalidated(_batchId);
        if (batch.challenged) revert BatchAlreadyChallenged(_batchId);
        if (block.timestamp > batch.submittedAt + challengePeriod) revert ChallengeWindowClosed(_batchId);

        batch.challenged = true;

        Dispute storage dispute = disputes[_batchId];
        dispute.challenger = msg.sender;
        dispute.active = true;
        dispute.resolved = false;
        dispute.start = 0;
        dispute.end = batch.txCount - 1;
        dispute.sequencerFinalState = batch.claimedFinalState;
        dispute.challengerFinalState = _challengerFinalState;
        dispute.sequencerWon = false;
        dispute.challengerWon = false;

        emit ChallengeInitiated(_batchId, _challengerFinalState);
    }

    function bisectDispute(uint256 _batchId, int256 _sequencerStateAtMid, int256 _challengerStateAtMid) external {
        Dispute storage dispute = disputes[_batchId];
        if (!dispute.active) revert DisputeNotActive(_batchId);
        if (dispute.resolved) revert DisputeAlreadyResolved(_batchId);

        if (dispute.start == dispute.end) {
            revert DisputeNotAtSingleStep(_batchId);
        }

        uint256 mid = (dispute.start + dispute.end) / 2;
        bool lowerHalfDisputed = _sequencerStateAtMid != _challengerStateAtMid;

        if (lowerHalfDisputed) {
            dispute.end = mid;
        } else {
            dispute.start = mid + 1;
        }

        emit DisputeBisected(_batchId, dispute.start, dispute.end, mid, lowerHalfDisputed);
    }

    function resolveSingleStep(
        uint256 _batchId,
        int256 _sequencerClaimedPostState,
        int256 _challengerClaimedPostState
    ) external {
        Dispute storage dispute = disputes[_batchId];
        Batch storage batch = _mustGetBatch(_batchId);

        if (!dispute.active) revert DisputeNotActive(_batchId);
        if (dispute.resolved) revert DisputeAlreadyResolved(_batchId);
        if (dispute.start != dispute.end) revert DisputeNotAtSingleStep(_batchId);
        if (_sequencerClaimedPostState == _challengerClaimedPostState) revert ClaimsMustDiffer();

        uint256 disputedIndex = dispute.start;
        if (disputedIndex >= batch.txCount) revert InvalidDisputedIndex();

        int256 preState = _stateBeforeIndex(_batchId, disputedIndex);
        int256 expectedPostState = preState + batchDeltas[_batchId][disputedIndex];

        bool sequencerCorrect = _sequencerClaimedPostState == expectedPostState;
        bool challengerCorrect = _challengerClaimedPostState == expectedPostState;

        dispute.active = false;
        dispute.resolved = true;

        if (challengerCorrect && !sequencerCorrect) {
            dispute.challengerWon = true;
            dispute.sequencerWon = false;
            batch.invalidated = true;
            batch.challenged = true;

            claimableBalances[dispute.challenger] += sequencerBond + challengerBond;
            batch.bondSettled = true;
        } else {
            // If sequencer is correct (or challenger cannot prove correctness), challenger loses.
            dispute.challengerWon = false;
            dispute.sequencerWon = true;
            batch.invalidated = false;
            batch.challenged = false;

            claimableBalances[batch.sequencer] += sequencerBond + challengerBond;
            batch.bondSettled = true;
        }

        emit DisputeResolved(_batchId, dispute.challengerWon, dispute.sequencerWon, disputedIndex);
    }

    function finalizeBatch(uint256 _batchId) external {
        Batch storage batch = _mustGetBatch(_batchId);

        if (batch.finalized) revert BatchAlreadyFinalized(_batchId);
        if (batch.invalidated) revert BatchInvalidated(_batchId);
        if (batch.challenged) revert BatchAlreadyChallenged(_batchId);
        if (block.timestamp < batch.submittedAt + challengePeriod) revert ChallengeWindowStillOpen(_batchId);

        batch.finalized = true;

        if (!batch.bondSettled) {
            claimableBalances[batch.sequencer] += sequencerBond;
            batch.bondSettled = true;
        }

        emit BatchFinalized(_batchId, batch.claimedFinalState);
    }

    function withdrawClaimable() external {
        uint256 amount = claimableBalances[msg.sender];
        if (amount == 0) revert NoWithdrawableBalance(msg.sender);

        claimableBalances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "withdraw transfer failed");
    }

    function getBatchDeltas(uint256 _batchId) external view returns (int256[] memory) {
        _mustGetBatch(_batchId);
        return batchDeltas[_batchId];
    }

    function getDeltaAt(uint256 _batchId, uint256 _index) external view returns (int256) {
        Batch storage batch = _mustGetBatch(_batchId);
        if (_index >= batch.txCount) revert InvalidDisputedIndex();
        return batchDeltas[_batchId][_index];
    }

    function _stateBeforeIndex(uint256 _batchId, uint256 _index) private view returns (int256 state) {
        Batch storage batch = batches[_batchId];
        state = batch.initialState;
        for (uint256 i = 0; i < _index; i++) {
            state += batchDeltas[_batchId][i];
        }
    }

    function _mustGetBatch(uint256 _batchId) private view returns (Batch storage batch) {
        batch = batches[_batchId];
        if (batch.submittedAt == 0) revert BatchDoesNotExist(_batchId);
    }
}
