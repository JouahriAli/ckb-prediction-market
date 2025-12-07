#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function mintTokens() {
  console.log("=== Minting YES/NO Tokens ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not in .env");
    process.exit(1);
  }

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.marketCell || !deployed.token) {
    console.error("❌ Market cell or token contract not deployed");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`Address: ${address}`);
  console.log(`Balance: ${Number(balance) / 100_000_000} CKB\n`);

  // Get lock script
  const lock = (await signer.getAddressObjs())[0].script;

  // Amount to mint (in token units, not shannons)
  // 1 token = 100 CKB, so minting 1 token requires 100 CKB collateral
  const mintAmount = BigInt(100);
  const CKB_PER_TOKEN = BigInt(100);
  const mintAmountCKB = mintAmount * CKB_PER_TOKEN * BigInt(100_000_000); // Convert to shannons

  console.log(`Minting: ${mintAmount} YES + ${mintAmount} NO tokens`);
  console.log(`Collateral: ${Number(mintAmountCKB) / 100_000_000} CKB (${CKB_PER_TOKEN} CKB per token)\n`);

  // Load current market cell
  const marketOutPoint = new ccc.OutPoint(
    deployed.marketCell.outPoint.txHash,
    deployed.marketCell.outPoint.index
  );

  console.log("Loading current market cell...");
  const marketCell = await client.getCell(marketOutPoint);
  if (!marketCell) {
    console.error("❌ Market cell not found");
    process.exit(1);
  }

  console.log(`Current market capacity: ${Number(marketCell.cellOutput.capacity) / 100_000_000} CKB`);

  // Parse current market data
  const currentData = marketCell.outputData;
  console.log(`Current market data: ${currentData}\n`);

  // Create updated market data (yes_supply=100, no_supply=100, resolved=false, outcome=false)
  const buffer = Buffer.alloc(34);
  // yes_supply (u128 LE)
  buffer.writeBigUInt64LE(mintAmount & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  buffer.writeBigUInt64LE(mintAmount >> BigInt(64), 8);
  // no_supply (u128 LE)
  buffer.writeBigUInt64LE(mintAmount & BigInt("0xFFFFFFFFFFFFFFFF"), 16);
  buffer.writeBigUInt64LE(mintAmount >> BigInt(64), 24);
  // resolved and outcome (both false)
  buffer.writeUInt8(0, 32);
  buffer.writeUInt8(0, 33);

  const newMarketData = "0x" + buffer.toString("hex");
  console.log(`New market data: ${newMarketData}`);

  // Create token data (16 bytes, u128 LE)
  const tokenBuffer = Buffer.alloc(16);
  tokenBuffer.writeBigUInt64LE(mintAmount & BigInt("0xFFFFFFFFFFFFFFFF"), 0);
  tokenBuffer.writeBigUInt64LE(mintAmount >> BigInt(64), 8);
  const tokenData = "0x" + tokenBuffer.toString("hex");

  console.log(`Token data: ${tokenData}\n`);

  // Create market type script hash (for token args)
  const marketTypeScript = marketCell.cellOutput.type;
  const marketTypeHash = marketTypeScript.hash();

  // Handle both string and Uint8Array return types
  let marketTypeHashHex;
  if (typeof marketTypeHash === "string") {
    marketTypeHashHex = marketTypeHash.startsWith("0x") ? marketTypeHash : "0x" + marketTypeHash;
  } else {
    // It's a Uint8Array
    marketTypeHashHex = "0x" + Array.from(marketTypeHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  console.log(`Market type hash: ${marketTypeHashHex}`);

  // Create token type scripts
  const tokenCodeHash = deployed.token.codeHash;
  console.log(`Token code hash: ${tokenCodeHash}\n`);

  const yesTokenTypeScript = new ccc.Script(
    tokenCodeHash,
    "data2",
    marketTypeHashHex + "01" // market hash + YES token ID
  );

  const noTokenTypeScript = new ccc.Script(
    tokenCodeHash,
    "data2",
    marketTypeHashHex + "02" // market hash + NO token ID
  );

  // Calculate new market capacity (old + collateral)
  const newMarketCapacity = marketCell.cellOutput.capacity + mintAmountCKB;

  // Token cell capacity (need ~142-150 CKB for lock + type + data)
  const tokenCellCapacity = BigInt(150) * BigInt(100_000_000);

  console.log("Building transaction...");
  console.log(`Market capacity: ${Number(marketCell.cellOutput.capacity) / 100_000_000} → ${Number(newMarketCapacity) / 100_000_000} CKB`);
  console.log(`Token cells: ${Number(tokenCellCapacity) / 100_000_000} CKB each\n`);

  // Build transaction
  const tx = ccc.Transaction.from({
    inputs: [
      new ccc.CellInput(marketOutPoint, BigInt(0))
    ],
    outputs: [
      // Updated market cell
      {
        capacity: newMarketCapacity,
        lock: marketCell.cellOutput.lock,
        type: marketCell.cellOutput.type
      },
      // YES token cell
      {
        capacity: tokenCellCapacity,
        lock,
        type: yesTokenTypeScript
      },
      // NO token cell
      {
        capacity: tokenCellCapacity,
        lock,
        type: noTokenTypeScript
      }
    ],
    outputsData: [
      newMarketData,
      tokenData,
      tokenData
    ]
  });

  // Add cell deps for both contracts
  tx.cellDeps.push(
    new ccc.CellDep(
      new ccc.OutPoint(deployed.market.txHash, 0),
      "code"
    )
  );
  tx.cellDeps.push(
    new ccc.CellDep(
      new ccc.OutPoint(deployed.token.txHash, 0),
      "code"
    )
  );

  // Complete transaction
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000);

  console.log("📤 Sending minting transaction...");
  const txHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Minting transaction sent!`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`\nView on explorer:`);
  console.log(`https://pudge.explorer.nervos.org/transaction/${txHash}`);

  console.log(`\n✅ You now have:`);
  console.log(`  - ${mintAmount} YES tokens`);
  console.log(`  - ${mintAmount} NO tokens`);
  console.log(`  - Market supply: ${mintAmount} YES, ${mintAmount} NO`);
}

mintTokens().catch(err => {
  console.error("\n❌ Error:", err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
