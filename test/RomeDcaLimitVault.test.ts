import { describe, it, expect, beforeAll } from "vitest";
import { createEVM, EVM } from "@ethereumjs/evm";
import { Common, Mainnet, Hardfork } from "@ethereumjs/common";
import { Address, Account, hexToBytes } from "@ethereumjs/util";
import { encodeAbiParameters, encodeFunctionData, decodeFunctionResult } from "viem";
import { compileContracts } from "../scripts/compile";

const CPI_ADDR = "0xff00000000000000000000000000000000000008" as const;
const HELPER_ADDR = "0xff00000000000000000000000000000000000009" as const;

const DEPLOYER = "0xef469EA73E17e629523e08CeAba67dF0b1759845" as const;
const EVM_USER = "0xB7a93Ce9c043d410c627C95807f3d26423f3976e" as const;
const SOLANA_SYNTHETIC_USER = "0x399995f606e9819a7dA3a1d21CAeC99ecF1E2B1a" as const;
const KEEPER = "0x8CAaC756b3Aaee8938A8D592Bf15b1f231363B9D" as const;

describe("RomeDcaLimitVault (Chronos Vault) — Comprehensive Unit Test Suite", () => {
  let evm: EVM;
  let compiled: ReturnType<typeof compileContracts>;
  let vaultAddress: `0x${string}`;
  let oracleAddress: `0x${string}`;
  let vaultAbi: any[];
  let oracleAbi: any[];
  let cpiAbi: any[];

  async function deploy(
    from: `0x${string}`,
    bytecode: `0x${string}`,
    ctorTypes: any[] = [],
    ctorArgs: any[] = []
  ): Promise<`0x${string}`> {
    const encodedArgs =
      ctorTypes.length > 0 ? encodeAbiParameters(ctorTypes, ctorArgs).slice(2) : "";
    const fullInitCode = `${bytecode}${encodedArgs}` as `0x${string}`;
    const res = await evm.runCall({
      caller: new Address(hexToBytes(from)),
      data: hexToBytes(fullInitCode),
      gasLimit: 25_000_000n,
    });
    if (res.execResult.exceptionError || !res.createdAddress) {
      throw new Error(`Deploy failed: ${res.execResult.exceptionError?.error}`);
    }
    return res.createdAddress.toString() as `0x${string}`;
  }

  async function callContract(
    from: `0x${string}`,
    to: `0x${string}`,
    abi: any[],
    functionName: string,
    args: any[] = []
  ) {
    const data = encodeFunctionData({ abi, functionName, args });
    const res = await evm.runCall({
      caller: new Address(hexToBytes(from)),
      to: new Address(hexToBytes(to)),
      data: hexToBytes(data),
      gasLimit: 15_000_000n,
    });
    if (res.execResult.exceptionError) {
      throw new Error(`REVERT:${res.execResult.exceptionError.error}`);
    }
    if (res.execResult.returnValue.length === 0) return undefined;
    const hexRet = `0x${Buffer.from(res.execResult.returnValue).toString("hex")}` as `0x${string}`;
    return decodeFunctionResult({ abi, functionName, data: hexRet });
  }

  beforeAll(async () => {
    compiled = compileContracts();
    vaultAbi = compiled.RomeDcaLimitVault.abi;
    oracleAbi = compiled.MockOracleFeed.abi;
    cpiAbi = compiled.MockCpiPrecompile.abi;

    const common = new Common({ chain: "mainnet", hardfork: Hardfork.Cancun });
    evm = await EVM.create({ common });

    // Fund accounts
    for (const addr of [DEPLOYER, EVM_USER, SOLANA_SYNTHETIC_USER, KEEPER]) {
      const a = new Address(hexToBytes(addr));
      await evm.stateManager.putAccount(
        a,
        new Account(0n, 100_000_000_000_000_000_000n)
      );
    }

    // Install Rome Helper Precompile (0xFF...09) & CPI Precompile (0xFF...08)
    await evm.stateManager.putContractCode(
      new Address(hexToBytes(HELPER_ADDR)),
      hexToBytes(compiled.MockHelperPrecompile.deployedBytecode)
    );
    await evm.stateManager.putContractCode(
      new Address(hexToBytes(CPI_ADDR)),
      hexToBytes(compiled.MockCpiPrecompile.deployedBytecode)
    );

    // Deploy Mock Rome Oracle Gateway Feed (SOL/USD @ $87.30 = 8_730_000_000 with 8 decimals)
    oracleAddress = await deploy(
      DEPLOYER,
      compiled.MockOracleFeed.bytecode,
      [{ type: "int256" }],
      [8_730_000_000n]
    );

    // Deploy RomeDcaLimitVault
    vaultAddress = await deploy(
      DEPLOYER,
      compiled.RomeDcaLimitVault.bytecode,
      [{ type: "address" }],
      [oracleAddress]
    );
  });

  it("1. Provisions Vault external-authority PDA via Helper Precompile (0xFF...09) and reads Rome Oracle Gateway", async () => {
    const vaultPda = (await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "vaultPda"
    )) as `0x${string}`;
    expect(vaultPda).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(vaultPda).not.toBe("0x" + "0".repeat(64));

    const price = await callContract(
      DEPLOYER,
      vaultAddress,
      vaultAbi,
      "getLatestOraclePrice",
      [oracleAddress]
    );
    expect(price).toBe(8_730_000_000n);
  });

  it("2. Allows EVM wallet to create a recurring DCA strategy and derives user Solana PDA", async () => {
    const orderId = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "createDcaPlan",
      [
        "USDC -> SOL",
        oracleAddress,
        "0x0479d55bf231c06eee74c56ece681507fdb1b2dea3f48e5102b1cda256bc138f", // Jupiter V6
        "0x" + "0".repeat(64), // auto-derive via Helper.pda
        25_000_000n, // 25 USDC per slice
        280_000_000n, // min 0.28 SOL (9 decimals) per slice
        9_500_000_000n, // max price ceiling $95.00
        0n, // 0 interval for immediate test slice
        3, // 3 slices
        0, // WalletLane.EVM
      ]
    );

    expect(orderId).toBe(1n);

    const order: any = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [1n]
    );
    expect(order.owner.toLowerCase()).toBe(EVM_USER.toLowerCase());
    expect(order.lane).toBe(0); // EVM
    expect(order.orderType).toBe(0); // DCA
    expect(order.status).toBe(0); // ACTIVE
    expect(order.amountPerSlice).toBe(25_000_000n);
    expect(order.minAmountOut).toBe(280_000_000n);
    expect(order.totalIntervals).toBe(3);
  });

  it("3. Allows Solana wallet (Dual-Lane synthetic sender) to place a target-price Limit Order", async () => {
    const orderId = await callContract(
      SOLANA_SYNTHETIC_USER,
      vaultAddress,
      vaultAbi,
      "placeLimitOrder",
      [
        "USDC -> SOL",
        oracleAddress,
        "0x0479d55bf231c06eee74c56ece681507fdb1b2dea3f48e5102b1cda256bc138f",
        "0x" + "0".repeat(64),
        50_000_000n, // 50 USDC
        8_500_000_000n, // Target Limit Buy price: <= $85.00
        true, // triggerBelowOrEqual = true (Limit Buy)
        580_000_000n, // minAmountOut = 0.58 SOL
        0n, // no expiry
        1, // WalletLane.SOLANA
      ]
    );

    expect(orderId).toBe(2n);

    const order: any = await callContract(
      SOLANA_SYNTHETIC_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [2n]
    );
    expect(order.owner.toLowerCase()).toBe(SOLANA_SYNTHETIC_USER.toLowerCase());
    expect(order.lane).toBe(1); // SOLANA
    expect(order.orderType).toBe(1); // LIMIT
    expect(order.targetPrice).toBe(8_500_000_000n);
  });

  it("4. Reverts Limit Order execution when Rome Oracle Gateway price has not reached targetPrice", async () => {
    // Current oracle price is $87.30 > $85.00 target buy price
    await expect(
      callContract(KEEPER, vaultAddress, vaultAbi, "executeOrder", [
        2n,
        590_000_000n,
        [],
        "0x",
      ])
    ).rejects.toThrow(/REVERT/);
  });

  it("5. Reverts atomically when actualAmountOut < minAmountOut (Slippage Protection)", async () => {
    // Order #1 requires minAmountOut = 280_000_000n; pass 250_000_000n -> must revert atomically!
    await expect(
      callContract(KEEPER, vaultAddress, vaultAbi, "executeOrder", [
        1n,
        250_000_000n,
        [],
        "0x",
      ])
    ).rejects.toThrow(/REVERT/);

    // Verify zero state mutation occurred on Order #1
    const orderAfterRevert: any = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [1n]
    );
    expect(orderAfterRevert.executedIntervals).toBe(0);
  });

  it("6. Executes DCA slice atomically via CPI (0xFF...08) when slippage and oracle conditions pass", async () => {
    const customJupiterAccounts = [
      {
        pubkey: ("0x" + "11".repeat(32)) as `0x${string}`,
        is_signer: true,
        is_writable: true,
      },
      {
        pubkey: ("0x" + "22".repeat(32)) as `0x${string}`,
        is_signer: false,
        is_writable: true,
      },
    ];
    const jupiterBorshPayload = "0xe445a52e51cb9a1d01000000" as const;

    const execId = await callContract(
      KEEPER,
      vaultAddress,
      vaultAbi,
      "executeOrder",
      [1n, 290_000_000n, customJupiterAccounts, jupiterBorshPayload]
    );
    expect(execId).toBe(1n);

    const order: any = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [1n]
    );
    expect(order.executedIntervals).toBe(1);
    expect(order.totalAmountInSpent).toBe(25_000_000n);
    expect(order.totalAmountOutReceived).toBe(290_000_000n);
  });

  it("7. Reverts entire transaction atomically if Solana CPI Precompile (0xFF...08) fails", async () => {
    await callContract(DEPLOYER, CPI_ADDR, cpiAbi, "setShouldFail", [true]);

    await expect(
      callContract(KEEPER, vaultAddress, vaultAbi, "executeOrder", [
        1n,
        295_000_000n,
        [],
        "0x",
      ])
    ).rejects.toThrow(/REVERT/);

    await callContract(DEPLOYER, CPI_ADDR, cpiAbi, "setShouldFail", [false]);
  });

  it("8. Executes Keeper Atomic Batch (DCA Slice + Triggered Limit Order) in a single transaction", async () => {
    // Update Oracle price to $84.20 (8_420_000_000) so Limit Order #2 (<= $85.00) becomes executable!
    await callContract(DEPLOYER, oracleAddress, oracleAbi, "setPrice", [
      8_420_000_000n,
    ]);

    // First verify that if ANY order in a batch violates slippage, the ENTIRE batch reverts atomically
    await expect(
      callContract(
        KEEPER,
        vaultAddress,
        vaultAbi,
        "executeBatchOrdersSimple",
        [
          [1n, 2n],
          [295_000_000n, 500_000_000n], // Order #2 minAmountOut is 580_000_000 -> fails!
        ]
      )
    ).rejects.toThrow(/REVERT/);

    // Now execute the valid batch atomically
    const execIds = (await callContract(
      KEEPER,
      vaultAddress,
      vaultAbi,
      "executeBatchOrdersSimple",
      [
        [1n, 2n],
        [295_000_000n, 595_000_000n],
      ]
    )) as bigint[];

    expect(execIds.length).toBe(2);

    const order1: any = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [1n]
    );
    const order2: any = await callContract(
      SOLANA_SYNTHETIC_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [2n]
    );

    expect(order1.executedIntervals).toBe(2);
    expect(order2.executedIntervals).toBe(1);
    expect(order2.status).toBe(1); // COMPLETED
  });

  it("9. Supports order cancellation by owner and prevents unauthorized cancellation", async () => {
    // Unauthorized caller cannot cancel Order #1
    await expect(
      callContract(
        SOLANA_SYNTHETIC_USER,
        vaultAddress,
        vaultAbi,
        "cancelOrder",
        [1n]
      )
    ).rejects.toThrow(/REVERT/);

    // Owner cancels remaining slice of Order #1
    await callContract(EVM_USER, vaultAddress, vaultAbi, "cancelOrder", [1n]);
    const order1: any = await callContract(
      EVM_USER,
      vaultAddress,
      vaultAbi,
      "getOrder",
      [1n]
    );
    expect(order1.status).toBe(2); // CANCELLED
  });
});
