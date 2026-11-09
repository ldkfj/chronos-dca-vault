// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ICrossProgramInvocation, IHelperProgram, IAggregatorV3} from "../interfaces/IRomePrecompiles.sol";

contract MockHelperPrecompile is IHelperProgram {
    mapping(address => bool) public provisionedPdas;

    function create_pda(address user) external override {
        provisionedPdas[user] = true;
    }

    function create_pda(address user, uint64) external override {
        provisionedPdas[user] = true;
    }

    function create_ata(address, bytes32) external override {}

    function pda(address user) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked("ROME_EXTERNAL_AUTH_PDA", user));
    }

    function pda_with_salt(address user, bytes32 salt) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked("ROME_SALTED_PDA", user, salt));
    }

    function ata(address user, bytes32 mint) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked("ROME_ATA", user, mint));
    }

    function transfer_spl(address, uint64, bytes32) external override {}

    function approve_spl(address, uint64, bytes32) external override {}

    function user_balance(address, bytes32) external pure override returns (uint64) {
        return 100_000_000;
    }
}

contract MockCpiPrecompile is ICrossProgramInvocation {
    bool public shouldFail;
    uint256 public totalInvocations;
    bytes32 public lastProgramId;
    bytes public lastInstructionData;
    uint256 public lastAccountsCount;

    error MockSolanaCpiFailure();

    function setShouldFail(bool _fail) external {
        shouldFail = _fail;
    }

    function invoke(
        bytes32 program_id,
        AccountMeta[] calldata accounts,
        bytes calldata data
    ) external override {
        if (shouldFail) revert MockSolanaCpiFailure();
        if (accounts.length == 0) revert MockSolanaCpiFailure();
        totalInvocations += 1;
        lastProgramId = program_id;
        lastInstructionData = data;
        lastAccountsCount = accounts.length;
    }

    function invoke_signed(
        bytes32 program_id,
        AccountMeta[] calldata accounts,
        bytes calldata data,
        bytes32[] calldata
    ) external override {
        if (shouldFail) revert MockSolanaCpiFailure();
        if (accounts.length == 0) revert MockSolanaCpiFailure();
        totalInvocations += 1;
        lastProgramId = program_id;
        lastInstructionData = data;
        lastAccountsCount = accounts.length;
    }

    function account_lamports(bytes32) external pure override returns (uint64) {
        return 1_000_000_000;
    }

    function account_data_at(bytes32, uint16, uint16 length) external pure override returns (bytes memory) {
        return new bytes(length);
    }
}

contract MockOracleFeed is IAggregatorV3 {
    uint8 public override decimals = 8;
    int256 public price;
    uint80 public roundId = 1;

    constructor(int256 _initialPrice) {
        price = _initialPrice;
    }

    function setPrice(int256 _newPrice) external {
        price = _newPrice;
        roundId += 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }
}
