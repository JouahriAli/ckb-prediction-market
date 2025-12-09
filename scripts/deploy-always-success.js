#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployAlwaysSuccess() {
  console.log("=== Deploying Always Success Lock Contract ===\n");

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

  // Read contract binary
  const contractPath = path.join(
    __dirname,
    "../contracts/always-success/build/always-success"
  );
  const contractBinary = fs.readFileSync(contractPath);
  const contractHex = "0x" + contractBinary.toString("hex");

  console.log(`Contract size: ${contractBinary.length} bytes`);
  console.log(`Contract data hash: ${ccc.hashCkb(contractBinary)}\n`);

  // Get lock script for the deployer
  const lock = (await signer.getAddressObjs())[0].script;

  // Calculate capacity needed (61 bytes lock + 8 bytes capacity + data)
  const dataSize = contractBinary.length;
  const capacityNeeded = BigInt(61 + 8 + dataSize) * BigInt(100_000_000);
  console.log(`Capacity needed: ${Number(capacityNeeded) / 100_000_000} CKB\n`);

  // Build transaction
  const tx = ccc.Transaction.from({
    outputs: [{
      capacity: capacityNeeded,
      lock
    }],
    outputsData: [contractHex]
  });

  // Complete transaction
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log("📤 Deploying always-success contract...");
  const txHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Always-success contract deployed!`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`\nTo use in transactions:`);
  console.log(`  Cell Dep: { outPoint: { txHash: "${txHash}", index: "0x0" }, depType: "code" }`);

  // Save deployment info
  const deployedPath = path.join(__dirname, "deployed.json");
  let deployed = {};
  if (fs.existsSync(deployedPath)) {
    deployed = JSON.parse(fs.readFileSync(deployedPath));
  }

  deployed.alwaysSuccess = {
    txHash,
    outPoint: {
      txHash,
      index: "0x0"
    },
    dataHash: ccc.hashCkb(contractBinary),
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));
  console.log("\n✅ Deployment info saved to deployed.json");
}

deployAlwaysSuccess().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
