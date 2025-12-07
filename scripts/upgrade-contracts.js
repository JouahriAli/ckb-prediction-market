#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function upgradeContract(signer, oldOutPoint, contractPath, contractName) {
  console.log(`\n📤 Upgrading ${contractName}...`);

  // Load new contract binary
  const binary = fs.readFileSync(contractPath);
  console.log(`  New binary size: ${binary.length} bytes`);

  // Convert to hex
  const data = "0x" + binary.toString("hex");

  // Get lock script
  const lock = (await signer.getAddressObjs())[0].script;

  // Fetch the old cell to get its capacity
  const client = signer.client;
  const oldCell = await client.getCell(oldOutPoint);

  if (!oldCell) {
    throw new Error(`Old contract cell not found at ${oldOutPoint.txHash}:${oldOutPoint.index}`);
  }

  const oldCapacity = oldCell.cellOutput.capacity;
  console.log(`  Old capacity: ${Number(oldCapacity) / 100_000_000} CKB`);

  // Calculate needed capacity (8 bytes + lock + data)
  const capacityNeeded = BigInt(8 + 61 + binary.length) * BigInt(100_000_000);
  console.log(`  Capacity needed: ${Number(capacityNeeded) / 100_000_000} CKB`);

  // Build transaction that spends old cell and creates new one
  const tx = ccc.Transaction.from({
    inputs: [
      new ccc.CellInput(oldOutPoint, BigInt(0))
    ],
    outputs: [{
      capacity: capacityNeeded,
      lock
    }],
    outputsData: [data]
  });

  // Complete transaction
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  // Send
  const txHash = await signer.sendTransaction(tx);
  console.log(`  ✅ TX Hash: ${txHash}`);

  // Calculate data hash (this is the code_hash for the contract)
  const dataHash = ccc.hashCkb(binary);

  // Handle both string and Uint8Array return types
  let codeHash;
  if (typeof dataHash === "string") {
    codeHash = dataHash.startsWith("0x") ? dataHash : "0x" + dataHash;
  } else {
    codeHash = "0x" + Array.from(dataHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  return {
    txHash,
    codeHash,
    outPoint: {
      txHash,
      index: "0x0"
    }
  };
}

async function main() {
  console.log("=== Upgrading Contracts (Reusing Existing Cells) ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not in .env");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`Address: ${address}`);
  console.log(`Balance: ${Number(balance) / 100_000_000} CKB\n`);

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.market || !deployed.token) {
    console.error("❌ Contracts not deployed yet");
    process.exit(1);
  }

  // Upgrade market contract
  const marketOutPoint = new ccc.OutPoint(
    deployed.market.txHash,
    deployed.market.outPoint.index
  );

  const marketInfo = await upgradeContract(
    signer,
    marketOutPoint,
    path.join(__dirname, "../contracts/market/build/market"),
    "Market Contract"
  );

  // Wait a bit between upgrades
  await new Promise(r => setTimeout(r, 3000));

  // Upgrade token contract
  const tokenOutPoint = new ccc.OutPoint(
    deployed.token.txHash,
    deployed.token.outPoint.index
  );

  const tokenInfo = await upgradeContract(
    signer,
    tokenOutPoint,
    path.join(__dirname, "../contracts/market-token/build/market-token"),
    "Token Contract"
  );

  // Update deployment info
  deployed.market = {
    ...marketInfo,
    upgradedAt: new Date().toISOString(),
    previousVersion: deployed.market.txHash
  };

  deployed.token = {
    ...tokenInfo,
    upgradedAt: new Date().toISOString(),
    previousVersion: deployed.token.txHash
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("\n✅ Upgrade complete!");
  console.log("Info saved to: deployed.json");
  console.log("\n⚠️  IMPORTANT: You need to create a NEW market cell!");
  console.log("The old market cell uses the old contract code hash.");
  console.log("Run: node create-market.js");
}

main().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
