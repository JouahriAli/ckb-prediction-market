#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployContract(signer, contractPath, contractName) {
  console.log(`\n📤 Deploying ${contractName}...`);

  const binary = fs.readFileSync(contractPath);
  console.log(`  Size: ${binary.length} bytes`);

  // Convert to hex
  const data = "0x" + binary.toString("hex");

  // Get lock script for outputs
  const lock = (await signer.getAddressObjs())[0].script;

  // Calculate minimum capacity (8 bytes capacity + lock + data)
  const capacityNeeded = BigInt(8 + 61 + binary.length) * BigInt(100_000_000);
  console.log(`  Capacity needed: ${Number(capacityNeeded) / 100_000_000} CKB`);

  // Build transaction
  const tx = ccc.Transaction.from({
    outputs: [{
      capacity: capacityNeeded,
      lock
    }],
    outputsData: [data]
  });

  // Complete transaction
  await tx.addCellDepsOfKnownScripts(signer.client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  // Send
  const txHash = await signer.sendTransaction(tx);
  console.log(`  ✅ TX Hash: ${txHash}`);

  // Calculate data hash (this is the code_hash for the contract)
  const dataHash = ccc.hashCkb(binary);

  return {
    txHash,
    dataHash: "0x" + Buffer.from(dataHash).toString("hex"),
    outPoint: {
      txHash,
      index: "0x0"
    }
  };
}

async function main() {
  console.log("=== Deploying Contracts ===\n");

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

  if (Number(balance) < 1000 * 100_000_000) {
    console.error("❌ Need at least 1000 CKB");
    process.exit(1);
  }

  // Deploy market contract
  const marketInfo = await deployContract(
    signer,
    path.join(__dirname, "../contracts/market/build/market"),
    "Market Contract"
  );

  // Wait a bit between deployments
  await new Promise(r => setTimeout(r, 3000));

  // Deploy token contract
  const tokenInfo = await deployContract(
    signer,
    path.join(__dirname, "../contracts/market-token/build/market-token"),
    "Token Contract"
  );

  // Save deployment info
  const deployed = {
    network: "testnet",
    deployedAt: new Date().toISOString(),
    market: marketInfo,
    token: tokenInfo
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("\n✅ Deployment complete!");
  console.log("Info saved to: deployed.json");
}

main().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
