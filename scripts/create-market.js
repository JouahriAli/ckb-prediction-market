#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function createMarket() {
  console.log("=== Creating Market Cell ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not in .env");
    process.exit(1);
  }

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.market) {
    console.error("❌ Market contract not deployed yet");
    process.exit(1);
  }

  if (!deployed.alwaysSuccess) {
    console.error("❌ Always-success lock not deployed yet");
    console.error("Run: node scripts/deploy-always-success.js");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`Address: ${address}`);
  console.log(`Balance: ${Number(balance) / 100_000_000} CKB\n`);

  // Load always-success lock binary and create lock script
  const alwaysSuccessBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/always-success/build/always-success")
  );
  const alwaysSuccessDataHash = ccc.hashCkb(alwaysSuccessBinary);

  // Convert data hash to hex string
  let alwaysSuccessCodeHash;
  if (typeof alwaysSuccessDataHash === "string") {
    alwaysSuccessCodeHash = alwaysSuccessDataHash.startsWith("0x")
      ? alwaysSuccessDataHash
      : "0x" + alwaysSuccessDataHash;
  } else {
    alwaysSuccessCodeHash = "0x" + Array.from(alwaysSuccessDataHash)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Create always-success lock script (allows anyone to spend)
  const lock = new ccc.Script(
    alwaysSuccessCodeHash,
    "data2",
    "0x"
  );

  console.log(`Using always-success lock: ${alwaysSuccessCodeHash}`);
  console.log("⚠️  Anyone can spend this cell!\n");

  // Get deployed market contract data hash
  const marketTxHash = deployed.market.txHash;
  console.log(`Market contract TX: ${marketTxHash}`);

  // Fetch the transaction to get the data hash
  const marketTx = await client.getTransaction(marketTxHash);
  if (!marketTx) {
    console.error("❌ Market deployment transaction not found");
    process.exit(1);
  }

  // The data hash is the hash of the outputsData[0]
  const marketBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market/build/market")
  );
  const dataHash = ccc.hashCkb(marketBinary);

  // dataHash is already a Uint8Array, convert to hex properly
  let codeHash;
  if (typeof dataHash === "string") {
    codeHash = dataHash.startsWith("0x") ? dataHash : "0x" + dataHash;
  } else {
    // It's a Uint8Array
    codeHash = "0x" + Array.from(dataHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  console.log(`Market code hash: ${codeHash}`);

  // Create market type script
  const marketTypeScript = new ccc.Script(
    codeHash,
    "data2",  // hash_type
    "0x"      // args (empty for now)
  );

  // Create initial market data
  // Format: yes_supply(16) + no_supply(16) + resolved(1) + outcome(1) = 34 bytes
  const yesSupply = BigInt(0);
  const noSupply = BigInt(0);
  const resolved = 0;
  const outcome = 0;

  // Convert to little-endian bytes
  const buffer = Buffer.alloc(34);
  // yes_supply (u128 LE)
  buffer.writeBigUInt64LE(yesSupply & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buffer.writeBigUInt64LE(yesSupply >> BigInt(64), 8);
  // no_supply (u128 LE)
  buffer.writeBigUInt64LE(noSupply & BigInt("0xFFFFFFFFFFFFFFFF"), 16);
  buffer.writeBigUInt64LE(noSupply >> BigInt(64), 24);
  // resolved and outcome
  buffer.writeUInt8(resolved, 32);
  buffer.writeUInt8(outcome, 33);

  const marketData = "0x" + buffer.toString("hex");
  console.log(`Market data: ${marketData}`);

  // Calculate capacity needed (8 + lock + type + data)
  // Lock script: 32 (code_hash) + 1 (hash_type) + 4 (args length prefix) = 37 bytes (empty args)
  // Type script: 32 (code_hash) + 1 (hash_type) + 4 (args length prefix) = 37 bytes (empty args)
  // Data: 34 bytes
  // Total occupied bytes: 8 (capacity) + 37 + 37 + 34 = 116 bytes
  // Minimum capacity: 116 CKB
  const capacityNeeded = BigInt(116) * BigInt(100_000_000);
  console.log(`Capacity needed: ${Number(capacityNeeded) / 100_000_000} CKB\n`);

  // Build transaction
  const tx = ccc.Transaction.from({
    outputs: [{
      capacity: capacityNeeded,
      lock,
      type: marketTypeScript
    }],
    outputsData: [marketData]
  });

  // Add cell dep for the market contract
  tx.cellDeps.push(new ccc.CellDep(
    new ccc.OutPoint(marketTxHash, 0),
    "code"
  ));

  // Add cell dep for the always-success lock contract
  const alwaysSuccessTxHash = deployed.alwaysSuccess.txHash;
  tx.cellDeps.push(new ccc.CellDep(
    new ccc.OutPoint(alwaysSuccessTxHash, 0),
    "code"
  ));

  // Complete transaction
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log("📤 Creating market cell...");
  const txHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Market cell created!`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`\nMarket cell OutPoint:`);
  console.log(`  txHash: ${txHash}`);
  console.log(`  index: 0x0`);

  // Save market info
  deployed.marketCell = {
    txHash,
    outPoint: {
      txHash,
      index: "0x0"
    },
    typeScript: {
      codeHash,
      hashType: "data2",
      args: "0x"
    },
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("\n✅ Market info saved to deployed.json");
}

createMarket().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
