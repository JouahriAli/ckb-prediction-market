#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function deployContracts() {
  console.log("=== Deploying Prediction Market Contracts ===\n");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not found in .env file");
    console.error("Run: node generate-key.js first");
    process.exit(1);
  }

  // Setup client and signer
  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  const address = await signer.getRecommendedAddress();

  console.log(`Deploying from: ${address}\n`);

  // Check balance
  const balance = await signer.getBalance();
  const balanceCKB = Number(balance) / 100_000_000;
  console.log(`Balance: ${balanceCKB} CKB\n`);

  if (balanceCKB < 1000) {
    console.error("❌ Insufficient balance. Need at least 1000 CKB for deployment.");
    console.error("Fund your address at: https://faucet.nervos.org");
    process.exit(1);
  }

  // Load contract binaries
  const marketBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market/build/market")
  );
  const tokenBinary = fs.readFileSync(
    path.join(__dirname, "../contracts/market-token/build/market-token")
  );

  console.log(`Market contract size: ${marketBinary.length} bytes`);
  console.log(`Token contract size: ${tokenBinary.length} bytes\n`);

  // Deploy Market Contract
  console.log("📤 Deploying Market Contract...");
  const marketTx = await deployContract(signer, marketBinary, "market");
  console.log(`✅ Market deployed! TX: ${marketTx}\n`);

  // Deploy Token Contract
  console.log("📤 Deploying Market Token Contract...");
  const tokenTx = await deployContract(signer, tokenBinary, "market-token");
  console.log(`✅ Token deployed! TX: ${tokenTx}\n`);

  console.log("=== Deployment Complete! ===\n");
  console.log("Contract hashes saved to deployed-contracts.json");
  console.log("Next: Run create-market.js to create a market cell");
}

async function deployContract(signer, binary, name) {
  const { script } = await ccc.Script.fromKnownScript(
    signer.client,
    ccc.KnownScript.Secp256k1Blake160,
    await signer.getRecommendedAddressObj()
  );

  // Calculate required capacity for the cell
  const dataBytes = ccc.hexFrom(binary);
  const minCapacity = BigInt(binary.length + 61) * BigInt(100_000_000); // Rough estimate

  console.log(`  Required capacity: ~${Number(minCapacity) / 100_000_000} CKB`);

  // Create cell output
  const output = new ccc.CellOutput(minCapacity, script);

  // Create deployment transaction
  const tx = new ccc.Transaction();
  tx.outputs.push(output);
  tx.outputsData.push(dataBytes);

  // Complete inputs and fee
  await tx.addCellDepsOfKnownScripts(signer.client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000); // 1000 shannons/byte fee rate

  // Sign and send
  const txHash = await signer.sendTransaction(tx);

  // Calculate contract hash
  const dataHash = ccc.hashCkb(binary);

  // Save deployment info
  const deployedPath = path.join(__dirname, "deployed-contracts.json");
  let deployed = {};
  if (fs.existsSync(deployedPath)) {
    deployed = JSON.parse(fs.readFileSync(deployedPath));
  }

  deployed[name] = {
    txHash,
    dataHash: ccc.hexFrom(dataHash),
    size: binary.length,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  return txHash;
}

deployContracts().catch((err) => {
  console.error("\n❌ Deployment failed:");
  console.error(err);
  process.exit(1);
});
