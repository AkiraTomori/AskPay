// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AskPayEscrow} from "../src/AskPayEscrow.sol";
import {MockUSDC} from "./helpers/MockUSDC.sol";
import {EscrowHandler} from "./helpers/EscrowHandler.sol";

// The five invariants of contracts.md §7 and conventions/contracts.md §3, checked after every
// random sequence of deposit / settle (valid and attacking) / refundByProvider / claimRefund /
// time travel / donation calls driven by EscrowHandler.
contract AskPayEscrowInvariantTest is Test {
    EscrowHandler handler;
    MockUSDC token;
    AskPayEscrow escrow;

    function setUp() public {
        handler = new EscrowHandler();
        token = MockUSDC(handler.tokenAddress());
        escrow = handler.escrowContract();

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.settle.selector;
        selectors[2] = handler.refundByProvider.selector;
        selectors[3] = handler.claim.selector;
        selectors[4] = handler.warp.selector;
        selectors[5] = handler.donate.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // 1. balanceOf(escrow) == sum of amounts of Open questions + donated. Checked twice: against
    // the contract's own records and against the handler's independent ghost totals.
    function invariant_1_escrowBalanceIsOpenQuestionsPlusDonations() public view {
        uint256 openSum;
        for (uint256 i = 0; i < handler.qidCount(); ++i) {
            (, uint96 amount,, AskPayEscrow.Status status) = escrow.questions(handler.qidAt(i));
            if (status == AskPayEscrow.Status.Open) openSum += amount;
        }
        assertEq(token.balanceOf(address(escrow)), openSum + handler.donated(), "vs contract records");
        assertEq(
            token.balanceOf(address(escrow)),
            handler.totalDeposited() - handler.paidOut() - handler.refundedOut() + handler.donated(),
            "vs ghost totals"
        );
    }

    // 2. A question only ever goes None -> Open -> {Paid | Refunded}; never back, never sideways.
    function invariant_2_statusNeverRegresses() public view {
        assertFalse(handler.badTransition(), "illegal status change");
        assertFalse(handler.depositFailed(), "a valid deposit reverted");
    }

    // 3. Money leaves the escrow only to the question's own payer or to the provider.
    function invariant_3_moneyOnlyReachesPayerOrProvider() public view {
        assertEq(token.balanceOf(handler.providerAddress()), handler.paidOut(), "provider balance");
        uint256 payersTotal;
        for (uint256 i = 0; i < handler.payerCount(); ++i) {
            address p = handler.payerAddress(i);
            assertEq(token.balanceOf(p), handler.refundedTo(p), "payer balance == own refunds");
            payersTotal += token.balanceOf(p);
        }
        // Everything minted is held by exactly these three parties: nobody else ever got a cent.
        assertEq(
            token.totalSupply(),
            token.balanceOf(address(escrow)) + token.balanceOf(handler.providerAddress()) + payersTotal,
            "no third recipient"
        );
    }

    // 4. An Open question past its deadline can always be claimed, and never before.
    function invariant_4_openPastDeadlineIsAlwaysClaimable() public view {
        assertFalse(handler.claimFailed(), "claimRefund reverted after the deadline");
        assertFalse(handler.claimedEarly(), "claimRefund succeeded before the deadline");
    }

    // 5. Paid only with the checker's pass=true signature over exactly these citations and valid
    // proofs; the Paid event carries the signed citationsHash.
    function invariant_5_paidNeedsValidVerdictAndProofs() public view {
        assertFalse(handler.paidWithoutValidVerdict(), "Paid or accepted without a valid verdict");
        assertFalse(handler.paidEventMismatch(), "Paid event citationsHash differs from the signed one");
        assertFalse(handler.validSettleFailed(), "a fully valid settle reverted");
    }
}
