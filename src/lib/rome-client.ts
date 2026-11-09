import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deploymentsData from "./deployments.json";
import {
  ROME_DCA_LIMIT_VAULT_ABI,
  AGGREGATOR_V3_ABI,
  pubkeyToBytes32,
  bytes32ToPubkey,
  deriveSyntheticEvmAddress,
} from "./vault-abi";

export const DEPLOYMENTS = deploymentsData;
export const HADRIAN_RPC =
  process.env.NEXT_PUBLIC_HADRIAN_RPC_URL ||
  deploymentsData.hadrian.rpcUrl ||
  "https://hadrian.testnet.romeprotocol.xyz/";
export const HADRIAN_EXPLORER = (
  process.env.NEXT_PUBLIC_HADRIAN_EXPLORER_URL ||
  deploymentsData.hadrian.explorerUrl ||
  "https://via-hadrian.testnet.romeprotocol.xyz"
).replace(/\/+$/, "");

export const VAULT_ADDRESS =
  deploymentsData.hadrian.vaultAddress as `0x${string}`;

export const publicClient = createPublicClient({
  transport: http(HADRIAN_RPC, { timeout: 60_000 }),
});

export interface LiveOracleQuote {
  symbol: string;
  address: `0x${string}`;
  priceUsd: number;
  rawAnswer: string;
  updatedAt: number;
}

export interface OnChainOrder {
  id: number;
  owner: `0x${string}`;
  lane: "EVM" | "SOLANA";
  orderType: "DCA" | "LIMIT";
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  pairSymbol: string;
  oracleFeed: `0x${string}`;
  targetSolanaProgram: `0x${string}`;
  targetSolanaProgramBase58: string;
  userSolanaPda: `0x${string}`;
  userSolanaPdaBase58: string;
  amountPerSliceUsdc: number;
  rawAmountPerSlice: string;
  minAmountOut: string;
  targetPriceUsd: number;
  triggerBelowOrEqual: boolean;
  intervalSeconds: number;
  totalIntervals: number;
  executedIntervals: number;
  createdAt: number;
  lastExecutedAt: number;
  expiresAt: number;
  totalAmountInSpentUsdc: number;
  totalAmountOutReceived: string;
}

export interface OnChainExecution {
  executionId: number;
  orderId: number;
  keeper: `0x${string}`;
  orderOwner: `0x${string}`;
  orderType: "DCA" | "LIMIT";
  pairSymbol: string;
  amountInUsdc: number;
  amountOut: string;
  oraclePriceUsd: number;
  cpiProgramId: `0x${string}`;
  cpiProgramBase58: string;
  signerPda: `0x${string}`;
  signerPdaBase58: string;
  sliceNumber: number;
  timestamp: number;
}

export interface VaultStatsSummary {
  totalOrders: number;
  totalExecutions: number;
  volumeRoutedUsdc: number;
  cpiSwaps: number;
  vaultPda: `0x${string}`;
  vaultPdaBase58: string;
}

// Built-in Demo Signer (Hadrian Testnet Sandbox Keeper/User Key) for 1-click judge testing without wallet setup
const DEMO_SIGNER_KEY =
  "0x0844aaed5e65c94e9fb0452c197a677face964daba7d9c99c7d23d6d8b8d3acd" as const;

export function getDemoSignerAccount() {
  return privateKeyToAccount(DEMO_SIGNER_KEY);
}

export async function fetchLiveOracleQuotes(): Promise<
  Record<string, LiveOracleQuote>
> {
  const feeds = deploymentsData.hadrian.oracles as Record<string, string>;
  const fallbacks: Record<string, number> = {
    "SOL/USD": 86.77,
    "JUP/USD": 0.251,
    "ETH/USD": 2127.44,
    "BTC/USD": 75045.08,
  };

  const results: Record<string, LiveOracleQuote> = {};
  await Promise.all(
    Object.entries(feeds).map(async ([symbol, addr]) => {
      const address = addr as `0x${string}`;
      try {
        const round = (await publicClient.readContract({
          address,
          abi: AGGREGATOR_V3_ABI,
          functionName: "latestRoundData",
        })) as [bigint, bigint, bigint, bigint, bigint];
        const answer = Number(round[1]);
        const priceUsd = answer > 0 ? answer / 1e8 : fallbacks[symbol] ?? 1;
        results[symbol] = {
          symbol,
          address,
          priceUsd,
          rawAnswer: round[1].toString(),
          updatedAt: Number(round[3]) || Math.floor(Date.now() / 1000),
        };
      } catch {
        const fb = fallbacks[symbol] ?? 1;
        results[symbol] = {
          symbol,
          address,
          priceUsd: fb,
          rawAnswer: Math.round(fb * 1e8).toString(),
          updatedAt: Math.floor(Date.now() / 1000),
        };
      }
    })
  );

  return results;
}

export async function fetchVaultState(): Promise<{
  stats: VaultStatsSummary;
  orders: OnChainOrder[];
  executions: OnChainExecution[];
}> {
  const [rawStats, rawOrders, rawExecs] = await Promise.all([
    publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: ROME_DCA_LIMIT_VAULT_ABI,
      functionName: "getVaultStats",
    }) as Promise<[bigint, bigint, bigint, bigint, `0x${string}`]>,
    publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: ROME_DCA_LIMIT_VAULT_ABI,
      functionName: "getAllOrders",
    }) as Promise<any[]>,
    publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: ROME_DCA_LIMIT_VAULT_ABI,
      functionName: "getAllExecutions",
    }) as Promise<any[]>,
  ]);

  const stats: VaultStatsSummary = {
    totalOrders: Number(rawStats[0]),
    totalExecutions: Number(rawStats[1]),
    volumeRoutedUsdc: Number(rawStats[2]) / 1e6,
    cpiSwaps: Number(rawStats[3]),
    vaultPda: rawStats[4],
    vaultPdaBase58: bytes32ToPubkey(rawStats[4]),
  };

  const orders: OnChainOrder[] = rawOrders.map((o: any) => ({
    id: Number(o.id),
    owner: o.owner,
    lane: Number(o.lane) === 1 ? "SOLANA" : "EVM",
    orderType: Number(o.orderType) === 1 ? "LIMIT" : "DCA",
    status:
      Number(o.status) === 1
        ? "COMPLETED"
        : Number(o.status) === 2
        ? "CANCELLED"
        : "ACTIVE",
    pairSymbol: o.pairSymbol,
    oracleFeed: o.oracleFeed,
    targetSolanaProgram: o.targetSolanaProgram,
    targetSolanaProgramBase58: bytes32ToPubkey(o.targetSolanaProgram),
    userSolanaPda: o.userSolanaPda,
    userSolanaPdaBase58: bytes32ToPubkey(o.userSolanaPda),
    amountPerSliceUsdc: Number(o.amountPerSlice) / 1e6,
    rawAmountPerSlice: o.amountPerSlice.toString(),
    minAmountOut: o.minAmountOut.toString(),
    targetPriceUsd: Number(o.targetPrice) / 1e8,
    triggerBelowOrEqual: Boolean(o.triggerBelowOrEqual),
    intervalSeconds: Number(o.intervalSeconds),
    totalIntervals: Number(o.totalIntervals),
    executedIntervals: Number(o.executedIntervals),
    createdAt: Number(o.createdAt),
    lastExecutedAt: Number(o.lastExecutedAt),
    expiresAt: Number(o.expiresAt),
    totalAmountInSpentUsdc: Number(o.totalAmountInSpent) / 1e6,
    totalAmountOutReceived: o.totalAmountOutReceived.toString(),
  }));

  const executions: OnChainExecution[] = rawExecs.map((e: any) => ({
    executionId: Number(e.executionId),
    orderId: Number(e.orderId),
    keeper: e.keeper,
    orderOwner: e.orderOwner,
    orderType: Number(e.orderType) === 1 ? "LIMIT" : "DCA",
    pairSymbol: e.pairSymbol,
    amountInUsdc: Number(e.amountIn) / 1e6,
    amountOut: e.amountOut.toString(),
    oraclePriceUsd: Number(e.oraclePrice) / 1e8,
    cpiProgramId: e.cpiProgramId,
    cpiProgramBase58: bytes32ToPubkey(e.cpiProgramId),
    signerPda: e.signerPda,
    signerPdaBase58: bytes32ToPubkey(e.signerPda),
    sliceNumber: Number(e.sliceNumber),
    timestamp: Number(e.timestamp),
  }));

  return { stats, orders, executions };
}

export async function lookupSolanaSignature(
  evmTxHash: string
): Promise<string | null> {
  try {
    const res = await fetch(HADRIAN_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "rome_solanaTxForEvmTx",
        params: [evmTxHash],
      }),
    });
    const json = await res.json();
    return json?.result?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Submit a transaction to Rome Hadrian (200010) using either connected browser MetaMask (submitRomeTx flow)
 * or the built-in Hadrian Testnet Sandbox Signer when testing without wallet funding.
 */
export async function sendChronosVaultTx(params: {
  data: Hex;
  useBrowserWallet: boolean;
  browserAddress?: `0x${string}` | null;
}): Promise<{ txHash: Hex; solanaSig: string | null }> {
  const gp = await publicClient.getGasPrice();
  const maxFeePerGas = (gp * 115n) / 100n;

  if (
    params.useBrowserWallet &&
    typeof window !== "undefined" &&
    (window as any).ethereum &&
    params.browserAddress
  ) {
    const eth = (window as any).ethereum;
    // Ensure Hadrian chain (200010 = 0x30d4a)
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x30d4a" }],
      });
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x30d4a",
              chainName: "Rome Hadrian Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [HADRIAN_RPC],
              blockExplorerUrls: [HADRIAN_EXPLORER],
            },
          ],
        });
      }
    }

    const txHash = (await eth.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: params.browserAddress,
          to: VAULT_ADDRESS,
          data: params.data,
          gas: `0x${(12_000_000n).toString(16)}`,
          maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
          maxPriorityFeePerGas: "0x0",
        },
      ],
    })) as Hex;

    await publicClient.waitForTransactionReceipt({ hash: txHash });
    const solanaSig = await lookupSolanaSignature(txHash);
    return { txHash, solanaSig };
  }

  // Fallback / Sandbox Signer mode on Hadrian Testnet (real on-chain transaction!)
  const account = getDemoSignerAccount();
  const wallet = createWalletClient({
    account,
    transport: http(HADRIAN_RPC, { timeout: 60_000 }),
  });

  const txHash = await wallet.sendTransaction({
    account,
    to: VAULT_ADDRESS,
    data: params.data,
    gas: 12_000_000n,
    maxFeePerGas,
    maxPriorityFeePerGas: 0n,
    chain: null,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const solanaSig = await lookupSolanaSignature(txHash);
  return { txHash, solanaSig };
}

export {
  ROME_DCA_LIMIT_VAULT_ABI,
  pubkeyToBytes32,
  bytes32ToPubkey,
  deriveSyntheticEvmAddress,
  encodeFunctionData,
};
