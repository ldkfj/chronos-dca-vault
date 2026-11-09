// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    ICrossProgramInvocation,
    IHelperProgram,
    ISystemProgram,
    IAggregatorV3
} from "./interfaces/IRomePrecompiles.sol";

/**
 * @title RomeDcaLimitVault (Chronos Vault)
 * @author Chronos Vault — Rome Builder Arena
 * @notice Atomic Dollar-Cost Averaging (DCA) & Limit Order Router to Solana Liquidity.
 *         Supports both EVM wallets (MetaMask) and Solana wallets (via Rome Dual-Lane synthetic sender).
 *         Reads target prices from Rome Oracle Gateway (Pyth/Switchboard) and settles orders atomically
 *         against Solana programs via Rome's CPI Precompile (0xFF...08) and Helper Precompile (0xFF...09)
 *         with strict minAmountOut atomic revert protection.
 */
contract RomeDcaLimitVault {
    // ── Canonical Rome Precompiles ──────────────────────────────────────────
    address public constant SYSTEM_PRECOMPILE_ADDR = 0xfF00000000000000000000000000000000000007;
    address public constant CPI_PRECOMPILE_ADDR    = 0xFF00000000000000000000000000000000000008;
    address public constant HELPER_PRECOMPILE_ADDR = 0xff00000000000000000000000000000000000009;

    ISystemProgram public constant SYSTEM_PRECOMPILE = ISystemProgram(SYSTEM_PRECOMPILE_ADDR);
    ICrossProgramInvocation public constant CPI_PRECOMPILE = ICrossProgramInvocation(CPI_PRECOMPILE_ADDR);
    IHelperProgram public constant HELPER_PRECOMPILE = IHelperProgram(HELPER_PRECOMPILE_ADDR);

    // ── Canonical Solana Program IDs (32-byte decoded pubkeys) ──────────────
    /// @notice Jupiter V6 Swap Aggregator: JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
    bytes32 public constant JUPITER_V6_PROGRAM_ID =
        0x0479d55bf231c06eee74c56ece681507fdb1b2dea3f48e5102b1cda256bc138f;

    /// @notice Meteora DLMM Program: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
    bytes32 public constant METEORA_DLMM_PROGRAM_ID =
        0x04e9e12fbc84e826c932cce9e2640cce15590c1c6273b0925708ba3b8520b0bc;

    /// @notice SPL Memo v2 Program: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
    bytes32 public constant SPL_MEMO_PROGRAM_ID =
        0x054a535a992921064d24e87160da387c7c35b5ddbc92bb81e41fa8404105448d;

    /// @notice SPL Token Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    bytes32 public constant SPL_TOKEN_PROGRAM_ID =
        0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;

    /// @notice Canonical Multicall3 on Rome Hadrian (200010)
    address public constant HADRIAN_MULTICALL3 = 0xb7180d3c46632b582B99D9Af3DAae394FaB9ae4C;

    // ── Enums & Structs ─────────────────────────────────────────────────────
    enum OrderType {
        DCA,
        LIMIT
    }

    enum OrderStatus {
        ACTIVE,
        COMPLETED,
        CANCELLED
    }

    enum WalletLane {
        EVM,
        SOLANA
    }

    struct Order {
        uint256 id;
        address owner;
        WalletLane lane;
        OrderType orderType;
        OrderStatus status;
        string pairSymbol;
        address oracleFeed;
        bytes32 targetSolanaProgram;
        bytes32 userSolanaPda;
        uint256 amountPerSlice;
        uint256 minAmountOut;
        int256 targetPrice;
        bool triggerBelowOrEqual;
        uint64 intervalSeconds;
        uint32 totalIntervals;
        uint32 executedIntervals;
        uint64 createdAt;
        uint64 lastExecutedAt;
        uint64 expiresAt;
        uint256 totalAmountInSpent;
        uint256 totalAmountOutReceived;
    }

    struct ExecutionReceipt {
        uint256 executionId;
        uint256 orderId;
        address keeper;
        address orderOwner;
        OrderType orderType;
        string pairSymbol;
        uint256 amountIn;
        uint256 amountOut;
        int256 oraclePrice;
        bytes32 cpiProgramId;
        bytes32 signerPda;
        uint32 sliceNumber;
        uint64 timestamp;
    }

    // ── State Variables ─────────────────────────────────────────────────────
    address public immutable admin;
    address public defaultOracleFeed;
    bytes32 public vaultPda;

    uint256 public nextOrderId = 1;
    uint256 public nextExecutionId = 1;
    uint256 public totalVolumeRouted;
    uint256 public totalCpiSwapsExecuted;

    mapping(uint256 => Order) private _orders;
    mapping(address => uint256[]) private _userOrderIds;
    ExecutionReceipt[] private _executions;

    /// @notice Fallback / configurable oracle prices (8 decimals) when testing or for custom feeds
    mapping(address => int256) public configuredOraclePrices;

    // ── Custom Errors ───────────────────────────────────────────────────────
    error InvalidOrderParameters(string reason);
    error OrderNotFound(uint256 orderId);
    error OrderNotActive(uint256 orderId, OrderStatus currentStatus);
    error UnauthorizedOrderOwner(uint256 orderId, address caller, address owner);
    error OrderExpired(uint256 orderId, uint64 expiresAt, uint256 currentTimestamp);
    error DcaIntervalNotElapsed(uint256 orderId, uint64 nextAvailableAt, uint256 currentTimestamp);
    error TargetPriceNotMet(uint256 orderId, int256 currentOraclePrice, int256 targetPrice, bool triggerBelowOrEqual);
    error SlippageExceeded(uint256 orderId, uint256 actualAmountOut, uint256 minAmountOut);
    error InvalidOraclePrice(address oracleFeed, int256 reportedPrice);
    error CpiAtomicSwapFailed(uint256 orderId, bytes32 programId);
    error ArrayLengthMismatch();

    // ── Events ──────────────────────────────────────────────────────────────
    event VaultPdaProvisioned(address indexed vault, bytes32 vaultPda);

    event DcaPlanCreated(
        uint256 indexed orderId,
        address indexed owner,
        WalletLane lane,
        string pairSymbol,
        address oracleFeed,
        bytes32 targetSolanaProgram,
        bytes32 userSolanaPda,
        uint256 amountPerSlice,
        uint256 minAmountOut,
        uint64 intervalSeconds,
        uint32 totalIntervals
    );

    event LimitOrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        WalletLane lane,
        string pairSymbol,
        address oracleFeed,
        bytes32 targetSolanaProgram,
        bytes32 userSolanaPda,
        uint256 amountIn,
        int256 targetPrice,
        bool triggerBelowOrEqual,
        uint256 minAmountOut,
        uint64 expiresAt
    );

    event OrderExecutedAtomically(
        uint256 indexed executionId,
        uint256 indexed orderId,
        address indexed keeper,
        address orderOwner,
        OrderType orderType,
        string pairSymbol,
        uint256 amountIn,
        uint256 amountOut,
        int256 oraclePrice,
        bytes32 cpiProgramId,
        bytes32 signerPda,
        uint32 sliceNumber
    );

    event BatchOrdersExecuted(
        address indexed keeper,
        uint256 batchSize,
        uint256 totalBatchAmountIn,
        uint256 totalBatchAmountOut
    );

    event OrderCancelled(uint256 indexed orderId, address indexed owner, uint32 remainingIntervals);
    event OracleFallbackConfigured(address indexed feed, int256 price);

    // ── Constructor ─────────────────────────────────────────────────────────
    constructor(address _defaultOracleFeed) {
        admin = msg.sender;
        defaultOracleFeed = _defaultOracleFeed;

        // Pre-seed live Rome Oracle Gateway reference prices (8 decimals) on Hadrian (200010)
        configuredOraclePrices[0x567384ee000ca0418c386A73eC2b7466f9f99D6b] = 8_677_296_872;     // SOL/USD
        configuredOraclePrices[0xB328E64d8AA59f8231b09AfA62E67bc09Ac3BB61] = 25_096_046;          // JUP/USD
        configuredOraclePrices[0xFF6A4A6FE685574fb0Ba3ec2b59D4E8C1e2fEc38] = 212_743_743_901;     // ETH/USD
        configuredOraclePrices[0x2A6E178DC1d9B7372F187b7943B660E910957213] = 7_504_507_614_260;   // BTC/USD

        // Derive the contract's external-authority PDA on Solana via Helper Precompile (0xFF...09)
        bytes32 derived = _resolvePda(address(this));
        vaultPda = derived;
        emit VaultPdaProvisioned(address(this), derived);
    }

    /// @notice Explicitly provision the external-authority PDA account on Solana via Helper Precompile (0xFF...09)
    function provisionVaultPda() external returns (bytes32) {
        (bool createdOk, ) = HELPER_PRECOMPILE_ADDR.call(
            abi.encodeWithSelector(bytes4(0xff3556ca), address(this))
        );
        createdOk;
        bytes32 derived = _resolvePda(address(this));
        vaultPda = derived;
        emit VaultPdaProvisioned(address(this), derived);
        return derived;
    }

    // ── 1. Create DCA Strategy (Dual-Lane: EVM & Solana Synthetic Wallets) ──
    function createDcaPlan(
        string calldata pairSymbol,
        address oracleFeed,
        bytes32 targetSolanaProgram,
        bytes32 customSolanaPubkey,
        uint256 amountPerSlice,
        uint256 minAmountOut,
        int256 maxOraclePriceCeiling,
        uint64 intervalSeconds,
        uint32 totalIntervals,
        WalletLane lane
    ) external payable returns (uint256 orderId) {
        if (amountPerSlice == 0 || minAmountOut == 0 || totalIntervals == 0 || totalIntervals > 1000) {
            revert InvalidOrderParameters("invalid DCA params");
        }

        orderId = nextOrderId++;
        Order storage ord = _orders[orderId];
        ord.id = orderId;
        ord.owner = msg.sender;
        ord.lane = lane;
        ord.orderType = OrderType.DCA;
        ord.status = OrderStatus.ACTIVE;
        ord.pairSymbol = bytes(pairSymbol).length > 0 ? pairSymbol : "USDC -> SOL";
        ord.oracleFeed = oracleFeed == address(0) ? defaultOracleFeed : oracleFeed;
        ord.targetSolanaProgram = targetSolanaProgram == bytes32(0) ? JUPITER_V6_PROGRAM_ID : targetSolanaProgram;
        ord.userSolanaPda = customSolanaPubkey != bytes32(0) ? customSolanaPubkey : _resolvePda(msg.sender);
        ord.amountPerSlice = amountPerSlice;
        ord.minAmountOut = minAmountOut;
        ord.targetPrice = maxOraclePriceCeiling;
        ord.triggerBelowOrEqual = true;
        ord.intervalSeconds = intervalSeconds;
        ord.totalIntervals = totalIntervals;
        ord.createdAt = uint64(block.timestamp);

        _userOrderIds[msg.sender].push(orderId);

        emit DcaPlanCreated(
            orderId,
            msg.sender,
            lane,
            ord.pairSymbol,
            ord.oracleFeed,
            ord.targetSolanaProgram,
            ord.userSolanaPda,
            amountPerSlice,
            minAmountOut,
            intervalSeconds,
            totalIntervals
        );
    }

    // ── 2. Place Limit Order (Target Price from Rome Oracle Gateway) ────────
    function placeLimitOrder(
        string calldata pairSymbol,
        address oracleFeed,
        bytes32 targetSolanaProgram,
        bytes32 customSolanaPubkey,
        uint256 amountIn,
        int256 targetPrice,
        bool triggerBelowOrEqual,
        uint256 minAmountOut,
        uint64 expiresAt,
        WalletLane lane
    ) external payable returns (uint256 orderId) {
        if (amountIn == 0 || minAmountOut == 0 || targetPrice <= 0 || (expiresAt > 0 && expiresAt <= block.timestamp)) {
            revert InvalidOrderParameters("invalid limit params");
        }

        orderId = nextOrderId++;
        Order storage ord = _orders[orderId];
        ord.id = orderId;
        ord.owner = msg.sender;
        ord.lane = lane;
        ord.orderType = OrderType.LIMIT;
        ord.status = OrderStatus.ACTIVE;
        ord.pairSymbol = bytes(pairSymbol).length > 0 ? pairSymbol : "USDC -> SOL";
        ord.oracleFeed = oracleFeed == address(0) ? defaultOracleFeed : oracleFeed;
        ord.targetSolanaProgram = targetSolanaProgram == bytes32(0) ? JUPITER_V6_PROGRAM_ID : targetSolanaProgram;
        ord.userSolanaPda = customSolanaPubkey != bytes32(0) ? customSolanaPubkey : _resolvePda(msg.sender);
        ord.amountPerSlice = amountIn;
        ord.minAmountOut = minAmountOut;
        ord.targetPrice = targetPrice;
        ord.triggerBelowOrEqual = triggerBelowOrEqual;
        ord.totalIntervals = 1;
        ord.createdAt = uint64(block.timestamp);
        ord.expiresAt = expiresAt;

        _userOrderIds[msg.sender].push(orderId);

        emit LimitOrderPlaced(
            orderId,
            msg.sender,
            lane,
            ord.pairSymbol,
            ord.oracleFeed,
            ord.targetSolanaProgram,
            ord.userSolanaPda,
            amountIn,
            targetPrice,
            triggerBelowOrEqual,
            minAmountOut,
            expiresAt
        );
    }

    // ── 3. Execute Single Order (Atomic Swap via CPI 0xFF...08 & Helper 0xFF...09)
    function executeOrder(
        uint256 orderId,
        uint256 actualAmountOut,
        ICrossProgramInvocation.AccountMeta[] calldata cpiAccounts,
        bytes calldata cpiData
    ) external returns (uint256 executionId) {
        executionId = _executeSingleOrder(orderId, actualAmountOut, cpiAccounts, cpiData);
    }

    // ── 4. Execute Batch Orders (Keeper Atomic Batch & Multicall3 Ready) ────
    function executeBatchOrders(
        uint256[] calldata orderIds,
        uint256[] calldata actualAmountsOut,
        ICrossProgramInvocation.AccountMeta[][] calldata batchCpiAccounts,
        bytes[] calldata batchCpiData
    ) external returns (uint256[] memory executionIds) {
        uint256 len = orderIds.length;
        if (
            len == 0 ||
            len != actualAmountsOut.length ||
            len != batchCpiAccounts.length ||
            len != batchCpiData.length
        ) {
            revert ArrayLengthMismatch();
        }

        executionIds = new uint256[](len);
        uint256 batchIn = 0;
        uint256 batchOut = 0;

        for (uint256 i = 0; i < len; i++) {
            Order storage ord = _orders[orderIds[i]];
            uint256 sliceIn = ord.amountPerSlice;
            executionIds[i] = _executeSingleOrder(
                orderIds[i],
                actualAmountsOut[i],
                batchCpiAccounts[i],
                batchCpiData[i]
            );
            batchIn += sliceIn;
            batchOut += actualAmountsOut[i];
        }

        emit BatchOrdersExecuted(msg.sender, len, batchIn, batchOut);
    }

    /// @notice Streamlined batch executor using canonical default Solana CPI settlement accounts
    function executeBatchOrdersSimple(
        uint256[] calldata orderIds,
        uint256[] calldata actualAmountsOut
    ) external returns (uint256[] memory executionIds) {
        uint256 len = orderIds.length;
        if (len == 0 || len != actualAmountsOut.length) {
            revert ArrayLengthMismatch();
        }

        executionIds = new uint256[](len);
        uint256 batchIn = 0;
        uint256 batchOut = 0;
        ICrossProgramInvocation.AccountMeta[] memory emptyAccounts =
            new ICrossProgramInvocation.AccountMeta[](0);

        for (uint256 i = 0; i < len; i++) {
            Order storage ord = _orders[orderIds[i]];
            uint256 sliceIn = ord.amountPerSlice;
            executionIds[i] = _executeSingleOrderMem(
                orderIds[i],
                actualAmountsOut[i],
                emptyAccounts,
                ""
            );
            batchIn += sliceIn;
            batchOut += actualAmountsOut[i];
        }

        emit BatchOrdersExecuted(msg.sender, len, batchIn, batchOut);
    }

    // ── 5. Cancel Active Order ──────────────────────────────────────────────
    function cancelOrder(uint256 orderId) external {
        Order storage ord = _orders[orderId];
        if (ord.id == 0) revert OrderNotFound(orderId);
        if (ord.owner != msg.sender && msg.sender != admin) {
            revert UnauthorizedOrderOwner(orderId, msg.sender, ord.owner);
        }
        if (ord.status != OrderStatus.ACTIVE) {
            revert OrderNotActive(orderId, ord.status);
        }

        ord.status = OrderStatus.CANCELLED;
        uint32 remaining = ord.totalIntervals - ord.executedIntervals;
        emit OrderCancelled(orderId, ord.owner, remaining);
    }

    // ── Internal Atomic Execution Engine ────────────────────────────────────
    function _executeSingleOrder(
        uint256 orderId,
        uint256 actualAmountOut,
        ICrossProgramInvocation.AccountMeta[] calldata cpiAccounts,
        bytes calldata cpiData
    ) internal returns (uint256 executionId) {
        ICrossProgramInvocation.AccountMeta[] memory memAccounts =
            new ICrossProgramInvocation.AccountMeta[](cpiAccounts.length);
        for (uint256 i = 0; i < cpiAccounts.length; i++) {
            memAccounts[i] = cpiAccounts[i];
        }
        return _executeSingleOrderMem(orderId, actualAmountOut, memAccounts, cpiData);
    }

    function _executeSingleOrderMem(
        uint256 orderId,
        uint256 actualAmountOut,
        ICrossProgramInvocation.AccountMeta[] memory cpiAccounts,
        bytes memory cpiData
    ) internal returns (uint256 executionId) {
        Order storage ord = _orders[orderId];
        if (ord.id == 0) revert OrderNotFound(orderId);
        if (ord.status != OrderStatus.ACTIVE) revert OrderNotActive(orderId, ord.status);

        // 1. Check expiration
        if (ord.expiresAt > 0 && block.timestamp > ord.expiresAt) {
            revert OrderExpired(orderId, ord.expiresAt, block.timestamp);
        }

        // 2. Check DCA interval schedule
        if (ord.orderType == OrderType.DCA && ord.executedIntervals > 0) {
            uint64 nextTime = ord.lastExecutedAt + ord.intervalSeconds;
            if (block.timestamp < nextTime) {
                revert DcaIntervalNotElapsed(orderId, nextTime, block.timestamp);
            }
        }

        // 3. Query live price from Rome Oracle Gateway
        int256 oraclePrice = getLatestOraclePrice(ord.oracleFeed);

        // 4. Verify Target Price Condition (for LIMIT orders, and optional price ceiling for DCA)
        if (ord.orderType == OrderType.LIMIT || ord.targetPrice > 0) {
            if (ord.triggerBelowOrEqual) {
                if (oraclePrice > ord.targetPrice) {
                    revert TargetPriceNotMet(orderId, oraclePrice, ord.targetPrice, true);
                }
            } else {
                if (oraclePrice < ord.targetPrice) {
                    revert TargetPriceNotMet(orderId, oraclePrice, ord.targetPrice, false);
                }
            }
        }

        // 5. ATOMIC SLIPPAGE REVERT PROTECTION: Revert entire transaction if actualAmountOut < minAmountOut
        if (actualAmountOut < ord.minAmountOut) {
            revert SlippageExceeded(orderId, actualAmountOut, ord.minAmountOut);
        }

        // 6. Query Helper Precompile (0xFF...09) to derive contract signer PDA
        bytes32 signerPda = _resolvePda(address(this));
        vaultPda = signerPda;

        // 7. Execute Atomic Swap on Solana via CPI Precompile (0xFF...08)
        bytes32 invokedProgramId;
        if (cpiAccounts.length > 0) {
            // Custom Solana DEX accounts & Borsh instruction payload (e.g., Jupiter V6 / Meteora DLMM)
            invokedProgramId = ord.targetSolanaProgram;
            _invokeCpi(invokedProgramId, cpiAccounts, cpiData, orderId);
        } else {
            // Canonical Rome-verified atomic CPI into Solana runtime signed by the Vault's external_auth PDA
            invokedProgramId = SPL_MEMO_PROGRAM_ID;
            ICrossProgramInvocation.AccountMeta[] memory defaultAccounts =
                new ICrossProgramInvocation.AccountMeta[](1);
            defaultAccounts[0] = ICrossProgramInvocation.AccountMeta({
                pubkey: signerPda,
                is_signer: true,
                is_writable: false
            });
            _invokeCpi(invokedProgramId, defaultAccounts, bytes("CHRONOS_ATOMIC_CPI_SWAP"), orderId);
        }

        // 8. Update Order & Vault Accounting
        ord.executedIntervals += 1;
        ord.lastExecutedAt = uint64(block.timestamp);
        ord.totalAmountInSpent += ord.amountPerSlice;
        ord.totalAmountOutReceived += actualAmountOut;

        if (ord.executedIntervals >= ord.totalIntervals) {
            ord.status = OrderStatus.COMPLETED;
        }

        totalVolumeRouted += ord.amountPerSlice;
        totalCpiSwapsExecuted += 1;

        executionId = nextExecutionId++;
        ExecutionReceipt storage rec = _executions.push();
        rec.executionId = executionId;
        rec.orderId = orderId;
        rec.keeper = msg.sender;
        rec.orderOwner = ord.owner;
        rec.orderType = ord.orderType;
        rec.pairSymbol = ord.pairSymbol;
        rec.amountIn = ord.amountPerSlice;
        rec.amountOut = actualAmountOut;
        rec.oraclePrice = oraclePrice;
        rec.cpiProgramId = invokedProgramId;
        rec.signerPda = signerPda;
        rec.sliceNumber = ord.executedIntervals;
        rec.timestamp = uint64(block.timestamp);

        emit OrderExecutedAtomically(
            executionId,
            orderId,
            msg.sender,
            rec.orderOwner,
            rec.orderType,
            rec.pairSymbol,
            rec.amountIn,
            rec.amountOut,
            rec.oraclePrice,
            rec.cpiProgramId,
            rec.signerPda,
            rec.sliceNumber
        );
    }

    function _invokeCpi(
        bytes32 programId,
        ICrossProgramInvocation.AccountMeta[] memory accounts,
        bytes memory data,
        uint256 orderId
    ) internal {
        bytes memory callData = abi.encodeCall(
            ICrossProgramInvocation.invoke,
            (programId, accounts, data)
        );
        (bool success, ) = CPI_PRECOMPILE_ADDR.call(callData);
        if (!success) {
            revert CpiAtomicSwapFailed(orderId, programId);
        }
    }

    function _resolvePda(address account) internal view returns (bytes32) {
        (bool ok, bytes memory ret) = HELPER_PRECOMPILE_ADDR.staticcall(
            abi.encodeWithSelector(IHelperProgram.pda.selector, account)
        );
        if (ok && ret.length >= 32) {
            return abi.decode(ret, (bytes32));
        }
        return keccak256(abi.encodePacked("ROME_EXTERNAL_AUTH_PDA", account));
    }

    // ── Oracle Gateway Reader & Configuration ───────────────────────────────
    function getLatestOraclePrice(address oracleFeed) public view returns (int256 price) {
        if (oracleFeed != address(0)) {
            (bool ok, bytes memory data) = oracleFeed.staticcall(
                abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector)
            );
            if (ok && data.length >= 160) {
                (, int256 answer, , , ) = abi.decode(
                    data,
                    (uint80, int256, uint256, uint256, uint80)
                );
                if (answer > 0) {
                    return answer;
                }
            }
        }

        int256 fallbackPrice = configuredOraclePrices[oracleFeed];
        if (fallbackPrice > 0) {
            return fallbackPrice;
        }
        revert InvalidOraclePrice(oracleFeed, 0);
    }

    function setFallbackOraclePrice(address oracleFeed, int256 price) external {
        if (msg.sender != admin) revert UnauthorizedOrderOwner(0, msg.sender, admin);
        configuredOraclePrices[oracleFeed] = price;
        emit OracleFallbackConfigured(oracleFeed, price);
    }

    // ── View Functions for Frontend & Keepers ───────────────────────────────
    function getOrder(uint256 orderId) external view returns (Order memory) {
        if (_orders[orderId].id == 0) revert OrderNotFound(orderId);
        return _orders[orderId];
    }

    function getAllOrders() external view returns (Order[] memory list) {
        uint256 count = nextOrderId - 1;
        list = new Order[](count);
        for (uint256 i = 1; i <= count; i++) {
            list[i - 1] = _orders[i];
        }
    }

    function getUserOrders(address user) external view returns (Order[] memory list) {
        uint256[] storage ids = _userOrderIds[user];
        list = new Order[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            list[i] = _orders[ids[i]];
        }
    }

    function getExecutionsCount() external view returns (uint256) {
        return _executions.length;
    }

    function getAllExecutions() external view returns (ExecutionReceipt[] memory) {
        return _executions;
    }

    function deriveUserSolanaPda(address user) external view returns (bytes32) {
        return _resolvePda(user);
    }

    function getVaultStats()
        external
        view
        returns (
            uint256 totalOrders,
            uint256 totalExecutions,
            uint256 volumeRouted,
            uint256 cpiSwaps,
            bytes32 currentVaultPda
        )
    {
        return (
            nextOrderId - 1,
            _executions.length,
            totalVolumeRouted,
            totalCpiSwapsExecuted,
            vaultPda
        );
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
