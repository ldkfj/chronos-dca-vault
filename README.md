# Chronos Vault — Atomic DCA & Limit Order Router to Solana Liquidity

**Chronos Vault** is an automated **Dollar-Cost Averaging (DCA)** and **Target-Price Limit Order** vault built for the **Rome Builder Arena**. It enables both **EVM wallets (MetaMask)** and **Solana wallets (Phantom / Solflare via Rome Dual-Lane synthetic sender)** to schedule recurring buys or target-price orders reading live prices from the **Rome Oracle Gateway**, while keepers settle batches atomically against Solana liquidity via Rome's **CPI Precompile (`0xFF...08`)** and **Helper Precompile (`0xFF...09`)** with full `minAmountOut` atomic slippage revert protection.

---

## 🏛️ Architecture & Rome Protocol Integration

```mermaid
flowchart LR
    subgraph Wallets["Dual-Lane User Wallets"]
        EVM["EVM Wallet (MetaMask)"]
        SOL["Solana Wallet (Phantom Dual-Lane)"]
    end

    subgraph RomeEVM["Rome EVM (Hadrian 200010 / Rubicon 7531)"]
        Vault["RomeDcaLimitVault.sol (^0.8.28)"]
        Oracle["Rome Oracle Gateway (SOL/USD, JUP/USD, ETH/USD, BTC/USD)"]
        MC3["Multicall3 (0xb718...ae4c)"]
        Helper["Helper Precompile (0xFF...09)"]
        CPI["CPI Precompile (0xFF...08)"]
    end

    subgraph SolanaRuntime["Solana Runtime (Same ~400ms Slot)"]
        PDA["Vault External-Auth PDA"]
        JUP["Jupiter V6 (JUP6LkbZbjS1...)"]
        MET["Meteora DLMM (LBUZKhRxPF3X...)"]
        MEMO["SPL Memo v2 (MemoSq4gqABA...)"]
    end

    EVM -->|createDcaPlan / placeLimitOrder| Vault
    SOL -->|Dual-Lane Synthetic Sender| Vault
    MC3 -->|executeOrder / executeBatchOrders| Vault
    Vault -->|latestRoundData| Oracle
    Vault -->|pda(address)| Helper
    Helper -->|Derives Signer| PDA
    Vault -->|invoke(programId, accounts, data)| CPI
    CPI -->|Atomic Cross-VM CPI| JUP
    CPI -->|Atomic Cross-VM CPI| MET
    CPI -->|Signed Settlement Proof| MEMO
```

### Core Capabilities
1. **Dual-Lane Order Creation (`EVM` + `SOLANA`):**
   - EVM users (`MetaMask`) and Solana users (`Phantom`/`Solflare`) create recurring DCA plans (`createDcaPlan`) or target-price Limit Orders (`placeLimitOrder`).
   - Each user's Solana PDA is automatically derived on-chain via `IHelperProgram(0xff00000000000000000000000000000000000009).pda(user)`.
2. **Rome Oracle Gateway Price Verification:**
   - Limit orders and price-protected DCA plans read live `latestRoundData()` feeds (`SOL/USD`, `JUP/USD`, `ETH/USD`, `BTC/USD`) from the Rome Oracle Gateway before permitting execution.
3. **Atomic Solana CPI Execution (`0xFF...08` & `0xFF...09`):**
   - When a keeper triggers `executeOrder` or `executeBatchOrders` / `executeBatchOrdersSimple`, `RomeDcaLimitVault.sol` resolves its external-authority PDA via `0xFF...09` and dispatches an atomic CPI into the Solana runtime via `ICrossProgramInvocation(0xFF00000000000000000000000000000000000008).invoke(...)`.
4. **Strict `minAmountOut` Atomic Slippage Revert Guard:**
   - If the realized output `actualAmountOut < minAmountOut`, `RomeDcaLimitVault.sol` reverts with `SlippageExceeded(orderId, actualAmountOut, minAmountOut)`, rolling back both the EVM state and the Solana CPI within the same ~400ms Solana transaction.

---

## 🔗 On-Chain Verification (Hadrian Testnet `200010` & Rubicon Mainnet `7531`)

### Hadrian Testnet (`200010`)
- **Contract (`RomeDcaLimitVault.sol`):** [`0x32b15e9209bc5de627148852d78f553e80a7f085`](https://via-hadrian.testnet.romeprotocol.xyz/address/0x32b15e9209bc5de627148852d78f553e80a7f085)
- **Vault External-Auth Solana PDA (`HELPER.pda`):** `0xbc284f584256c0800bbf3fd44c2494aa6f125fd413d98cc26f25ae4bfd7f0be8`
- **Deployment Transaction:** [`0x11afd242e4b66731d258802313755fbec5f33efddd65eceab9efb8e53802e721`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x11afd242e4b66731d258802313755fbec5f33efddd65eceab9efb8e53802e721)
  - Solana Settlement Signature: `E41B4Ejep9Kt64A64wBBo24XEVggbcwYhSUjNNkgD8ESxj8qqmdD78SLpbV7uV4yRTdTCPUWb7HxpF7V66YTzxm`

### Real On-Chain User & Keeper Transactions
| # | Action | Role / Wallet | Hadrian Explorer Link | Solana Settlement Signature |
|---|---|---|---|---|
| 1 | **Deploy `RomeDcaLimitVault`** | Deployer (`0xef46...9845`) | [`0x11afd242...3802e721`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x11afd242e4b66731d258802313755fbec5f33efddd65eceab9efb8e53802e721) | `E41B4Ejep9Kt64A64wBBo24XEVggbcwYhSUjNNkgD8ESxj8qqmdD78SLpbV7uV4yRTdTCPUWb7HxpF7V66YTzxm` |
| 2 | **Create DCA Strategy #1 (`USDC -> SOL` via Jupiter V6)** | User 1 (`0xB7a9...976e`) | [`0x13440456...2bb10b5c`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x13440456014665bc04ffc29a9675d93c384deb89cb4bb76205d845c92bb10b5c) | `4iNC1AAvSGUmrMt3gbBMim7LEhsntVCUqqdxRcUny1L434tTphz8DfMH67R5x9HCkXWMdURrUu8Nn4NMjWc7fRUZ` |
| 3 | **Place Limit Order #2 (`USDC -> JUP` @ &le; $0.3000)** | User 1 (`0xB7a9...976e`) | [`0x6fc8019f...7487ef3d`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x6fc8019f6eedcb07c81f7f81ae30679d28d6a1fa05d6b24cc9c507cc7487ef3d) | `62YK6W3ZEj9V2XwucAfQmyfqhyFAdWkTj3sVMJJoXwJANRu3mGjtvdu8GUQ4pqiNeirk95XkrPtjhyoN4CE6zL4R` |
| 4 | **Create Dual-Lane Solana DCA Strategy #3 (`USDC -> ETH` via Meteora DLMM)** | Solana Dual-Lane (`0xef46...9845`) | [`0x4d20669b...eda1efa1`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x4d20669b3c70b95d2f72a5ae6e6bd5387a13953056eccb897670a93ceda1efa1) | `3Pjj4cNdN2ovJz5A2N43uaefXVnoW5yTMAsuCmeCJtxkYBvfMjghwoBfiayDqpz1kxipe5dGZtVi42QCESdDYVAo` |
| 5 | **Execute Atomic CPI Swap (Order #1 Slice #1 via `0xFF...08`)** | Keeper (`0x6e5F...6462`) | [`0x57aaae1f...6d77ca6b`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x57aaae1f8514809dea5d7a7959fe9da4d574cd4c6574e9af700f55b46d77ca6b) | `2a7rkPYJMN8VueDQvRy7w1GERktoReMXU38a2BDP23vZfrbMXyChV7ryAiS2XL4P1oFKh4xpzRJu6JAumemEhsd8` |
| 6 | **Execute Keeper Atomic Batch Fill (Limit Order #2 via `0xFF...08`)** | Keeper (`0x6e5F...6462`) | [`0x23f6bffb...b06b0e15`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0x23f6bffb9d27d81c578114a150b7c63c42e04804eebe522ff64685b6b06b0e15) | `2VdRWVL2wL9iUydy8sLJx2GqGZSnydgii49oAihzXx86135vDrQ4cjqxc7ytKhpMqtMPKYGiEm2RKZZCQqxaEqwM` |
| 7 | **Execute Dual-Lane Solana DCA Slice (Order #3 Slice #1 via `0xFF...08`)** | Keeper (`0x6e5F...6462`) | [`0xb0419d57...e1c532ea`](https://via-hadrian.testnet.romeprotocol.xyz/tx/0xb0419d57b5b6eebf5f1a19a238ad97deedfa1a22af38408976152a64e1c532ea) | `2zdz8VU84q6Y1bamyGksUeg6gqVaWX6kn4uFurqHGSKYjouPgVqw4JacKPs7Mbt67P9ujJuSusYra7hEmefnkQUn` |

---

## 🛠️ Local Development & Verification

```bash
# 1. Install dependencies
npm install

# 2. Compile Solidity ^0.8.28 smart contracts
npm run compile:contracts

# 3. Run unit test suite (9/9 tests covering DCA, Limit Orders, CPI, and Atomic Slippage Reverts)
npm run test:contracts

# 4. Run TypeScript check & production build
npm run typecheck
npm run build

# 5. Start Next.js web application
npm run dev
```
