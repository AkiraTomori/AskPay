// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AskPayEscrow} from "../../src/AskPayEscrow.sol";
import {EscrowFixture} from "./EscrowFixture.sol";

/// @notice Random-call driver for the invariant suite. Every action keeps independent "ghost"
/// totals, so an accounting bug in the contract shows up as a mismatch instead of agreeing with
/// itself. Violations the handler can only see during a call are recorded as flags.
contract EscrowHandler is EscrowFixture {
    uint256 internal constant PAYER_COUNT = 3;
    uint256 internal constant MODES = 7;

    bytes32[] internal qids;
    uint256 internal nextId;
    mapping(bytes32 qid => address) public payerOf;
    mapping(bytes32 qid => uint256) public amountOf;
    mapping(bytes32 qid => AskPayEscrow.Status) internal seen;

    uint256 public totalDeposited;
    uint256 public paidOut;
    uint256 public refundedOut;
    uint256 public donated;
    mapping(address payer => uint256) public refundedTo;

    // Invariant 2: only None -> Open -> {Paid | Refunded}.
    bool public badTransition;
    // Invariant 4: an Open question past its deadline could not be claimed.
    bool public claimFailed;
    // A claim succeeded although the deadline had not passed.
    bool public claimedEarly;
    // Invariant 5: Paid although the verdict, signature or proofs were not all valid.
    bool public paidWithoutValidVerdict;
    // Invariant 5: the Paid event carried a citationsHash other than the one the checker signed.
    bool public paidEventMismatch;
    // A fully valid settle of an Open question reverted (liveness).
    bool public validSettleFailed;
    // A deposit with a valid authorisation reverted.
    bool public depositFailed;

    constructor() {
        _deploy();
    }

    // ---- views for the invariant suite -----------------------------------------------------

    function qidCount() external view returns (uint256) {
        return qids.length;
    }

    function qidAt(uint256 i) external view returns (bytes32) {
        return qids[i];
    }

    function payerAddress(uint256 i) public pure returns (address) {
        return vm.addr(PAYER_KEY + i);
    }

    function payerCount() external pure returns (uint256) {
        return PAYER_COUNT;
    }

    function tokenAddress() external view returns (address) {
        return address(token);
    }

    function escrowContract() external view returns (AskPayEscrow) {
        return escrow;
    }

    function providerAddress() external view returns (address) {
        return provider;
    }

    // ---- actions ---------------------------------------------------------------------------

    function deposit(uint256 payerSeed, uint256 amountSeed) external {
        uint256 key = PAYER_KEY + (payerSeed % PAYER_COUNT);
        address from = vm.addr(key);
        uint256 amount = bound(amountSeed, 1, 1e12);
        bytes32 qid = keccak256(abi.encode("q", nextId++));

        token.mint(from, amount); // exactly the amount, so a payer's balance is only refunds
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(key, from, amount, 0, validBefore, qid);
        vm.prank(provider);
        try escrow.deposit(qid, from, amount, 0, validBefore, v, r, s) {
            qids.push(qid);
            payerOf[qid] = from;
            amountOf[qid] = amount;
            seen[qid] = AskPayEscrow.Status.Open;
            totalDeposited += amount;
        } catch {
            depositFailed = true;
        }
    }

    // Modes: 0 valid, 1 no citations, 2 bad proof, 3 checker says no, 4 provider signs,
    // 5 signature for another qid, 6 quote changed after signing.
    function settle(uint256 idxSeed, uint256 modeSeed, uint256 nSeed) external {
        if (qids.length == 0) return;
        bytes32 qid = qids[idxSeed % qids.length];
        uint256 mode = modeSeed % MODES;
        bytes32 answer = keccak256(abi.encode("a", qid));

        (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs) = _citations(bound(nSeed, 1, 5));
        bool pass = mode != 3;
        uint256 signer = CHECKER_KEY;
        bytes32 signedQid = qid;
        if (mode == 1) {
            cs = new AskPayEscrow.Citation[](0);
            proofs = new bytes32[][](0);
        } else if (mode == 2) {
            proofs[0] = new bytes32[](1);
            proofs[0][0] = keccak256("garbage proof");
        } else if (mode == 4) {
            signer = PROVIDER_KEY;
        } else if (mode == 5) {
            signedQid = keccak256("some other qid");
        }
        bytes memory sig = mode == 1 ? bytes("") : _signVerdict(signedQid, answer, cs, pass, signer);
        bytes32 signedHash = keccak256(abi.encode(cs));
        if (mode == 6) cs[0].quoteHash = keccak256("changed after signing");

        bool wasOpen = _status(qid) == AskPayEscrow.Status.Open;
        vm.recordLogs();
        vm.prank(provider);
        bool ok;
        try escrow.settle(qid, answer, cs, proofs, pass, sig) {
            ok = true;
        } catch {}
        Vm.Log[] memory logs = vm.getRecordedLogs();

        if (wasOpen && mode == 0 && !ok) validSettleFailed = true;
        // Modes 4-6 must always revert (AP-05-AC05).
        if (ok && mode >= 4) paidWithoutValidVerdict = true;
        if (ok && wasOpen && _status(qid) == AskPayEscrow.Status.Paid) {
            if (mode != 0) paidWithoutValidVerdict = true;
            else if (!_paidEventMatches(logs, qid, answer, signedHash)) paidEventMismatch = true;
        }
        _sync();
    }

    function refundByProvider(uint256 idxSeed) external {
        if (qids.length == 0) return;
        vm.prank(provider);
        try escrow.refundByProvider(qids[idxSeed % qids.length]) {} catch {}
        _sync();
    }

    function claim(uint256 idxSeed) external {
        if (qids.length == 0) return;
        bytes32 qid = qids[idxSeed % qids.length];
        (,, uint64 deadline, AskPayEscrow.Status status) = escrow.questions(qid);
        bool claimable = status == AskPayEscrow.Status.Open && block.timestamp > deadline;
        vm.prank(address(uint160(bound(idxSeed, 1, 1000)))); // anyone at all
        try escrow.claimRefund(qid) {
            if (!claimable) claimedEarly = true;
        } catch {
            if (claimable) claimFailed = true;
        }
        _sync();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 hours));
    }

    // Anyone can send tokens straight to the contract; that surplus belongs to no question.
    function donate(uint256 amount) external {
        amount = bound(amount, 1, 1e9);
        token.mint(address(this), amount);
        token.transfer(address(escrow), amount);
        donated += amount;
    }

    // ---- bookkeeping -----------------------------------------------------------------------

    // Compares every known question with what we saw last and books money movements. The only
    // legal change is Open -> Paid or Open -> Refunded.
    function _sync() internal {
        for (uint256 i = 0; i < qids.length; ++i) {
            bytes32 qid = qids[i];
            AskPayEscrow.Status now_ = _status(qid);
            AskPayEscrow.Status prev = seen[qid];
            if (now_ == prev) continue;
            if (prev != AskPayEscrow.Status.Open) badTransition = true;
            if (now_ == AskPayEscrow.Status.Paid) {
                paidOut += amountOf[qid];
            } else if (now_ == AskPayEscrow.Status.Refunded) {
                refundedOut += amountOf[qid];
                refundedTo[payerOf[qid]] += amountOf[qid];
            } else {
                badTransition = true;
            }
            seen[qid] = now_;
        }
    }

    function _paidEventMatches(Vm.Log[] memory logs, bytes32 qid, bytes32 answer, bytes32 signedHash)
        internal
        view
        returns (bool)
    {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(escrow)) continue;
            if (logs[i].topics[0] != AskPayEscrow.Paid.selector) continue;
            if (logs[i].topics[1] != qid) return false;
            (, bytes32 answerHash, bytes32 citationsHash) = abi.decode(logs[i].data, (uint256, bytes32, bytes32));
            return answerHash == answer && citationsHash == signedHash;
        }
        return false;
    }
}
