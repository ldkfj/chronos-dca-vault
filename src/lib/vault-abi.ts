import type { Abi } from "viem";
import vaultArtifact from "../../artifacts/RomeDcaLimitVault.json";

export const ROME_DCA_LIMIT_VAULT_ABI = vaultArtifact.abi as Abi;

export const AGGREGATOR_V3_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { internalType: "uint80", name: "roundId", type: "uint80" },
      { internalType: "int256", name: "answer", type: "int256" },
      { internalType: "uint256", name: "startedAt", type: "uint256" },
      { internalType: "uint256", name: "updatedAt", type: "uint256" },
      { internalType: "uint80", name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "description",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function pubkeyToBytes32(base58: string): `0x${string}` {
  const trimmed = base58.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase() as `0x${string}`;
  }
  const bytes: number[] = [0];
  for (let i = 0; i < trimmed.length; i++) {
    const charIndex = BASE58_ALPHABET.indexOf(trimmed[i]);
    if (charIndex < 0) {
      throw new Error(`Invalid Base58 character: ${trimmed[i]}`);
    }
    let carry = charIndex;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < trimmed.length && trimmed[i] === "1"; i++) {
    bytes.push(0);
  }
  const reversed = bytes.reverse();
  const padded = new Uint8Array(32);
  const start = Math.max(0, 32 - reversed.length);
  for (let i = 0; i < Math.min(32, reversed.length); i++) {
    padded[start + i] = reversed[reversed.length - Math.min(32, reversed.length) + i];
  }
  return (`0x` +
    Array.from(padded)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

export function bytes32ToPubkey(hex32: string): string {
  const clean = hex32.replace(/^0x/, "");
  if (clean.length !== 64) return hex32;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let output = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

/**
 * Derive a deterministic Rome Dual-Lane synthetic EVM sender address from a Solana pubkey
 */
export function deriveSyntheticEvmAddress(solanaPubkeyBase58: string): `0x${string}` {
  const b32 = pubkeyToBytes32(solanaPubkeyBase58).slice(2);
  return `0x${b32.slice(24, 64)}` as `0x${string}`;
}
