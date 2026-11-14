// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {AskPayEscrow} from "../src/AskPayEscrow.sol";
import {IERC3009} from "../src/IERC3009.sol";
import {EscrowFixture} from "./helpers/EscrowFixture.sol";
import {HostileToken} from "./helpers/HostileToken.sol";

// Unit and fuzz tests for contracts.md §7. Invariants live in AskPayEscrow.invariant.t.sol.
contract AskPayEscrowTest is EscrowFixture {
    bytes32 constant QID2 = keccak256("question-2");

    function setUp() public {
        _deploy();
    }

    // ---- helpers ---------------------------------------------------------------------------

    function _settleValid(bytes32 qid, uint256 n) internal {
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(n);
        bytes memory sig = _signVerdict(qid, ANSWER, cs, true, CHECKER_KEY);
        vm.prank(provider);
        escrow.settle(qid, ANSWER, cs, proofs, true, sig);
    }

    function _expectRefund(bytes32 qid, AskPayEscrow.RefundReason reason) internal {
        vm.expectEmit(true, true, false, true);
        emit AskPayEscrow.Refunded(qid, payer, PRICE, reason);
    }

    // =========================================================================================
    // deposit (AP-03)
    // =========================================================================================

    function test_AP03_AC01_depositPullsExactAmount() public {
        (uint256 validBefore, uint8 v, bytes32 r, bytes32 s) = _authorise(QID, PRICE);
        vm.expectEmit(true, true, false, true);
        emit AskPayEscrow.Deposited(QID, payer, PRICE, uint64(block.timestamp) + WINDOW);
        vm.prank(provider);
        escrow.deposit(QID, payer, PRICE, 0, validBefore, v, r, s);

        assertEq(token.balanceOf(address(escrow)), PRICE);
        assertEq(token.balanceOf(payer), 0);
        (address p, uint96 amount, uint64 deadline, AskPayEscrow.Status status) = escrow.questions(QID);
        assertEq(p, payer);
        assertEq(amount, PRICE);
        assertEq(deadline, uint64(block.timestamp) + WINDOW);
        assertEq(uint8(status), uint8(AskPayEscrow.Status.Open));
    }

    function testRevert_AP03_AC02_wrongSignature() public {
        token.mint(payer, PRICE);
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(0xBAD, payer, PRICE, 0, validBefore, QID);
        vm.prank(provider);
        vm.expectRevert("invalid signature");
        escrow.deposit(QID, payer, PRICE, 0, validBefore, v, r, s);
        _assertNothingMoved(QID);
    }

    function testRevert_AP03_AC02_expired() public {
        token.mint(payer, PRICE);
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(PAYER_KEY, payer, PRICE, 0, validBefore, QID);
        vm.warp(validBefore); // validBefore is exclusive
        vm.prank(provider);
        vm.expectRevert("authorization is expired");
        escrow.deposit(QID, payer, PRICE, 0, validBefore, v, r, s);
        _assertNothingMoved(QID);
    }

    function testRevert_AP03_AC02_notYetValid() public {
        token.mint(payer, PRICE);
        uint256 validAfter = block.timestamp + 5 minutes;
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(PAYER_KEY, payer, PRICE, validAfter, validBefore, QID);
        vm.prank(provider);
        vm.expectRevert("authorization is not yet valid");
        escrow.deposit(QID, payer, PRICE, validAfter, validBefore, v, r, s);
        _assertNothingMoved(QID);
    }

    function testRevert_AP03_AC02_wrongNonce() public {
        // Signed for another nonce: the contract passes the qid as nonce, so the digest differs.
        token.mint(payer, PRICE);
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(PAYER_KEY, payer, PRICE, 0, validBefore, QID2);
        vm.prank(provider);
        vm.expectRevert("invalid signature");
        escrow.deposit(QID, payer, PRICE, 0, validBefore, v, r, s);
        _assertNothingMoved(QID);
    }

    function testRevert_AP03_AC02_wrongAmount() public {
        token.mint(payer, PRICE + 1);
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(PAYER_KEY, payer, PRICE, 0, validBefore, QID);
        vm.prank(provider);
        vm.expectRevert("invalid signature");
        escrow.deposit(QID, payer, PRICE + 1, 0, validBefore, v, r, s);
        _assertNothingMoved(QID);
    }

    function testRevert_AP03_AC03_replaySameQid() public {
        _deposit(QID);
        token.mint(payer, PRICE);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionExists.selector, QID));
        escrow.deposit(QID, payer, PRICE, 0, block.timestamp + 1 hours, 27, bytes32(0), bytes32(0));
    }

    function testRevert_AP03_AC03_replaySignatureForAnotherQid() public {
        // A captured authorisation cannot open a second question: the nonce (qid) is in the digest.
        (uint256 validBefore, uint8 v, bytes32 r, bytes32 s) = _authorise(QID, PRICE);
        vm.startPrank(provider);
        escrow.deposit(QID, payer, PRICE, 0, validBefore, v, r, s);
        token.mint(payer, PRICE);
        vm.expectRevert("invalid signature");
        escrow.deposit(QID2, payer, PRICE, 0, validBefore, v, r, s);
        vm.stopPrank();
    }

    function testRevert_AP03_frontrunReceiveByOthers() public {
        // Only the escrow (the `to` address) may redeem the signature, so nobody can front-run it.
        vm.prank(makeAddr("attacker"));
        vm.expectRevert("caller must be the payee");
        token.receiveWithAuthorization(
            payer, address(escrow), PRICE, 0, block.timestamp + 1 hours, QID, 27, bytes32(0), bytes32(0)
        );
    }

    function testRevert_deposit_notProvider() public {
        vm.expectRevert(AskPayEscrow.NotProvider.selector);
        escrow.deposit(QID, payer, PRICE, 0, block.timestamp + 1 hours, 27, bytes32(0), bytes32(0));
    }

    function testRevert_deposit_invalidAmount() public {
        vm.startPrank(provider);
        vm.expectRevert(AskPayEscrow.InvalidAmount.selector);
        escrow.deposit(QID, payer, 0, 0, block.timestamp + 1 hours, 27, bytes32(0), bytes32(0));
        vm.expectRevert(AskPayEscrow.InvalidAmount.selector);
        escrow.deposit(
            QID, payer, uint256(type(uint96).max) + 1, 0, block.timestamp + 1 hours, 27, bytes32(0), bytes32(0)
        );
        vm.stopPrank();
    }

    function _assertNothingMoved(bytes32 qid) internal view {
        assertEq(uint8(_status(qid)), uint8(AskPayEscrow.Status.None));
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // =========================================================================================
    // settle (AP-05)
    // =========================================================================================

    function test_AP05_AC01_validCitationsPayProvider() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(3);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);

        vm.expectEmit(true, true, false, true);
        emit AskPayEscrow.Paid(QID, provider, PRICE, ANSWER, keccak256(abi.encode(cs)));
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);

        assertEq(token.balanceOf(provider), PRICE);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(QID)), uint8(AskPayEscrow.Status.Paid));
    }

    function test_AP05_AC01_paidEventCarriesSignedCitationsHash() public {
        // Five citations: the hash in the event must equal the one TypeScript computed (T-13).
        string memory name = vm.parseJsonString(json, ".citationsCases[2].name");
        assertEq(name, "five-citations");
        bytes32 tsHash = vm.parseJsonBytes32(json, ".citationsCases[2].citationsHash");

        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(5);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        vm.expectEmit(true, true, false, true);
        emit AskPayEscrow.Paid(QID, provider, PRICE, ANSWER, tsHash);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function test_AP05_AC01_settleStillWorksAfterDeadlineIfNobodyClaimed() public {
        _deposit(QID);
        vm.warp(block.timestamp + WINDOW + 1 hours);
        _settleValid(QID, 1);
        assertEq(token.balanceOf(provider), PRICE);
    }

    function test_AP05_AC02_noCitationRefunds() public {
        _deposit(QID);
        AskPayEscrow.Citation[] memory cs = new AskPayEscrow.Citation[](0);
        bytes32[][] memory proofs = new bytes32[][](0);

        _expectRefund(QID, AskPayEscrow.RefundReason.NoCitation);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, false, ""); // no signature needed

        assertEq(token.balanceOf(payer), PRICE);
        assertEq(token.balanceOf(provider), 0);
    }

    function test_AP05_AC03_oneBadProofRefundsAll() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(3);
        proofs[1] = proofs[0]; // the proof of another leaf
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);

        _expectRefund(QID, AskPayEscrow.RefundReason.InvalidCitation);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);

        assertEq(token.balanceOf(payer), PRICE);
        assertEq(token.balanceOf(provider), 0);
    }

    function test_AP05_AC03_unregisteredLawRefunds() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        cs[0].lawId = keccak256("VN-some-other-law");
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);

        _expectRefund(QID, AskPayEscrow.RefundReason.InvalidCitation);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function test_AP05_AC03_alteredTextHashRefunds() public {
        // A Khoản whose text hash is not the registered one cannot be cited, even if signed.
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        cs[0].textHash = keccak256("invented law text");
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);

        _expectRefund(QID, AskPayEscrow.RefundReason.InvalidCitation);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function test_AP05_AC04_checkerRejectRefunds() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(2);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, false, CHECKER_KEY);

        _expectRefund(QID, AskPayEscrow.RefundReason.CheckerRejected);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, false, sig);

        assertEq(token.balanceOf(payer), PRICE);
    }

    function testRevert_AP05_AC05_forgedChecker() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, 0xF04E);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(address(escrow)), PRICE); // the money stays held (AP-05-AC05)
    }

    function testRevert_AP05_AC05_providerSignsOwnVerdict() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, PROVIDER_KEY); // the real provider key
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(address(escrow)), PRICE);
    }

    function testRevert_AP05_AC05_sigForOtherQid() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID2, ANSWER, cs, true, CHECKER_KEY);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_AP05_AC05_sigForOtherAnswer() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, keccak256("another answer"), cs, true, CHECKER_KEY);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_AP05_AC05_passFlippedAfterSign() public {
        // The checker rejected; the provider cannot turn that into a Paid by flipping the flag.
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, false, CHECKER_KEY);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_AP05_AC05_malformedSignature() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, hex"abcdef");
    }

    function testRevert_AP05_AC05_quoteHashChangedAfterSign() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(2);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        cs[0].quoteHash = keccak256("a different quote");
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_AP05_AC05_citationsReordered() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(2);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        (cs[0], cs[1]) = (cs[1], cs[0]);
        (proofs[0], proofs[1]) = (proofs[1], proofs[0]); // proofs stay valid; only the order changed
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_AP05_AC06_settleTwice() public {
        _deposit(QID);
        _settleValid(QID, 1);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(provider), PRICE); // paid once, not twice
    }

    function testRevert_settle_unknownQuestion() public {
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.settle(QID, ANSWER, cs, proofs, true, "");
    }

    function testRevert_settle_notProvider() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        vm.expectRevert(AskPayEscrow.NotProvider.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
    }

    function testRevert_settle_tooManyCitations() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory five, bytes32[][] memory fiveProofs) = _citations(5);
        AskPayEscrow.Citation[] memory six = new AskPayEscrow.Citation[](6);
        bytes32[][] memory sixProofs = new bytes32[][](6);
        for (uint256 i = 0; i < 5; ++i) {
            six[i] = five[i];
            sixProofs[i] = fiveProofs[i];
        }
        six[5] = five[0];
        sixProofs[5] = fiveProofs[0];
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.BadCitations.selector);
        escrow.settle(QID, ANSWER, six, sixProofs, true, "");
    }

    function testRevert_settle_proofsLengthMismatch() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs,) = _citations(2);
        (, bytes32[][] memory one) = _citations(1);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.BadCitations.selector);
        escrow.settle(QID, ANSWER, cs, one, true, "");
    }

    // =========================================================================================
    // refunds (AP-06, AP-04-AC04, §4.2b)
    // =========================================================================================

    function test_AP06_AC01_claimAfterDeadline() public {
        _deposit(QID);
        vm.warp(block.timestamp + WINDOW + 1);
        _expectRefund(QID, AskPayEscrow.RefundReason.Timeout);
        vm.prank(makeAddr("anyone")); // anyone may call; the money still goes to the payer
        escrow.claimRefund(QID);
        assertEq(token.balanceOf(payer), PRICE);
        assertEq(token.balanceOf(makeAddr("anyone")), 0);
    }

    function testRevert_AP06_AC02_claimBeforeDeadline() public {
        _deposit(QID);
        (,, uint64 deadline,) = escrow.questions(QID);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.DeadlineNotReached.selector, QID, deadline));
        escrow.claimRefund(QID);
        vm.warp(deadline); // the deadline itself is still "not reached": strictly after is required
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.DeadlineNotReached.selector, QID, deadline));
        escrow.claimRefund(QID);
    }

    function testRevert_AP06_AC02_claimAfterSettle() public {
        _deposit(QID);
        _settleValid(QID, 1);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.claimRefund(QID);
        assertEq(token.balanceOf(payer), 0);
    }

    function testRevert_settleAfterClaim() public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.claimRefund(QID);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(provider), 0);
    }

    function testRevert_refundByProviderAfterClaim() public {
        _deposit(QID);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.claimRefund(QID);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.refundByProvider(QID);
    }

    function testRevert_claimRefund_unknownQuestion() public {
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID));
        escrow.claimRefund(QID);
    }

    function test_AP04_AC04_refundByProviderBeforeDeadline() public {
        _deposit(QID);
        _expectRefund(QID, AskPayEscrow.RefundReason.AnswerFailed);
        vm.prank(provider);
        escrow.refundByProvider(QID);
        assertEq(token.balanceOf(payer), PRICE);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_AP04_AC04_refundByProviderAfterDeadline() public {
        _deposit(QID);
        vm.warp(block.timestamp + WINDOW + 1 hours);
        _expectRefund(QID, AskPayEscrow.RefundReason.AnswerFailed);
        vm.prank(provider);
        escrow.refundByProvider(QID);
        assertEq(token.balanceOf(payer), PRICE);
    }

    function testRevert_refundByProvider_notProvider() public {
        _deposit(QID);
        vm.expectRevert(AskPayEscrow.NotProvider.selector);
        escrow.refundByProvider(QID);
        vm.prank(payer); // not even the payer
        vm.expectRevert(AskPayEscrow.NotProvider.selector);
        escrow.refundByProvider(QID);
    }

    function testRevert_refundByProvider_notOpen() public {
        vm.startPrank(provider);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID)); // never opened
        escrow.refundByProvider(QID);
        vm.stopPrank();

        _deposit(QID2);
        vm.startPrank(provider);
        escrow.refundByProvider(QID2);
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.QuestionNotOpen.selector, QID2)); // twice
        escrow.refundByProvider(QID2);
        vm.stopPrank();
    }

    // =========================================================================================
    // configuration and roles
    // =========================================================================================

    function test_setLawRoot_registersAndEmits() public {
        bytes32 newLaw = keccak256("VN-another-law");
        bytes32 root = keccak256("root");
        vm.expectEmit(true, false, false, true);
        emit AskPayEscrow.LawRootSet(newLaw, root);
        escrow.setLawRoot(newLaw, root);
        assertEq(escrow.lawRoot(newLaw), root);
    }

    function testRevert_setLawRoot_cannotOverwrite() public {
        vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.LawRootAlreadySet.selector, lawId));
        escrow.setLawRoot(lawId, keccak256("other root"));
    }

    function testRevert_setLawRoot_zeroRoot() public {
        vm.expectRevert(AskPayEscrow.InvalidLawRoot.selector);
        escrow.setLawRoot(keccak256("VN-x"), bytes32(0));
    }

    function testRevert_ownerOnly() public {
        address stranger = makeAddr("stranger");
        bytes memory denied = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(denied);
        escrow.setLawRoot(keccak256("VN-x"), keccak256("r"));
        vm.expectRevert(denied);
        escrow.setProvider(stranger);
        vm.expectRevert(denied);
        escrow.setChecker(stranger);
        vm.expectRevert(denied);
        escrow.setAnswerWindow(1 hours);
        vm.stopPrank();
    }

    function testRevert_ownerCannotWithdrawEscrowedMoney() public {
        // There is no such function; the owner (this contract) has no path to the money (P1).
        _deposit(QID);
        (bool ok,) = address(escrow).call(abi.encodeWithSignature("withdraw(address,uint256)", address(this), PRICE));
        assertFalse(ok);
        assertEq(token.balanceOf(address(this)), 0);
    }

    function test_setProviderAndChecker() public {
        address newProvider = makeAddr("newProvider");
        address newChecker = makeAddr("newChecker");
        vm.expectEmit(false, false, false, true);
        emit AskPayEscrow.ProviderSet(newProvider);
        escrow.setProvider(newProvider);
        vm.expectEmit(false, false, false, true);
        emit AskPayEscrow.CheckerSet(newChecker);
        escrow.setChecker(newChecker);
        assertEq(escrow.provider(), newProvider);
        assertEq(escrow.checker(), newChecker);
    }

    function testRevert_rolesMustStayDistinctAndNonZero() public {
        vm.expectRevert(AskPayEscrow.CheckerIsProvider.selector);
        escrow.setChecker(provider);
        vm.expectRevert(AskPayEscrow.CheckerIsProvider.selector);
        escrow.setProvider(checker);
        vm.expectRevert(AskPayEscrow.ZeroAddress.selector);
        escrow.setChecker(address(0));
        vm.expectRevert(AskPayEscrow.ZeroAddress.selector);
        escrow.setProvider(address(0));
    }

    function testRevert_constructor() public {
        IERC3009 t = IERC3009(address(token));
        vm.expectRevert(AskPayEscrow.CheckerIsProvider.selector);
        new AskPayEscrow(t, provider, provider, WINDOW);
        vm.expectRevert(AskPayEscrow.ZeroAddress.selector);
        new AskPayEscrow(IERC3009(address(0)), provider, checker, WINDOW);
        vm.expectRevert(AskPayEscrow.ZeroAddress.selector);
        new AskPayEscrow(t, address(0), checker, WINDOW);
        vm.expectRevert(AskPayEscrow.InvalidAnswerWindow.selector);
        new AskPayEscrow(t, provider, checker, 0);
    }

    function test_setAnswerWindow_onlyAffectsNewQuestions() public {
        _deposit(QID);
        (,, uint64 oldDeadline,) = escrow.questions(QID);
        escrow.setAnswerWindow(1 hours);
        _deposit(QID2);
        (,, uint64 newDeadline,) = escrow.questions(QID2);
        (,, uint64 stillOld,) = escrow.questions(QID);
        assertEq(stillOld, oldDeadline);
        assertEq(newDeadline, uint64(block.timestamp) + 1 hours);
    }

    function testRevert_setAnswerWindow_zero() public {
        vm.expectRevert(AskPayEscrow.InvalidAnswerWindow.selector);
        escrow.setAnswerWindow(0);
    }

    // =========================================================================================
    // hostile token
    // =========================================================================================

    function _hostileEscrow(HostileToken.Mode mode) internal returns (AskPayEscrow e, HostileToken h) {
        h = new HostileToken();
        e = new AskPayEscrow(IERC3009(address(h)), provider, checker, WINDOW);
        h.configure(mode, address(e), QID);
        vm.prank(provider);
        e.deposit(QID, payer, PRICE, 0, block.timestamp + 1 hours, 27, bytes32(0), bytes32(0));
    }

    function testRevert_transferReturningFalseIsNotIgnored() public {
        (AskPayEscrow e,) = _hostileEscrow(HostileToken.Mode.ReturnFalse);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.TransferFailed.selector);
        e.refundByProvider(QID);
        // The revert rolls the status back, so the question is still refundable later.
        (,,, AskPayEscrow.Status status) = e.questions(QID);
        assertEq(uint8(status), uint8(AskPayEscrow.Status.Open));
    }

    function test_reentrancyDuringTransferIsBlocked() public {
        (AskPayEscrow e, HostileToken h) = _hostileEscrow(HostileToken.Mode.Reenter);
        vm.warp(block.timestamp + WINDOW + 1);
        e.claimRefund(QID);
        assertTrue(h.reentryAttempted());
        assertTrue(h.reentryBlocked());
        (,,, AskPayEscrow.Status status) = e.questions(QID);
        assertEq(uint8(status), uint8(AskPayEscrow.Status.Refunded));
    }

    // =========================================================================================
    // cross-language fixture (C2)
    // =========================================================================================

    function test_leafMatchesTypeScriptFixture() public view {
        assertEq(lawId, keccak256(bytes(vm.parseJsonString(json, ".lawLabel"))));
        bytes32 root = vm.parseJsonBytes32(json, ".root");
        for (uint256 i = 0; i < 5; ++i) {
            // Recomputing textHash from the raw string is the real UTF-8 cross-check.
            bytes32 textHash = keccak256(bytes(vm.parseJsonString(json, _entry(i, "text"))));
            assertEq(textHash, vm.parseJsonBytes32(json, _entry(i, "textHash")));
            assertEq(
                keccak256(bytes(vm.parseJsonString(json, _entry(i, "quote")))),
                vm.parseJsonBytes32(json, _entry(i, "quoteHash"))
            );

            (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(i + 1);
            bytes32 leaf = escrow.leafOf(cs[i]);
            assertEq(leaf, vm.parseJsonBytes32(json, _entry(i, "leaf")));
            assertTrue(MerkleProof.verify(proofs[i], root, leaf));
        }
    }

    function test_leafIgnoresQuoteHash() public view {
        (AskPayEscrow.Citation[] memory cs,) = _citations(1);
        bytes32 before_ = escrow.leafOf(cs[0]);
        cs[0].quoteHash = keccak256("anything");
        assertEq(escrow.leafOf(cs[0]), before_);
    }

    function test_citationsHashMatchesTypeScriptFixture() public view {
        for (uint256 c = 0; c < 4; ++c) {
            string memory base = string.concat(".citationsCases[", vm.toString(c), "]");
            uint256 n = 0;
            while (vm.keyExistsJson(json, string.concat(base, ".citations[", vm.toString(n), "]"))) {
                ++n;
            }
            AskPayEscrow.Citation[] memory cs = new AskPayEscrow.Citation[](n);
            for (uint256 j = 0; j < n; ++j) {
                string memory item = string.concat(base, ".citations[", vm.toString(j), "]");
                cs[j] = AskPayEscrow.Citation({
                    lawId: vm.parseJsonBytes32(json, string.concat(item, ".lawId")),
                    dieu: uint16(vm.parseJsonUint(json, string.concat(item, ".dieu"))),
                    khoan: uint16(vm.parseJsonUint(json, string.concat(item, ".khoan"))),
                    textHash: vm.parseJsonBytes32(json, string.concat(item, ".textHash")),
                    quoteHash: vm.parseJsonBytes32(json, string.concat(item, ".quoteHash"))
                });
            }
            assertEq(escrow.citationsHashOf(cs), vm.parseJsonBytes32(json, string.concat(base, ".citationsHash")));
        }
    }

    // =========================================================================================
    // fuzz
    // =========================================================================================

    function testFuzz_amountAndTime(uint96 amount, uint32 elapsed) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        _deposit(QID, amount);
        (,, uint64 deadline,) = escrow.questions(QID);

        vm.warp(block.timestamp + elapsed);
        if (block.timestamp > deadline) {
            escrow.claimRefund(QID);
            assertEq(token.balanceOf(payer), amount);
        } else {
            vm.expectRevert(abi.encodeWithSelector(AskPayEscrow.DeadlineNotReached.selector, QID, deadline));
            escrow.claimRefund(QID);
            vm.prank(provider);
            escrow.refundByProvider(QID); // allowed before the deadline too
            assertEq(token.balanceOf(payer), amount);
        }
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_settlePaysExactlyDepositedAmount(uint96 amount, uint8 n) public {
        amount = uint96(bound(amount, 1, type(uint96).max));
        n = uint8(bound(n, 1, 5));
        _deposit(QID, amount);
        _settleValid(QID, n);
        assertEq(token.balanceOf(provider), amount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_randomProofNeverPays(bytes32[] calldata proof) public {
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        vm.assume(keccak256(abi.encode(proof)) != keccak256(abi.encode(proofs[0])));
        proofs[0] = proof;
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, CHECKER_KEY);

        _expectRefund(QID, AskPayEscrow.RefundReason.InvalidCitation);
        vm.prank(provider);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(provider), 0);
    }

    function testFuzz_anyOtherKeyCannotSign(uint256 key) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(vm.addr(key) != checker);
        _deposit(QID);
        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(1);
        bytes memory sig = _signVerdict(QID, ANSWER, cs, true, key);
        vm.prank(provider);
        vm.expectRevert(AskPayEscrow.InvalidCheckerSignature.selector);
        escrow.settle(QID, ANSWER, cs, proofs, true, sig);
        assertEq(token.balanceOf(address(escrow)), PRICE);
    }
}
