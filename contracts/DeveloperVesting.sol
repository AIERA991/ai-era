// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice One-year lock, then four years of linear vesting; years = 365 days.
/// @dev Only the original allocation vests. Beneficiary cannot be changed.
contract DeveloperVesting {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable allocation;
    uint256 public immutable cliff;
    uint256 public immutable end;
    uint256 public released;
    event Released(uint256 amount);

    constructor(address beneficiary_, uint256 allocation_) {
        require(beneficiary_ != address(0), "Zero beneficiary");
        token = IERC20(msg.sender); // Created and funded atomically by AIEra.
        beneficiary = beneficiary_;
        allocation = allocation_;
        cliff = block.timestamp + 365 days;
        end = cliff + 4 * 365 days;
    }

    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        if (timestamp <= cliff) return 0;
        if (timestamp >= end) return allocation;
        return allocation * (timestamp - cliff) / (end - cliff);
    }

    function releasable() public view returns (uint256) {
        return vestedAmount(block.timestamp) - released;
    }

    /// @notice Anyone can trigger release, but funds only go to beneficiary.
    function release() external {
        uint256 amount = releasable();
        require(amount > 0, "Nothing vested");
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit Released(amount);
    }
}
