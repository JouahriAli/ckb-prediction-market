#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

async function generateKey() {
  console.log("Generating new private key...\n");

  // Generate random private key using Node crypto
  const privateKeyBytes = crypto.randomBytes(32);
  const privateKey = "0x" + privateKeyBytes.toString("hex");

  // Create signer
  const signer = new ccc.SignerCkbPrivateKey(
    new ccc.ClientPublicTestnet(),
    privateKey
  );

  // Get address
  const address = await signer.getRecommendedAddress();

  console.log("✅ Private Key Generated!");
  console.log("=====================================");
  console.log(`Private Key: ${privateKey}`);
  console.log(`Address: ${address}`);
  console.log("=====================================\n");

  // Save to .env file
  const envPath = path.join(__dirname, ".env");
  const envContent = `PRIVATE_KEY=${privateKey}\nADDRESS=${address}\n`;

  fs.writeFileSync(envPath, envContent);
  console.log("✅ Saved to .env file");
  console.log("\n⚠️  IMPORTANT: Keep your private key safe! Add .env to .gitignore\n");

  console.log("Next steps:");
  console.log(`1. Fund your address with testnet CKB:`);
  console.log(`   https://faucet.nervos.org`);
  console.log(`   Address: ${address}`);
  console.log(`2. Run deployment script after receiving funds\n`);
}

generateKey().catch(console.error);
