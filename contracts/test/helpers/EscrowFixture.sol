// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AskPayEscrow} from "../../src/AskPayEscrow.sol";
import {IERC3009} from "../../src/IERC3009.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice Shared setup for the unit, fuzz and invariant suites: a deployed escrow with the real
/// law root from the fixture that `npm run corpus` generates, plus signing helpers.
abstract contract EscrowFixture is Test {
    string internal constant FIXTURE = "../packages/corpus/data/blld-2019.foundry-vectors.json";
    uint256 internal constant PAYER_KEY = 0xA11CE;
    uint256 internal constant CHECKER_KEY = 0xC0FFEE;
    uint256 internal constant PROVIDER_KEY = 0xB0B;
    uint64 internal constant WINDOW = 10 minutes;
    uint256 internal constant PRICE = 50_000; // 0.05 USDC
    bytes32 internal constant QID = keccak256("question-1");
    bytes32 internal constant ANSWER = keccak256("answer-1");

    MockUSDC internal token;
    AskPayEscrow internal escrow;
    // Addresses derive from the keys so a test can sign "as the provider" for real.
    address internal provider = vm.addr(PROVIDER_KEY);
    address internal payer = vm.addr(PAYER_KEY);
    address internal checker = vm.addr(CHECKER_KEY);

    string internal json;
    bytes32 internal lawId;

    function _deploy() internal {
        vm.warp(1_700_000_000);
        token = new MockUSDC();
        escrow = new AskPayEscrow(IERC3009(address(token)), provider, checker, WINDOW);
        json = vm.readFile(FIXTURE);
        lawId = vm.parseJsonBytes32(json, ".lawId");
        escrow.setLawRoot(lawId, vm.parseJsonBytes32(json, ".root"));
    }

    // ---- EIP-3009 --------------------------------------------------------------------------

    function _signAuth(uint256 key, address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        from,
                        address(escrow),
                        value,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
        (v, r, s) = vm.sign(key, digest);
    }

    // Mints `amount` to the payer and returns their signed authorisation for `qid`.
    function _authorise(bytes32 qid, uint256 amount)
        internal
        returns (uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
    {
        token.mint(payer, amount);
        validBefore = block.timestamp + 1 hours;
        (v, r, s) = _signAuth(PAYER_KEY, payer, amount, 0, validBefore, qid);
    }

    function _deposit(bytes32 qid, uint256 amount) internal {
        (uint256 validBefore, uint8 v, bytes32 r, bytes32 s) = _authorise(qid, amount);
        vm.prank(provider);
        escrow.deposit(qid, payer, amount, 0, validBefore, v, r, s);
    }

    function _deposit(bytes32 qid) internal {
        _deposit(qid, PRICE);
    }

    // ---- fixture citations -----------------------------------------------------------------

    function _entry(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".entries[", vm.toString(i), "].", field);
    }

    // The first `n` (<= 5) real corpus entries with their Merkle proofs.
    function _citations(uint256 n)
        internal
        view
        returns (AskPayEscrow.Citation[] memory cs, bytes32[][] memory proofs)
    {
        cs = new AskPayEscrow.Citation[](n);
        proofs = new bytes32[][](n);
        for (uint256 i = 0; i < n; ++i) {
            cs[i] = AskPayEscrow.Citation({
                lawId: lawId,
                dieu: uint16(vm.parseJsonUint(json, _entry(i, "dieu"))),
                khoan: uint16(vm.parseJsonUint(json, _entry(i, "khoan"))),
                textHash: vm.parseJsonBytes32(json, _entry(i, "textHash")),
                quoteHash: vm.parseJsonBytes32(json, _entry(i, "quoteHash"))
            });
            proofs[i] = vm.parseJsonBytes32Array(json, _entry(i, "proof"));
        }
    }

    // ---- verdicts --------------------------------------------------------------------------

    // The signature the checker would produce. The hash is computed here with abi.encode, not by
    // the contract, so a bug in `citationsHashOf` cannot hide behind itself.
    function _signVerdict(bytes32 qid, bytes32 answerHash, AskPayEscrow.Citation[] memory cs, bool pass, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.verdictDigest(qid, answerHash, keccak256(abi.encode(cs)), pass);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _status(bytes32 qid) internal view returns (AskPayEscrow.Status status) {
        (,,, status) = escrow.questions(qid);
    }
}
