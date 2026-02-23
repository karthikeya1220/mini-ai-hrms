// scripts/deploy.ts
// =============================================================================
// Deploy WorkforceLogger to any configured Hardhat network.
//
// Usage
// ─────
//   # 1. Compile first (always)
//   npm run compile
//
//   # 2a. Local Hardhat node (must already be running: npx hardhat node)
//   npm run deploy
//   # equivalent: npx hardhat run scripts/deploy.ts --network localhost
//
//   # 2b. Polygon Mumbai  ⚠ DEPRECATED — public RPCs are down.
//   #     Use amoy instead. Kept here for reference.
//   npx hardhat run scripts/deploy.ts --network mumbai
//
//   # 2c. Polygon Amoy  ✅ ACTIVE testnet
//   npm run deploy:amoy
//   # equivalent: npx hardhat run scripts/deploy.ts --network amoy
//   #
//   # Prerequisites for Amoy:
//   #   1. Set DEPLOYER_PRIVATE_KEY in contracts/.env
//   #   2. Set AMOY_RPC_URL in contracts/.env  (Alchemy/Infura recommended)
//   #   3. Fund the wallet with test MATIC from https://faucet.polygon.technology
//
//   # 2d. Polygon mainnet
//   npx hardhat run scripts/deploy.ts --network polygon
//
//   # 2e. Ethereum Sepolia
//   npm run deploy:sepolia
//
// Implementation note
// ────────────────────
// This script intentionally avoids `import { ethers } from "hardhat"` which
// requires @nomicfoundation/hardhat-ethers — a plugin incompatible with
// Node ≥ 22's ESM resolver when used with Hardhat 2.x. Instead we use:
//   • hre.network.provider  — the EIP-1193 provider Hardhat always exposes
//   • ethers.BrowserProvider — wraps it into a standard ethers v6 provider
//   • hre.artifacts          — loads compiled ABI + bytecode from disk
// =============================================================================

import hre from "hardhat";
import { ethers } from "ethers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a bigint wei value as a human-readable MATIC/ETH string. */
function fmt(wei: bigint, decimals = 18): string {
    const s = wei.toString().padStart(decimals + 1, "0");
    const intPart = s.slice(0, s.length - decimals) || "0";
    const fracPart = s.slice(s.length - decimals, s.length - decimals + 6);
    return `${intPart}.${fracPart}`;
}

/** Resolve a human-readable network name from chainId. */
function chainName(chainId: bigint): string {
    const map: Record<string, string> = {
        "1": "Ethereum Mainnet",
        "31337": "Hardhat / Localhost",
        "80001": "Polygon Mumbai ⚠ (deprecated)",
        "80002": "Polygon Amoy ✅",
        "137": "Polygon Mainnet",
        "11155111": "Ethereum Sepolia",
    };
    return map[chainId.toString()] ?? `unknown (chainId ${chainId})`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    // ── 1. Bootstrap provider from Hardhat's in-process EIP-1193 provider ───────
    //    Works for both the in-process network and remote networks configured
    //    in hardhat.config.ts — the provider automatically uses the JSON-RPC
    //    settings (url, accounts) from the active --network flag.
    const provider = new ethers.BrowserProvider(
        hre.network.provider as ethers.Eip1193Provider,
    );

    const network = await provider.getNetwork();
    const accounts = await provider.listAccounts();

    if (accounts.length === 0) {
        console.error(
            "✗  No accounts found.\n" +
            "   For live networks, ensure DEPLOYER_PRIVATE_KEY is set in contracts/.env",
        );
        process.exit(1);
    }

    const deployer = await provider.getSigner(accounts[0].address);
    const balance = await provider.getBalance(await deployer.getAddress());

    console.log("=".repeat(64));
    console.log("  WorkforceLogger — Deploy");
    console.log("=".repeat(64));
    console.log(`  Network   : ${chainName(network.chainId)}`);
    console.log(`  Chain ID  : ${network.chainId}`);
    console.log(`  Deployer  : ${await deployer.getAddress()}`);
    console.log(`  Balance   : ${fmt(balance)} (native token)`);
    console.log();

    // ── Safety guard for mainnet ──────────────────────────────────────────────
    if (network.chainId === 1n || network.chainId === 137n) {
        if (process.env.ALLOW_MAINNET_DEPLOY !== "true") {
            console.error(
                "✗  Mainnet deploy blocked.\n" +
                "   Set ALLOW_MAINNET_DEPLOY=true in your environment to override.",
            );
            process.exit(1);
        }
        console.warn("⚠  MAINNET DEPLOY — proceeding (ALLOW_MAINNET_DEPLOY=true)");
        console.log();
    }

    // ── Fund check ───────────────────────────────────────────────────────────
    //    Refuse to deploy if the wallet has no balance on a live network.
    if (network.chainId !== 31337n && balance === 0n) {
        const faucetMap: Record<string, string> = {
            "80001": "https://faucet.polygon.technology  (Mumbai — may be unavailable)",
            "80002": "https://faucet.polygon.technology  (Amoy)",
            "11155111": "https://sepoliafaucet.com",
        };
        const faucet = faucetMap[network.chainId.toString()] ?? "a public faucet";
        console.error(
            `✗  Deployer wallet has 0 balance on ${chainName(network.chainId)}.\n` +
            `   Fund it at: ${faucet}`,
        );
        process.exit(1);
    }

    // ── 2. Load artifact from disk (compiled by: npm run compile) ────────────
    const artifact = await hre.artifacts.readArtifact("WorkforceLogger");

    // ── 3. Deploy ─────────────────────────────────────────────────────────────
    console.log("Deploying WorkforceLogger…");
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy();
    const deployTx = contract.deploymentTransaction();

    console.log(`  Tx sent   : ${deployTx?.hash ?? "—"}`);
    console.log("  Waiting for confirmation…");

    // Wait for 1 confirmation on testnets, 2 on mainnets
    const confirms = (network.chainId === 1n || network.chainId === 137n) ? 2 : 1;
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();

    console.log();
    console.log(`✓ WorkforceLogger deployed`);
    console.log(`  Address   : ${contractAddress}`);
    console.log(`  Tx hash   : ${deployTx?.hash ?? "—"}`);

    // Print block explorer link for known chains
    const explorerMap: Record<string, string> = {
        "80001": `https://mumbai.polygonscan.com/address/${contractAddress}`,
        "80002": `https://amoy.polygonscan.com/address/${contractAddress}`,
        "137": `https://polygonscan.com/address/${contractAddress}`,
        "11155111": `https://sepolia.etherscan.io/address/${contractAddress}`,
        "1": `https://etherscan.io/address/${contractAddress}`,
    };
    const explorerUrl = explorerMap[network.chainId.toString()];
    if (explorerUrl) {
        console.log(`  Explorer  : ${explorerUrl}`);
    }
    console.log();

    // ── 4. Post-deploy smoke test: emit a TaskCompleted event ────────────────
    //    Calls logTaskCompletion(0) to confirm the contract is live + callable.
    //    Uses taskId=0 (a sentinel value — safe for smoke tests only).
    console.log("Smoke test: calling logTaskCompletion(0)…");
    const smokeTx = await (contract as ethers.BaseContract & {
        logTaskCompletion(taskId: bigint): Promise<ethers.ContractTransactionResponse>;
    }).logTaskCompletion(0n);
    await smokeTx.wait(confirms);

    console.log(`✓ logTaskCompletion(0) → tx: ${smokeTx.hash}`);
    console.log();

    // ── 5. Output env-var block to copy-paste ──────────────────────────────────
    console.log("=".repeat(64));
    console.log("  Copy these into server/.env (or your CI secrets):");
    console.log("=".repeat(64));
    console.log(`  WORKFORCE_LOGGER_ADDRESS=${contractAddress}`);
    console.log(`  WEB3_RPC_URL=${(hre.network.config as { url?: string }).url ?? "http://127.0.0.1:8545"}`);
    console.log("=".repeat(64));
    console.log();

    // ── 6. Polygonscan verification hint ──────────────────────────────────────
    if (["80001", "80002", "137"].includes(network.chainId.toString())) {
        console.log("To verify the contract on Polygonscan:");
        console.log(
            `  npx hardhat verify --network ${hre.network.name} ${contractAddress}`,
        );
        console.log(
            "  (Requires @nomicfoundation/hardhat-verify and POLYGONSCAN_API_KEY in .env)",
        );
        console.log();
    }
}

main().catch((err) => {
    console.error("\n✗ Deploy failed:", err.message ?? err);
    process.exitCode = 1;
});
