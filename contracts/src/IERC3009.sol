// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The two token functions AskPayEscrow needs: EIP-3009 `receiveWithAuthorization`
/// (Circle USDC) and `transfer`. `receiveWithAuthorization` only works when the caller is `to`,
/// which is what stops anyone else from front-running the payer's signature.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transfer(address to, uint256 value) external returns (bool);
}
