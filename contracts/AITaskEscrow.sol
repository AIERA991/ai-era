// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Client-funded AI tasks with a designated provider and neutral arbiter.
/// @dev Model inference and quality verification happen off chain.
contract AITaskEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Status { None, Open, Submitted, Disputed, Paid, Refunded, Resolved }
    struct Task {
        address client;
        address provider;
        address arbiter;
        uint256 amount;
        uint64 deliveryDeadline;
        uint64 reviewDeadline;
        uint64 arbitrationDeadline;
        bytes32 specificationHash;
        bytes32 resultHash;
        Status status;
    }
    IERC20 public immutable token;
    uint256 public nextTaskId = 1;
    uint256 public constant REVIEW_PERIOD = 7 days;
    uint256 public constant ARBITRATION_PERIOD = 14 days;
    uint256 public totalEscrowed;
    mapping(uint256 => Task) public tasks;
    event TaskCreated(uint256 indexed id, address indexed client, address indexed provider,
        address arbiter, uint256 amount, uint64 deadline, bytes32 specificationHash);
    event ResultSubmitted(uint256 indexed id, bytes32 resultHash, uint64 reviewDeadline);
    event TaskDisputed(uint256 indexed id, uint64 arbitrationDeadline);
    event TaskSettled(uint256 indexed id, Status status, uint256 providerAmount, uint256 clientAmount);

    constructor(IERC20 token_) {
        require(address(token_).code.length > 0, "Invalid token");
        token = token_;
    }

    function createTask(address provider, address arbiter, uint256 amount,
        uint64 deliveryDeadline, bytes32 specificationHash) external nonReentrant returns (uint256 id)
    {
        require(provider != address(0) && arbiter != address(0), "Zero participant");
        require(provider != msg.sender && arbiter != msg.sender && arbiter != provider,
            "Participants must differ");
        require(amount > 0 && specificationHash != bytes32(0), "Empty task");
        require(deliveryDeadline > block.timestamp && deliveryDeadline <= block.timestamp + 90 days,
            "Invalid deadline");
        id = nextTaskId++;
        tasks[id] = Task(msg.sender, provider, arbiter, amount, deliveryDeadline,
            0, 0, specificationHash, bytes32(0), Status.Open);
        totalEscrowed += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit TaskCreated(id, msg.sender, provider, arbiter, amount, deliveryDeadline, specificationHash);
    }

    function submitResult(uint256 id, bytes32 resultHash) external {
        Task storage task = tasks[id];
        require(task.status == Status.Open && msg.sender == task.provider, "Cannot submit");
        require(block.timestamp <= task.deliveryDeadline && resultHash != bytes32(0), "Invalid result");
        task.resultHash = resultHash;
        task.reviewDeadline = uint64(block.timestamp + REVIEW_PERIOD);
        task.status = Status.Submitted;
        emit ResultSubmitted(id, resultHash, task.reviewDeadline);
    }

    function approveResult(uint256 id) external nonReentrant {
        Task storage task = tasks[id];
        require(task.status == Status.Submitted && msg.sender == task.client, "Cannot approve");
        _settle(id, Status.Paid, task.amount);
    }

    /// @notice A client has seven days after submission to dispute a result.
    function dispute(uint256 id) external {
        Task storage task = tasks[id];
        require(task.status == Status.Submitted && msg.sender == task.client, "Cannot dispute");
        require(block.timestamp <= task.reviewDeadline, "Review ended");
        task.status = Status.Disputed;
        task.arbitrationDeadline = uint64(block.timestamp + ARBITRATION_PERIOD);
        emit TaskDisputed(id, task.arbitrationDeadline);
    }

    /// @notice Client silence after the agreed review period releases payment.
    function claimAfterReview(uint256 id) external nonReentrant {
        Task storage task = tasks[id];
        require(task.status == Status.Submitted && block.timestamp > task.reviewDeadline, "Review active");
        _settle(id, Status.Paid, task.amount);
    }

    function refundUndelivered(uint256 id) external nonReentrant {
        Task storage task = tasks[id];
        require(task.status == Status.Open && block.timestamp > task.deliveryDeadline, "Delivery active");
        _settle(id, Status.Refunded, 0);
    }

    /// @notice The arbiter named at task creation may split this task's funds only.
    function resolve(uint256 id, uint256 providerAmount) external nonReentrant {
        Task storage task = tasks[id];
        require(task.status == Status.Disputed && msg.sender == task.arbiter, "Cannot resolve");
        require(block.timestamp <= task.arbitrationDeadline && providerAmount <= task.amount,
            "Invalid resolution");
        _settle(id, Status.Resolved, providerAmount);
    }

    /// @notice If the arbiter is inactive for 14 days, refund the client.
    /// @dev This fallback favors clients; providers must trust the chosen arbiter.
    function refundUnresolved(uint256 id) external nonReentrant {
        Task storage task = tasks[id];
        require(task.status == Status.Disputed && block.timestamp > task.arbitrationDeadline,
            "Arbitration active");
        _settle(id, Status.Refunded, 0);
    }

    function _settle(uint256 id, Status status, uint256 providerAmount) private {
        Task storage task = tasks[id];
        uint256 clientAmount = task.amount - providerAmount;
        task.status = status;
        totalEscrowed -= task.amount;
        if (providerAmount > 0) token.safeTransfer(task.provider, providerAmount);
        if (clientAmount > 0) token.safeTransfer(task.client, clientAmount);
        emit TaskSettled(id, status, providerAmount, clientAmount);
    }
}
