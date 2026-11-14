// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A token that misbehaves on `transfer`, to test how the escrow reacts. It never moves
/// any balance; `receiveWithAuthorization` just accepts so a question can be opened.
contract HostileToken {
    enum Mode {
        Honest,
        ReturnFalse,
        Reenter
    }

    Mode public mode;
    address public target;
    bytes32 public targetQid;
    bool public reentryAttempted;
    bool public reentryBlocked;

    function configure(Mode mode_, address target_, bytes32 qid_) external {
        mode = mode_;
        target = target_;
        targetQid = qid_;
    }

    function receiveWithAuthorization(address, address, uint256, uint256, uint256, bytes32, uint8, bytes32, bytes32)
        external {}

    function transfer(address, uint256) external returns (bool) {
        if (mode == Mode.ReturnFalse) return false;
        if (mode == Mode.Reenter) {
            reentryAttempted = true;
            (bool ok,) = target.call(abi.encodeWithSignature("claimRefund(bytes32)", targetQid));
            reentryBlocked = !ok;
        }
        return true;
    }
}
