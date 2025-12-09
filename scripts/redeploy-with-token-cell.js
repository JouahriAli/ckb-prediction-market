#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function redeployMarket() {
  console.log("=== Redeploying Market Contract (using token cell CKB) ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not in .env");
    process.exit(1);
  }

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.token) {
    console.error("❌ Token contract cell not found");
    process.exit(1);
  }

  if (!deployed.alwaysSuccess) {
    console.error("❌ Always-success contract not deployed");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`Address: ${address}`);
  console.log(`Balance: ${Number(balance) / 100_000_000} CKB\n`);

  // Check if old token cell exists
  const tokenOutPoint = deployed.token.outPoint;
  console.log(`Checking token cell: ${tokenOutPoint.txHash}:${tokenOutPoint.index}`);

  const tokenCell = await client.getCellLive({
    txHash: tokenOutPoint.txHash,
    index: parseInt(tokenOutPoint.index)
  });

  if (!tokenCell) {
    console.error("❌ Token cell not found or already spent");
    process.exit(1);
  }

  console.log(`✅ Token cell found with ${Number(tokenCell.cellOutput.capacity) / 100_000_000} CKB\n`);

  // Read market contract binary
  const marketBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market/build/market")
  );
  const marketHex = "0x" + marketBinary.toString("hex");
  const marketDataHash = ccc.hashCkb(marketBinary);

  let marketCodeHash;
  if (typeof marketDataHash === "string") {
    marketCodeHash = marketDataHash.startsWith("0x")
      ? marketDataHash
      : "0x" + marketDataHash;
  } else {
    marketCodeHash = "0x" + Array.from(marketDataHash)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  console.log(`Market contract size: ${marketBinary.length} bytes`);
  console.log(`Market code hash: ${marketCodeHash}\n`);

  // Get user's lock script
  const userLock = (await signer.getAddressObjs())[0].script;

  // Calculate capacity for market contract deployment
  const marketCapacity = BigInt(61 + 8 + marketBinary.length) * BigInt(100_000_000);

  console.log(`Market contract deployment needs: ${Number(marketCapacity) / 100_000_000} CKB`);
  console.log(`Token cell has: ${Number(tokenCell.cellOutput.capacity) / 100_000_000} CKB\n`);

  // Build transaction:
  // Input: old token cell
  // Outputs: 1) new market contract cell, 2) change back to user
  const tx = ccc.Transaction.from({
    inputs: [{
      previousOutput: {
        txHash: tokenOutPoint.txHash,
        index: BigInt(parseInt(tokenOutPoint.index))
      }
    }],
    outputs: [
      // Market contract deployment
      {
        capacity: marketCapacity,
        lock: userLock
      }
    ],
    outputsData: [marketHex]
  });

  // Add cell deps for user's lock
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

  // Complete inputs and add change
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log(`Transaction summary:`);
  console.log(`  Inputs: ${tx.inputs.length} cells`);
  console.log(`  Outputs: ${tx.outputs.length} cells\n`);

  console.log("📤 Deploying market contract...");
  const marketTxHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Market contract deployed!`);
  console.log(`TX Hash: ${marketTxHash}`);
  console.log(`Market OutPoint: ${marketTxHash}:0x0\n`);

  // Update deployed.json
  deployed.market = {
    txHash: marketTxHash,
    codeHash: marketCodeHash,
    outPoint: {
      txHash: marketTxHash,
      index: "0x0"
    },
    redeployedAt: new Date().toISOString(),
    previousVersion: deployed.token.txHash
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("✅ Deployment info updated in deployed.json");
  console.log("\nNext step: Run create-market.js to create market cell with always-success lock");
}

redeployMarket().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
