// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AskPayEscrow} from "../src/AskPayEscrow.sol";
import {IERC3009} from "../src/IERC3009.sol";

/// @notice Deploys AskPayEscrow on Avalanche Fuji. The signer comes from the CLI (`--account
/// askpay-owner`), never from this file or the environment; the signer becomes the contract owner.
///
/// Inputs (addresses and numbers only, no keys):
///   TOKEN          EIP-3009 token (USDC on Fuji, or MockUSDC)
///   PROVIDER       server wallet that sends deposit/settle and receives payment
///   CHECKER        key that signs verdicts; must differ from PROVIDER
///   ANSWER_WINDOW  seconds before a payer may claim a refund (default 600 = 10 minutes, Q-07)
///
/// Afterwards run `node scripts/record-deployment.mjs` to write deployments/fuji.json.
contract Deploy is Script {
    uint256 internal constant FUJI_CHAIN_ID = 43113;

    function run() external returns (AskPayEscrow escrow) {
        require(block.chainid == FUJI_CHAIN_ID, "Deploy: only Avalanche Fuji (43113)");

        address token = vm.envAddress("TOKEN");
        address provider = vm.envAddress("PROVIDER");
        address checker = vm.envAddress("CHECKER");
        uint64 answerWindow = uint64(vm.envOr("ANSWER_WINDOW", uint256(600)));

        console2.log("chainId", block.chainid);
        console2.log("token", token);
        console2.log("provider", provider);
        console2.log("checker", checker);
        console2.log("answerWindow", answerWindow);

        vm.startBroadcast();
        escrow = new AskPayEscrow(IERC3009(token), provider, checker, answerWindow);
        vm.stopBroadcast();

        console2.log("AskPayEscrow", address(escrow));
        console2.log("owner", escrow.owner());
    }
}
