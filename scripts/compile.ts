import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const rootDir = process.cwd();
const contractsDir = path.join(rootDir, "contracts");
const artifactsDir = path.join(rootDir, "artifacts");

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(contractsDir, relPath), "utf8");
}

export function compileContracts() {
  const input = {
    language: "Solidity",
    sources: {
      "interfaces/IRomePrecompiles.sol": {
        content: readSource("interfaces/IRomePrecompiles.sol"),
      },
      "RomeDcaLimitVault.sol": {
        content: readSource("RomeDcaLimitVault.sol"),
      },
      "mocks/MockPrecompiles.sol": {
        content: readSource("mocks/MockPrecompiles.sol"),
      },
    },
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      metadata: {
        bytecodeHash: "none",
        appendCBOR: false,
      },
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const errors = output.errors.filter((e: { severity: string }) => e.severity === "error");
    for (const msg of output.errors) {
      console.log(msg.formattedMessage);
    }
    if (errors.length > 0) {
      throw new Error(`Solidity compilation failed with ${errors.length} error(s).`);
    }
  }

  fs.mkdirSync(artifactsDir, { recursive: true });

  const compiled: Record<
    string,
    { abi: unknown[]; bytecode: `0x${string}`; deployedBytecode: `0x${string}` }
  > = {};

  for (const [fileName, fileContracts] of Object.entries(output.contracts)) {
    for (const [contractName, contractData] of Object.entries(
      fileContracts as Record<string, any>
    )) {
      const artifact = {
        contractName,
        sourceName: fileName,
        abi: contractData.abi,
        bytecode: `0x${contractData.evm.bytecode.object}` as `0x${string}`,
        deployedBytecode: `0x${contractData.evm.deployedBytecode.object}` as `0x${string}`,
      };
      fs.writeFileSync(
        path.join(artifactsDir, `${contractName}.json`),
        JSON.stringify(artifact, null, 2)
      );
      compiled[contractName] = artifact;
    }
  }

  return compiled;
}

if (process.argv[1]?.endsWith("compile.ts")) {
  const res = compileContracts();
  console.log(
    `Compiled ${Object.keys(res).length} contracts successfully:`,
    Object.keys(res)
      .map((k) => `${k} (${(res[k].bytecode.length - 2) / 2} bytes)`)
      .join(", ")
  );
}
