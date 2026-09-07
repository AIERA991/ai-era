// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IInferenceVerifier} from "./AIVerifiedEscrow.sol";

/// @notice Tiny fixed linear-classifier DEMO. Recomputes inference publicly.
/// @dev This is NOT a ZK proof, a trained production model, or private inference.
///      score = 3*x0 - 2*x1 + 7; label = score >= 0. Inputs are signed int64.
contract LinearInferenceVerifier is IInferenceVerifier {
    bytes32 public constant MODEL_HASH = keccak256("AI_ERA_DEMO_LINEAR_V1:int64[2];score=3*x0-2*x1+7;label=score>=0");

    function verify(bytes32 modelHash, bytes32 inputHash, bytes32 outputHash,
        bytes calldata evidence) external pure returns (bool)
    {
        if (modelHash != MODEL_HASH || evidence.length != 64 || keccak256(evidence) != inputHash) return false;
        (int64 x0, int64 x1) = abi.decode(evidence, (int64, int64));
        int256 score = 3 * int256(x0) - 2 * int256(x1) + 7;
        return keccak256(abi.encode(score, score >= 0)) == outputHash;
    }
}
