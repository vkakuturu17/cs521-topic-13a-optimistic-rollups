// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SimpleOptimisticRollup {
    struct Batch {
        bytes32 stateRoot;
        bytes32 txRoot;
        uint256 submittedAt;
        bool challenged;
        bool finalized;
    }

    uint256 public immutable challengePeriod;
    uint256 public latestBatchId;

    mapping(uint256 => Batch) public batches;

    event BatchSubmitted(uint256 indexed batchId, bytes32 indexed stateRoot, bytes32 txRoot, uint256 submittedAt);
    event BatchChallenged(uint256 indexed batchId, address indexed challenger, bytes32 reasonHash);
    event BatchFinalized(uint256 indexed batchId, bytes32 indexed stateRoot);

    error BatchDoesNotExist(uint256 batchId);
    error BatchAlreadyChallenged(uint256 batchId);
    error BatchAlreadyFinalized(uint256 batchId);
    error ChallengeWindowClosed(uint256 batchId);
    error ChallengeWindowStillOpen(uint256 batchId);
    error BatchIsChallenged(uint256 batchId);

    constructor(uint256 _challengePeriodSeconds) {
        challengePeriod = _challengePeriodSeconds;
    }

    function submitBatch(bytes32 _stateRoot, bytes32 _txRoot) external returns (uint256 batchId) {
        batchId = ++latestBatchId;
        batches[batchId] = Batch({
            stateRoot: _stateRoot,
            txRoot: _txRoot,
            submittedAt: block.timestamp,
            challenged: false,
            finalized: false
        });

        emit BatchSubmitted(batchId, _stateRoot, _txRoot, block.timestamp);
    }

    function challengeBatch(uint256 _batchId, bytes32 _reasonHash) external {
        Batch storage batch = batches[_batchId];
        _ensureExists(_batchId, batch);

        if (batch.finalized) revert BatchAlreadyFinalized(_batchId);
        if (batch.challenged) revert BatchAlreadyChallenged(_batchId);
        if (block.timestamp > batch.submittedAt + challengePeriod) revert ChallengeWindowClosed(_batchId);

        batch.challenged = true;

        emit BatchChallenged(_batchId, msg.sender, _reasonHash);
    }

    function finalizeBatch(uint256 _batchId) external {
        Batch storage batch = batches[_batchId];
        _ensureExists(_batchId, batch);

        if (batch.finalized) revert BatchAlreadyFinalized(_batchId);
        if (batch.challenged) revert BatchIsChallenged(_batchId);
        if (block.timestamp < batch.submittedAt + challengePeriod) revert ChallengeWindowStillOpen(_batchId);

        batch.finalized = true;

        emit BatchFinalized(_batchId, batch.stateRoot);
    }

    function _ensureExists(uint256 _batchId, Batch storage batch) private view {
        if (batch.submittedAt == 0) revert BatchDoesNotExist(_batchId);
    }
}
