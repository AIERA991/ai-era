// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DeveloperVesting} from "./DeveloperVesting.sol";

/// @notice AI Era (AERA). Fixed initial supply; no owner, upgrade or mint entrypoint.
contract AIEra is ERC20 {
    uint256 public constant UNIT = 100_000_000;
    uint256 public constant MAX_SUPPLY = 21_000_000 * UNIT;
    uint256 public constant DEVELOPER_ALLOCATION = 1_050_000 * UNIT;
    DeveloperVesting public immutable developerVesting;

    constructor(address community, address ecosystem, address liquidity, address developer)
        ERC20("AI Era", "AERA")
    {
        require(community != address(0) && ecosystem != address(0)
            && liquidity != address(0) && developer != address(0), "Zero recipient");
        require(community != ecosystem && community != liquidity && community != developer
            && ecosystem != liquidity && ecosystem != developer && liquidity != developer,
            "Use distinct recipients");
        developerVesting = new DeveloperVesting(developer, DEVELOPER_ALLOCATION);
        _mint(community, 13_650_000 * UNIT);
        _mint(ecosystem, 4_200_000 * UNIT);
        _mint(liquidity, 2_100_000 * UNIT);
        _mint(address(developerVesting), DEVELOPER_ALLOCATION);
    }

    function decimals() public pure override returns (uint8) { return 8; }
}
