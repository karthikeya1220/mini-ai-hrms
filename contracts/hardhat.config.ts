import { HardhatUserConfig } from "hardhat/config";
// ─────────────────────────────────────────────────────────────────────────────
// Hardhat configuration — WorkforceLogger
//
// Node version compatibility note
// ────────────────────────────────
// Hardhat 2.x plugins (@nomicfoundation/hardhat-toolbox, hardhat-ethers, etc.)
// use extension-less internal imports (e.g. `require("hardhat/types/config")`)
// that are rejected by Node ≥ 22's strict ESM resolver. No plugins are
// imported here to keep compilation and testing working on Node 24.
//
// Networks configured
// ───────────────────
// Local      : hardhat (in-process)  |  localhost (external node)
// Polygon    : mumbai  (⚠ DEPRECATED, chain 80001 — public RPCs down)
//              amoy    (✅ ACTIVE testnet, chain 80002 — use this)
//              polygon (mainnet, chain 137)
// Ethereum   : sepolia (testnet)  |  mainnet
//
// Environment variables (set in contracts/.env — see .env.example)
// ─────────────────────────────────────────────────────────────────
//   DEPLOYER_PRIVATE_KEY     Private key of the deployer wallet (0x-prefixed)
//
//   MUMBAI_RPC_URL           Polygon Mumbai RPC  (⚠ deprecated — kept for ref)
//   AMOY_RPC_URL             Polygon Amoy  RPC   (active testnet)
//   POLYGON_RPC_URL          Polygon mainnet RPC
//   SEPOLIA_RPC_URL          Ethereum Sepolia RPC
//   MAINNET_RPC_URL          Ethereum mainnet RPC
//
//   POLYGONSCAN_API_KEY      For contract verification on Polygonscan
//   ETHERSCAN_API_KEY        For contract verification on Etherscan
// ─────────────────────────────────────────────────────────────────────────────

// Load .env manually (ts-node CJS context — dotenv require works fine here)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
} catch {
  // dotenv not installed or .env absent — env vars must be set by the shell
}

// ─── Resolves DEPLOYER_PRIVATE_KEY ───────────────────────────────────────────
// If the key is absent we fall back to Hardhat's built-in account #0.
// This key has no real funds on any network — safe for local dev only.
const PRIVATE_KEY: string =
  process.env.DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ─── Config ──────────────────────────────────────────────────────────────────

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        // 200 = standard trade-off: cheaper deployment, slightly more expensive calls.
        // Raise to 1000+ if this contract will be called millions of times.
        runs: 200,
      },
    },
  },

  // ── Networks ───────────────────────────────────────────────────────────────

  networks: {
    // ── Local ──────────────────────────────────────────────────────────────

    /** In-process Hardhat node. Used by `npx hardhat test`. */
    hardhat: {
      chainId: 31337,
    },

    /**
     * External Hardhat node.
     * Start it with:  npx hardhat node
     * Then deploy:    npm run deploy
     */
    localhost: {
      url:     "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // ── Polygon testnets ───────────────────────────────────────────────────

    /**
     * ⚠  Polygon Mumbai — DEPRECATED (April 2024).
     *    Use `amoy` instead. Kept here for reference / legacy tooling.
     *    Public RPCs (maticvigil, infura) are no longer reliable.
     *    Chain ID : 80001
     *    Faucet   : https://faucet.polygon.technology  (may be unavailable)
     *    Explorer : https://mumbai.polygonscan.com
     */
    mumbai: {
      url:      process.env.MUMBAI_RPC_URL ?? "https://rpc-mumbai.maticvigil.com",
      accounts: [PRIVATE_KEY],
      chainId:  80_001,
      // Gas settings — Mumbai had a fixed 30 gwei base fee before shutdown
      gasPrice: 30_000_000_000,  // 30 gwei (static; estimateGas may fail on dead RPCs)
    },

    /**
     * ✅ Polygon Amoy — ACTIVE testnet (replacement for Mumbai).
     *    Chain ID : 80002
     *    Faucet   : https://faucet.polygon.technology
     *    Explorer : https://amoy.polygonscan.com
     *    RPC docs : https://wiki.polygon.technology/docs/pos/reference/rpc-endpoints
     *
     *    Recommended free RPCs (set via env var):
     *      https://rpc-amoy.polygon.technology          (official, rate-limited)
     *      https://polygon-amoy.g.alchemy.com/v2/<key> (Alchemy free tier)
     *      https://polygon-amoy.infura.io/v3/<key>     (Infura free tier)
     */
    amoy: {
      url:      process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology",
      accounts: [PRIVATE_KEY],
      chainId:  80_002,
      // Amoy is an EIP-1559 network; gas estimation is handled per-tx by ethers.
      // Override gasPrice here only if transactions consistently fail as underpriced:
      //   gasPrice: 50_000_000_000,  // 50 gwei
    },

    // ── Polygon mainnet ────────────────────────────────────────────────────

    /**
     * Polygon PoS mainnet.
     * Chain ID : 137
     * Explorer : https://polygonscan.com
     */
    polygon: {
      url:      process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com",
      accounts: [PRIVATE_KEY],
      chainId:  137,
    },

    // ── Ethereum ───────────────────────────────────────────────────────────

    /** Ethereum Sepolia testnet. Chain ID : 11155111 */
    sepolia: {
      url:      process.env.SEPOLIA_RPC_URL ?? "https://rpc.ankr.com/eth_sepolia",
      accounts: [PRIVATE_KEY],
      chainId:  11_155_111,
    },

    /** Ethereum mainnet. Chain ID : 1 */
    mainnet: {
      url:      process.env.MAINNET_RPC_URL ?? "https://rpc.ankr.com/eth",
      accounts: [PRIVATE_KEY],
      chainId:  1,
    },
  },

  // ── Paths ──────────────────────────────────────────────────────────────────

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
