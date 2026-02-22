// test/WorkforceLogger.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hardhat + Mocha + ethers v6 — zero hardhat-ethers / hardhat-toolbox dep.
// Uses hre.network.provider (EIP-1193) + ethers.BrowserProvider.
// Run: npx hardhat test
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from "ethers";
import hre from "hardhat";
import assert from "node:assert/strict";

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = ethers.BrowserProvider;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = ethers.BaseContract & Record<string, any>;

// ─── ABI ──────────────────────────────────────────────────────────────────────

const ABI = [
  "event TaskCompleted(address indexed org, uint256 indexed taskId, uint256 indexed timestamp)",
  "event OrgRegistered(address indexed org, uint256 registeredAt)",
  "error NotRegisteredOrg(address caller)",
  "error AlreadyRegistered(address caller)",
  "function registerOrg() external",
  "function logTaskCompletion(uint256 taskId) external",
  "function isRegistered(address org) external view returns (bool)",
  "function totalLogged() external view returns (uint256)",
];

const IFACE = new ethers.Interface(ABI);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProvider(): Provider {
  return new ethers.BrowserProvider(
    hre.network.provider as ethers.Eip1193Provider,
  );
}

async function getSigner(provider: Provider, index: number) {
  const accounts = await provider.listAccounts();
  return provider.getSigner(accounts[index].address);
}

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + hex.replace(/-/g, ""));
}

async function deploy(signer: ethers.Signer): Promise<AnyContract> {
  const artifact = await hre.artifacts.readArtifact("WorkforceLogger");
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  return contract as AnyContract;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_ID_1 = hexToBigInt("550e8400e29b41d4a716446655440000");
const TASK_ID_2 = hexToBigInt("550e8400e29b41d4a716446655440001");

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("WorkforceLogger", function () {
  this.timeout(60_000);

  let provider: Provider;
  let owner:    ethers.JsonRpcSigner;
  let org1:     ethers.JsonRpcSigner;
  let org2:     ethers.JsonRpcSigner;
  let rando:    ethers.JsonRpcSigner;
  let contract: AnyContract;

  beforeEach(async function () {
    provider = makeProvider();
    [owner, org1, org2, rando] = await Promise.all([
      getSigner(provider, 0),
      getSigner(provider, 1),
      getSigner(provider, 2),
      getSigner(provider, 3),
    ]);
    contract = await deploy(owner);
  });

  // ── registerOrg() ──────────────────────────────────────────────────────────

  describe("registerOrg()", function () {
    it("sets isRegistered = true for the caller", async function () {
      assert.equal(await contract.isRegistered(await org1.getAddress()), false);
      await (await (contract.connect(org1) as AnyContract).registerOrg()).wait();
      assert.equal(await contract.isRegistered(await org1.getAddress()), true);
    });

    it("emits OrgRegistered event", async function () {
      const tx      = await (contract.connect(org1) as AnyContract).registerOrg();
      const receipt = await tx.wait();
      const eventTopic = IFACE.getEvent("OrgRegistered")!.topicHash;
      const log = receipt.logs.find(
        (l: ethers.Log) => l.topics[0] === eventTopic,
      );
      assert.ok(log, "OrgRegistered event not emitted");
      const parsed = IFACE.parseLog(log);
      assert.equal(
        parsed!.args.org.toLowerCase(),
        (await org1.getAddress()).toLowerCase(),
      );
    });

    it("allows two different orgs to register independently", async function () {
      await (await (contract.connect(org1) as AnyContract).registerOrg()).wait();
      await (await (contract.connect(org2) as AnyContract).registerOrg()).wait();
      assert.equal(await contract.isRegistered(await org1.getAddress()), true);
      assert.equal(await contract.isRegistered(await org2.getAddress()), true);
    });

    it("reverts AlreadyRegistered on double registration", async function () {
      // First registration — commit state
      const tx1 = await (contract.connect(org1) as AnyContract).registerOrg();
      await tx1.wait();
      // Confirm state is committed
      assert.equal(await contract.isRegistered(await org1.getAddress()), true);

      // Second registration — Hardhat reverts the broadcast immediately
      let reverted = false;
      try {
        const tx2 = await (contract.connect(org1) as AnyContract).registerOrg();
        await tx2.wait();
      } catch (err: unknown) {
        reverted = true;
        const data = (err as { data?: string }).data;
        if (data) {
          const parsed = IFACE.parseError(data);
          assert.ok(
            parsed?.name === "AlreadyRegistered",
            `Expected AlreadyRegistered, got: ${parsed?.name}`,
          );
        } else {
          const msg = (err as Error).message ?? "";
          assert.ok(
            msg.includes("AlreadyRegistered") || msg.includes("revert"),
            `Unexpected error: ${msg}`,
          );
        }
      }
      assert.ok(reverted, "expected a revert for double registration");
    });
  });

  // ── logTaskCompletion() ─────────────────────────────────────────────────────

  describe("logTaskCompletion(uint256 taskId)", function () {
    beforeEach(async function () {
      await (await (contract.connect(org1) as AnyContract).registerOrg()).wait();
    });

    it("emits TaskCompleted with correct org and taskId", async function () {
      const tx = await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_1);
      const receipt = await tx.wait();
      const eventTopic = IFACE.getEvent("TaskCompleted")!.topicHash;
      const log = receipt.logs.find(
        (l: ethers.Log) => l.topics[0] === eventTopic,
      );
      assert.ok(log, "TaskCompleted event not emitted");
      const parsed = IFACE.parseLog(log);
      assert.equal(
        parsed!.args.org.toLowerCase(),
        (await org1.getAddress()).toLowerCase(),
      );
      assert.equal(parsed!.args.taskId, TASK_ID_1);
    });

    it("increments totalLogged by 1 per call", async function () {
      assert.equal(await contract.totalLogged(), 0n);
      await (await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_1)).wait();
      assert.equal(await contract.totalLogged(), 1n);
      await (await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_2)).wait();
      assert.equal(await contract.totalLogged(), 2n);
    });

    it("accumulates totalLogged across multiple orgs", async function () {
      await (await (contract.connect(org2) as AnyContract).registerOrg()).wait();
      await (await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_1)).wait();
      await (await (contract.connect(org2) as AnyContract).logTaskCompletion(TASK_ID_2)).wait();
      await (await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_2)).wait();
      assert.equal(await contract.totalLogged(), 3n);
    });

    it("reverts NotRegisteredOrg for unregistered caller", async function () {
      let reverted = false;
      try {
        await (contract.connect(rando) as AnyContract).logTaskCompletion.estimateGas(TASK_ID_1);
      } catch (err: unknown) {
        reverted = true;
        const data = (err as { data?: string }).data;
        if (data) {
          const parsed = IFACE.parseError(data);
          assert.equal(parsed?.name, "NotRegisteredOrg");
        }
      }
      assert.ok(reverted, "expected a revert");
    });
  });

  // ── isRegistered() ─────────────────────────────────────────────────────────

  describe("isRegistered(address)", function () {
    it("returns false before registration", async function () {
      assert.equal(await contract.isRegistered(await rando.getAddress()), false);
    });

    it("returns true after registration", async function () {
      await (await (contract.connect(org1) as AnyContract).registerOrg()).wait();
      assert.equal(await contract.isRegistered(await org1.getAddress()), true);
    });
  });

  // ── Gas budgets ─────────────────────────────────────────────────────────────

  describe("gas budgets", function () {
    it("logTaskCompletion uses < 50,000 gas", async function () {
      // org1 must be registered first (this describe block has no nested beforeEach)
      await (await (contract.connect(org1) as AnyContract).registerOrg()).wait();
      const receipt = await (
        await (contract.connect(org1) as AnyContract).logTaskCompletion(TASK_ID_1)
      ).wait();
      assert.ok(receipt.gasUsed < 50_000n, `gasUsed=${receipt.gasUsed}`);
    });

    it("registerOrg uses < 60,000 gas", async function () {
      const receipt = await (
        await (contract.connect(org1) as AnyContract).registerOrg()
      ).wait();
      assert.ok(receipt.gasUsed < 60_000n, `gasUsed=${receipt.gasUsed}`);
    });
  });
});
