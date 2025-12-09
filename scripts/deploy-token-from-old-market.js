#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployToken() {
  console.log("=== Deploying Token Contract (using old market cell CKB) ===\n");

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

  // Check if old market cell exists
  const oldMarketTxHash = "0xa1553aad7c9e70150e363af658a1e27b2e77cda97091be509592fa06776ac4cb";
  console.log(`Checking old market cell: ${oldMarketTxHash}:0`);

  const oldMarketCell = await client.getCellLive({
    txHash: oldMarketTxHash,
    index: 0
  });

  if (!oldMarketCell) {
    console.error("❌ Old market cell not found or already spent");
    process.exit(1);
  }

  console.log(`✅ Old market cell found with ${Number(oldMarketCell.cellOutput.capacity) / 100_000_000} CKB\n`);

  // Read token contract binary
  const tokenBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market-token/build/market-token")
  );
  const tokenHex = "0x" + tokenBinary.toString("hex");
  const tokenDataHash = ccc.hashCkb(tokenBinary);

  let tokenCodeHash;
  if (typeof tokenDataHash === "string") {
    tokenCodeHash = tokenDataHash.startsWith("0x")
      ? tokenDataHash
      : "0x" + tokenDataHash;
  } else {
    tokenCodeHash = "0x" + Array.from(tokenDataHash)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  console.log(`Token contract size: ${tokenBinary.length} bytes`);
  console.log(`Token code hash: ${tokenCodeHash}\n`);

  // Get user's lock script
  const userLock = (await signer.getAddressObjs())[0].script;

  // Calculate capacity for token contract deployment
  const tokenCapacity = BigInt(61 + 8 + tokenBinary.length) * BigInt(100_000_000);

  console.log(`Token contract deployment needs: ${Number(tokenCapacity) / 100_000_000} CKB`);
  console.log(`Old market cell has: ${Number(oldMarketCell.cellOutput.capacity) / 100_000_000} CKB\n`);

  // Build transaction:
  // Input: old market cell
  // Outputs: 1) new token contract cell, 2) change back to user
  const tx = ccc.Transaction.from({
    inputs: [{
      previousOutput: {
        txHash: oldMarketTxHash,
        index: BigInt(0)
      }
    }],
    outputs: [
      // Token contract deployment
      {
        capacity: tokenCapacity,
        lock: userLock
      }
    ],
    outputsData: [tokenHex]
  });

  // Add cell deps for user's lock
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

  // Complete inputs and add change
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log(`Transaction summary:`);
  console.log(`  Inputs: ${tx.inputs.length} cells`);
  console.log(`  Outputs: ${tx.outputs.length} cells\n`);

  console.log("📤 Deploying token contract...");
  const tokenTxHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Token contract deployed!`);
  console.log(`TX Hash: ${tokenTxHash}`);
  console.log(`Token OutPoint: ${tokenTxHash}:0x0\n`);

  // Update deployed.json
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  deployed.token = {
    txHash: tokenTxHash,
    codeHash: tokenCodeHash,
    outPoint: {
      txHash: tokenTxHash,
      index: "0x0"
    },
    redeployedAt: new Date().toISOString(),
    previousVersion: oldMarketTxHash
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("✅ Deployment info updated in deployed.json");
  console.log("\n🎉 Ready to mint tokens with the always-success market!");
}

deployToken().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
