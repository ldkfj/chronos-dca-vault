// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IRomePrecompiles
 * @notice Canonical Rome EVM Precompile & Oracle Gateway interfaces.
 *         Verified against Rome TypeScript SDK selectors and Rome EVM dispatch table.
 */
interface ICrossProgramInvocation {
    struct AccountMeta {
        bytes32 pubkey;
        bool is_signer;
        bool is_writable;
    }

    /// @notice Selector: 0x7480cb86 — Invoke a Solana program unsigned or signed by the calling contract's PDA
    function invoke(
        bytes32 program_id,
        AccountMeta[] calldata accounts,
        bytes calldata data
    ) external;

    /// @notice Selector: 0xb94f3733 — Invoke a Solana program with explicit PDA derivation seeds
    function invoke_signed(
        bytes32 program_id,
        AccountMeta[] calldata accounts,
        bytes calldata data,
        bytes32[] calldata seeds
    ) external;

    /// @notice Selector: 0xde79ed54 — Read lamport balance of a Solana account
    function account_lamports(bytes32 pubkey) external view returns (uint64);

    /// @notice Selector: 0x593762e8 — Read slice of Solana account data
    function account_data_at(bytes32 pubkey, uint16 offset, uint16 length) external view returns (bytes memory);
}

interface IHelperProgram {
    /// @notice Selector: 0xff3556ca — Provision the external_auth PDA for an EVM address
    function create_pda(address user) external;

    /// @notice Selector: 0x58e88298 — Provision the external_auth PDA funded with lamports
    function create_pda(address user, uint64 lamports) external;

    /// @notice Selector: 0x3de2251a — Create Associated Token Account for user & SPL mint
    function create_ata(address user, bytes32 mint) external;

    /// @notice Selector: 0x8854a299 — Derive the canonical Rome external_auth PDA for an EVM address
    function pda(address user) external view returns (bytes32);

    /// @notice Selector: 0x5c6d04b3 — Derive salted PDA for an EVM address
    function pda_with_salt(address user, bytes32 salt) external view returns (bytes32);

    /// @notice Selector: 0xfeb1c647 — Derive Associated Token Account for user & SPL mint
    function ata(address user, bytes32 mint) external view returns (bytes32);

    /// @notice Selector: 0x53b505e0 — Transfer SPL tokens from caller's ATA to recipient's ATA
    function transfer_spl(address to, uint64 tokens, bytes32 mint) external;

    /// @notice Selector: 0xabf6f675 — Approve SPL delegate for an ERC20-SPL wrapper or router
    function approve_spl(address spender, uint64 amount, bytes32 mint) external;

    /// @notice Selector: 0xdd0119c8 — Query SPL balance for an EVM account and mint
    function user_balance(address account, bytes32 mint) external view returns (uint64);
}

interface ISystemProgram {
    function program_id() external view returns (bytes32);
    function rome_evm_program_id() external view returns (bytes32);
    function operator() external view returns (bytes32);
    function mint_id() external view returns (bytes32);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
