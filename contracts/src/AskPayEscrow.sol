// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC3009} from "./IERC3009.sol";

/// @title AskPayEscrow
/// @notice Holds a payer's USDC for one question. The money is released to the provider only when
/// every citation proves against a registered law root and the checker signed `pass = true`;
/// otherwise it goes back to the payer. Nobody, owner included, can take escrowed money anywhere
/// else (P1): there is no withdraw and no recipient parameter. Spec: docs/architecture/contracts.md.
contract AskPayEscrow is Ownable, ReentrancyGuard, EIP712 {
    enum Status {
        None,
        Open,
        Paid,
        Refunded
    }

    enum RefundReason {
        None,
        NoCitation,
        InvalidCitation,
        CheckerRejected,
        AnswerFailed,
        Timeout
    }

    struct Question {
        address payer;
        uint96 amount; // smallest token unit (USDC: 6 decimals)
        uint64 deadline; // unix seconds; after this anyone may claimRefund
        Status status;
    }

    struct Citation {
        bytes32 lawId;
        uint16 dieu;
        uint16 khoan; // 0 when the Điều has no Khoản
        bytes32 textHash; // keccak256(bytes(normalised Khoản text))
        bytes32 quoteHash; // keccak256(bytes(normalised quote)); NOT part of the leaf
    }

    bytes32 public constant VERDICT_TYPEHASH =
        keccak256("Verdict(bytes32 qid,bytes32 answerHash,bytes32 citationsHash,bool pass)");
    uint8 public constant MAX_CITATIONS = 5;

    IERC3009 public immutable token;
    address public provider;
    address public checker;
    uint64 public answerWindow;
    mapping(bytes32 lawId => bytes32 root) public lawRoot;
    mapping(bytes32 qid => Question) public questions;

    event LawRootSet(bytes32 indexed lawId, bytes32 root);
    event Deposited(bytes32 indexed qid, address indexed payer, uint256 amount, uint64 deadline);
    event Paid(
        bytes32 indexed qid, address indexed provider, uint256 amount, bytes32 answerHash, bytes32 citationsHash
    );
    event Refunded(bytes32 indexed qid, address indexed payer, uint256 amount, RefundReason reason);
    event ProviderSet(address provider);
    event CheckerSet(address checker);
    event AnswerWindowSet(uint64 answerWindow);

    error NotProvider();
    error QuestionExists(bytes32 qid);
    error QuestionNotOpen(bytes32 qid);
    error InvalidAmount();
    error BadCitations();
    error InvalidCheckerSignature();
    error DeadlineNotReached(bytes32 qid, uint64 deadline);
    error ZeroAddress();
    error CheckerIsProvider();
    error InvalidAnswerWindow();
    error LawRootAlreadySet(bytes32 lawId);
    error InvalidLawRoot();
    error TransferFailed();

    modifier onlyProvider() {
        if (msg.sender != provider) revert NotProvider();
        _;
    }

    /// @param token_ EIP-3009 token (USDC on Fuji, or MockUSDC).
    /// @param provider_ Server wallet: sends deposit/settle, receives payment.
    /// @param checker_ Key that signs verdicts off-chain. Must differ from the provider.
    /// @param answerWindow_ Seconds a question stays Open before the payer may claim a refund.
    constructor(IERC3009 token_, address provider_, address checker_, uint64 answerWindow_)
        Ownable(msg.sender)
        EIP712("AskPayEscrow", "1")
    {
        if (address(token_) == address(0)) revert ZeroAddress();
        _checkRoles(provider_, checker_);
        if (answerWindow_ == 0) revert InvalidAnswerWindow();
        token = token_;
        provider = provider_;
        checker = checker_;
        answerWindow = answerWindow_;
        emit ProviderSet(provider_);
        emit CheckerSet(checker_);
        emit AnswerWindowSet(answerWindow_);
    }

    // ---------------------------------------------------------------------------------------
    // Owner configuration
    // ---------------------------------------------------------------------------------------

    /// @notice Registers the Merkle root of a law text. A lawId is registered once; a new version
    /// of the law gets a new lawId.
    function setLawRoot(bytes32 lawId, bytes32 root) external onlyOwner {
        if (root == bytes32(0)) revert InvalidLawRoot();
        if (lawRoot[lawId] != bytes32(0)) revert LawRootAlreadySet(lawId);
        lawRoot[lawId] = root;
        emit LawRootSet(lawId, root);
    }

    /// @notice Replaces the provider wallet.
    function setProvider(address provider_) external onlyOwner {
        _checkRoles(provider_, checker);
        provider = provider_;
        emit ProviderSet(provider_);
    }

    /// @notice Replaces the checker key. Must differ from the provider.
    function setChecker(address checker_) external onlyOwner {
        _checkRoles(provider, checker_);
        checker = checker_;
        emit CheckerSet(checker_);
    }

    /// @notice Changes the answer window for questions deposited from now on.
    function setAnswerWindow(uint64 answerWindow_) external onlyOwner {
        if (answerWindow_ == 0) revert InvalidAnswerWindow();
        answerWindow = answerWindow_;
        emit AnswerWindowSet(answerWindow_);
    }

    // ---------------------------------------------------------------------------------------
    // Money in
    // ---------------------------------------------------------------------------------------

    /// @notice Pulls `amount` from `payer` with their EIP-3009 authorisation and opens the
    /// question. The authorisation nonce is the qid, so a signature is bound to one question.
    function deposit(
        bytes32 qid,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant onlyProvider {
        if (questions[qid].status != Status.None) revert QuestionExists(qid);
        if (amount == 0 || amount > type(uint96).max) revert InvalidAmount();

        // The token is trusted (USDC), so the external call may precede the write.
        token.receiveWithAuthorization(payer, address(this), amount, validAfter, validBefore, qid, v, r, s);

        uint64 deadline = uint64(block.timestamp) + answerWindow;
        questions[qid] = Question({payer: payer, amount: uint96(amount), deadline: deadline, status: Status.Open});
        emit Deposited(qid, payer, amount, deadline);
    }

    // ---------------------------------------------------------------------------------------
    // Money out
    // ---------------------------------------------------------------------------------------

    /// @notice Settles a question. Pays the provider only if all citations prove against the law
    /// root, the checker signed `pass = true` over exactly these citations, and the list is not
    /// empty. Otherwise refunds the payer. A bad checker signature reverts and keeps the money.
    function settle(
        bytes32 qid,
        bytes32 answerHash,
        Citation[] calldata citations,
        bytes32[][] calldata proofs,
        bool pass,
        bytes calldata checkerSig
    ) external nonReentrant onlyProvider {
        Question storage q = questions[qid];
        if (q.status != Status.Open) revert QuestionNotOpen(qid);
        if (citations.length > MAX_CITATIONS || proofs.length != citations.length) {
            revert BadCitations();
        }
        if (citations.length == 0) {
            _refund(qid, q, RefundReason.NoCitation);
            return;
        }

        bytes32 citationsHash = keccak256(abi.encode(citations));
        _checkVerdict(qid, answerHash, citationsHash, pass, checkerSig);

        if (!_proofsValid(citations, proofs)) {
            _refund(qid, q, RefundReason.InvalidCitation);
            return;
        }
        if (!pass) {
            _refund(qid, q, RefundReason.CheckerRejected);
            return;
        }

        uint256 amount = q.amount;
        q.status = Status.Paid;
        _send(provider, amount);
        emit Paid(qid, provider, amount, answerHash, citationsHash);
    }

    /// @notice Provider returns the money itself for every server-side failure (LLM or checker
    /// error, failed settle, nearly out of time). Allowed before and after the deadline.
    function refundByProvider(bytes32 qid) external nonReentrant onlyProvider {
        Question storage q = questions[qid];
        if (q.status != Status.Open) revert QuestionNotOpen(qid);
        _refund(qid, q, RefundReason.AnswerFailed);
    }

    /// @notice After the deadline anyone may return an unsettled question's money to its payer.
    function claimRefund(bytes32 qid) external nonReentrant {
        Question storage q = questions[qid];
        if (q.status != Status.Open) revert QuestionNotOpen(qid);
        if (block.timestamp <= q.deadline) revert DeadlineNotReached(qid, q.deadline);
        _refund(qid, q, RefundReason.Timeout);
    }

    // ---------------------------------------------------------------------------------------
    // Views shared with TypeScript (packages/shared) and tests
    // ---------------------------------------------------------------------------------------

    /// @notice EIP-712 digest the checker signs.
    function verdictDigest(bytes32 qid, bytes32 answerHash, bytes32 citationsHash, bool pass)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VERDICT_TYPEHASH, qid, answerHash, citationsHash, pass)));
    }

    /// @notice keccak256(abi.encode(citations)); same bytes as `citationsHash()` in packages/shared.
    function citationsHashOf(Citation[] calldata citations) external pure returns (bytes32) {
        return keccak256(abi.encode(citations));
    }

    /// @notice StandardMerkleTree leaf: the quote is deliberately not part of it.
    function leafOf(Citation calldata c) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(c.lawId, c.dieu, c.khoan, c.textHash))));
    }

    // ---------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------

    function _refund(bytes32 qid, Question storage q, RefundReason reason) private {
        address payer = q.payer;
        uint256 amount = q.amount;
        q.status = Status.Refunded; // effects before the transfer
        _send(payer, amount);
        emit Refunded(qid, payer, amount, reason);
    }

    // Reverts unless `checkerSig` is the checker's signature over exactly this verdict.
    function _checkVerdict(bytes32 qid, bytes32 answerHash, bytes32 citationsHash, bool pass, bytes calldata checkerSig)
        private
        view
    {
        bytes32 digest = verdictDigest(qid, answerHash, citationsHash, pass);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, checkerSig);
        if (err != ECDSA.RecoverError.NoError || signer != checker) {
            revert InvalidCheckerSignature();
        }
    }

    // True only if every citation's law is registered and its leaf proves against that root.
    function _proofsValid(Citation[] calldata citations, bytes32[][] calldata proofs) private view returns (bool) {
        for (uint256 i = 0; i < citations.length; ++i) {
            bytes32 root = lawRoot[citations[i].lawId];
            if (root == bytes32(0)) return false;
            if (!MerkleProof.verifyCalldata(proofs[i], root, leafOf(citations[i]))) return false;
        }
        return true;
    }

    function _send(address to, uint256 amount) private {
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _checkRoles(address provider_, address checker_) private pure {
        if (provider_ == address(0) || checker_ == address(0)) revert ZeroAddress();
        if (provider_ == checker_) revert CheckerIsProvider();
    }
}
