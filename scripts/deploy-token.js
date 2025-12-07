#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployToken() {
  console.log("=== Deploying Token Contract ===\n");

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

  // Load token binary
  const tokenBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market-token/build/market-token")
  );

  console.log(`Token contract size: ${tokenBinary.length} bytes`);

  // Convert to hex
  const data = "0x" + tokenBinary.toString("hex");

  // Get lock script
  const lock = (await signer.getAddressObjs())[0].script;

  // Calculate capacity
  const capacityNeeded = BigInt(8 + 61 + tokenBinary.length) * BigInt(100_000_000);
  console.log(`Capacity needed: ${Number(capacityNeeded) / 100_000_000} CKB\n`);

  // Build transaction
  const tx = ccc.Transaction.from({
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

  console.log("📤 Sending transaction...");
  const txHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Token contract deployed!`);
  console.log(`TX Hash: ${txHash}`);

  // Calculate data hash
  const dataHash = ccc.hashCkb(tokenBinary);

  // Handle both string and Uint8Array return types
  let codeHash;
  if (typeof dataHash === "string") {
    codeHash = dataHash.startsWith("0x") ? dataHash : "0x" + dataHash;
  } else {
    // It's a Uint8Array
    codeHash = "0x" + Array.from(dataHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  console.log(`Code Hash: ${codeHash}`);

  // Save to deployed.json
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  deployed.token = {
    txHash,
    outPoint: {
      txHash,
      index: "0x0"
    },
    codeHash,
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("\n✅ Deployment info saved!");
}

deployToken().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
