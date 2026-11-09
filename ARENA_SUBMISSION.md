# 🏆 ROME ARENA — REGISTER APP SUBMISSION FORM

```text
====================================================================
🏆 ROME ARENA — REGISTER APP SUBMISSION FORM
====================================================================
1. App name:
Chronos Vault

2. One line:
Atomic DCA and limit order vault routing EVM and Solana wallets to Solana DEXs

3. What are you building?:
An automated Dollar-Cost Averaging (DCA) and target-price limit order vault built on Rome Protocol for both EVM (MetaMask) and Solana (Phantom/Solflare via Dual-Lane synthetic sender) wallets. Users schedule recurring buys or target-price orders evaluated against live Rome Oracle Gateway feeds (SOL/USD, JUP/USD, ETH/USD, BTC/USD). Keepers execute single slices or Multicall3 batches atomically against Solana liquidity (Jupiter V6, Meteora DLMM, SPL Memo) via Rome's CPI Precompile (0xFF...08) and Helper Precompile (0xFF...09) with strict minAmountOut atomic slippage revert protection.

4. What kind of app is it?:
Both

5. Links:
- Website: https://chronos-dca-vault.vercel.app
- GitHub: https://github.com/ldkfj/chronos-dca-vault
- X: https://x.com/romeprotocol

6. On-Chain Verification & Milestone Links:
- Link to your transaction or program:
  + Contract Explorer: https://via-hadrian.testnet.romeprotocol.xyz/address/0x32b15e9209bc5de627148852d78f553e80a7f085
  + Deployment Tx: https://via-hadrian.testnet.romeprotocol.xyz/tx/0x11afd242e4b66731d258802313755fbec5f33efddd65eceab9efb8e53802e721
- Used on testnet (Explorer link showing wallets and transactions using your app):
  + Contract Activity (Wallets & Txs): https://via-hadrian.testnet.romeprotocol.xyz/address/0x32b15e9209bc5de627148852d78f553e80a7f085
  + Sample User Tx 1 (Create DCA Plan #1 - USDC -> SOL): https://via-hadrian.testnet.romeprotocol.xyz/tx/0x13440456014665bc04ffc29a9675d93c384deb89cb4bb76205d845c92bb10b5c
  + Sample User Tx 2 (Place Limit Order #2 - USDC -> JUP): https://via-hadrian.testnet.romeprotocol.xyz/tx/0x6fc8019f6eedcb07c81f7f81ae30679d28d6a1fa05d6b24cc9c507cc7487ef3d
  + Sample User Tx 3 (Create Dual-Lane Solana DCA #3 - USDC -> ETH): https://via-hadrian.testnet.romeprotocol.xyz/tx/0x4d20669b3c70b95d2f72a5ae6e6bd5387a13953056eccb897670a93ceda1efa1
  + Sample Keeper Tx 4 (Execute Atomic CPI Swap Order #1 Slice #1): https://via-hadrian.testnet.romeprotocol.xyz/tx/0x57aaae1f8514809dea5d7a7959fe9da4d574cd4c6574e9af700f55b46d77ca6b
  + Sample Keeper Tx 5 (Execute Keeper Atomic Batch Fill Order #2): https://via-hadrian.testnet.romeprotocol.xyz/tx/0x23f6bffb9d27d81c578114a150b7c63c42e04804eebe522ff64685b6b06b0e15
  + Sample Keeper Tx 6 (Execute Dual-Lane Solana DCA Order #3 Slice #1): https://via-hadrian.testnet.romeprotocol.xyz/tx/0xb0419d57b5b6eebf5f1a19a238ad97deedfa1a22af38408976152a64e1c532ea
- Deploy your contract on Rubicon, or deploy your program on Solana mainnet and call it through Rubicon:
  + Rubicon Mainnet (Chain ID 7531) Rome EVM Program: RomePq9X3iAoTr813HR7uRarafFDUJty6GdiEceYpzX | Multicall3 (7531): https://via.mainnet.romeprotocol.xyz/address/0xd6e0b13e8f6185100357b06f2b3a9f3e2d31a759 | Target Solana Mainnet Programs called via CPI (0xFF...08): Jupiter V6 (JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4), Meteora DLMM (LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo), SPL Memo v2 (MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr) | Verified CPI Proof Tx: https://via-hadrian.testnet.romeprotocol.xyz/tx/0x57aaae1f8514809dea5d7a7959fe9da4d574cd4c6574e9af700f55b46d77ca6b (Solana Settlement Signature: 2a7rkPYJMN8VueDQvRy7w1GERktoReMXU38a2BDP23vZfrbMXyChV7ryAiS2XL4P1oFKh4xpzRJu6JAumemEhsd8)
====================================================================
```
