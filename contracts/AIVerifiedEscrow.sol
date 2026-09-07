// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInferenceVerifier {
    function verify(bytes32 modelHash, bytes32 inputHash, bytes32 outputHash,
        bytes calldata evidence) external view returns (bool);
}

/// @notice Automated settlement for exactly specified, verifiable inference.
/// @dev Verifier is fixed for this instance; no admin, arbiter or price controls.
///      Security depends on verifier correctness. This contract does NOT hide payments.
contract AIVerifiedEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Job {
        address client;
        address provider;
        uint256 amount;
        uint64 deadline;
        bytes32 modelHash;
        bytes32 inputHash;
        bytes32 outputHash;
        uint8 state; // 1 funded, 2 paid, 3 refunded
    }
    IERC20 public immutable token;
    IInferenceVerifier public immutable verifier;
    uint256 public nextJobId = 1;
    uint256 public totalEscrowed;
    mapping(uint256 => Job) public jobs;
    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider,
        uint256 amount, uint64 deadline, bytes32 modelHash, bytes32 inputHash);
    event InferencePaid(uint256 indexed jobId, bytes32 outputHash);
    event JobRefunded(uint256 indexed jobId);

    constructor(IERC20 token_, IInferenceVerifier verifier_) {
        require(address(token_).code.length > 0 && address(verifier_).code.length > 0, "Invalid contract");
        token = token_;
        verifier = verifier_;
    }

    function createJob(address provider, uint256 amount, uint64 deadline,
        bytes32 modelHash, bytes32 inputHash) external nonReentrant returns (uint256 jobId)
    {
        require(provider != address(0) && provider != msg.sender, "Invalid provider");
        require(amount > 0 && modelHash != bytes32(0) && inputHash != bytes32(0), "Empty job");
        require(deadline > block.timestamp && deadline <= block.timestamp + 90 days, "Invalid deadline");
        jobId = nextJobId++;
        jobs[jobId] = Job(msg.sender, provider, amount, deadline, modelHash, inputHash, bytes32(0), 1);
        totalEscrowed += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit JobCreated(jobId, msg.sender, provider, amount, deadline, modelHash, inputHash);
    }

    /// @notice Only the named provider submits. A valid witness settles immediately.
    function settle(uint256 jobId, bytes32 outputHash, bytes calldata evidence) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.state == 1 && msg.sender == job.provider, "Cannot settle");
        require(block.timestamp <= job.deadline && outputHash != bytes32(0), "Expired or empty");
        require(verifier.verify(job.modelHash, job.inputHash, outputHash, evidence), "Invalid inference");
        job.state = 2;
        job.outputHash = outputHash;
        totalEscrowed -= job.amount;
        token.safeTransfer(job.provider, job.amount);
        emit InferencePaid(jobId, outputHash);
    }

    /// @notice Permissionless trigger, but funds always return to the original client.
    function refund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.state == 1 && block.timestamp > job.deadline, "Cannot refund");
        job.state = 3;
        totalEscrowed -= job.amount;
        token.safeTransfer(job.client, job.amount);
        emit JobRefunded(jobId);
    }
}
