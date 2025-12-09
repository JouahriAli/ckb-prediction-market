#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function upgradeMarketLock() {
  console.log("=== Upgrading Market Cell Lock to Always-Success ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY not in .env");
    process.exit(1);
  }

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.marketCell) {
    console.error("❌ Market cell not found in deployed.json");
    process.exit(1);
  }

  if (!deployed.alwaysSuccess) {
    console.error("❌ Always-success lock not deployed yet");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);

  const address = await signer.getRecommendedAddress();
  const balance = await signer.getBalance();

  console.log(`Address: ${address}`);
  console.log(`Balance: ${Number(balance) / 100_000_000} CKB\n`);

  // Get old market cell info
  const oldMarketOutPoint = deployed.marketCell.outPoint;
  console.log(`Old market cell: ${oldMarketOutPoint.txHash}:${oldMarketOutPoint.index}`);

  // Fetch the old market cell
  const oldCell = await client.getCellLive({
    txHash: oldMarketOutPoint.txHash,
    index: parseInt(oldMarketOutPoint.index)
  });

  if (!oldCell) {
    console.error("❌ Old market cell not found or already spent");
    process.exit(1);
  }

  console.log(`Old market cell capacity: ${Number(oldCell.cellOutput.capacity) / 100_000_000} CKB`);
  console.log(`Old market data: ${oldCell.outputData}\n`);

  // Load always-success lock binary and create new lock script
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

  // Create always-success lock script
  const newLock = new ccc.Script(
    alwaysSuccessCodeHash,
    "data2",
    "0x"
  );

  console.log(`New lock (always-success): ${alwaysSuccessCodeHash}`);
  console.log("⚠️  Anyone will be able to spend the new market cell!\n");

  // Build transaction: consume old market cell, output new market cell with always-success lock
  const tx = ccc.Transaction.from({
    inputs: [{
      previousOutput: {
        txHash: oldMarketOutPoint.txHash,
        index: BigInt(parseInt(oldMarketOutPoint.index))
      }
    }],
    outputs: [{
      capacity: oldCell.cellOutput.capacity, // Keep same capacity
      lock: newLock,
      type: oldCell.cellOutput.type // Keep same type script
    }],
    outputsData: [oldCell.outputData] // Keep same data
  });

  // Add cell deps
  // 1. Market contract (for type script validation)
  const marketTxHash = deployed.market.txHash;
  tx.cellDeps.push(new ccc.CellDep(
    new ccc.OutPoint(marketTxHash, 0),
    "code"
  ));

  // 2. Always-success contract (for new lock script)
  const alwaysSuccessTxHash = deployed.alwaysSuccess.txHash;
  tx.cellDeps.push(new ccc.CellDep(
    new ccc.OutPoint(alwaysSuccessTxHash, 0),
    "code"
  ));

  // 3. Secp256k1 (for spending the old cell with user's lock)
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

  // Complete inputs for fee (we need a little extra CKB for fees)
  await tx.completeInputsByCapacity(signer);

  // Add change output and fees
  await tx.completeFeeBy(signer, 1000);

  console.log("📤 Upgrading market cell lock...");
  console.log(`Transaction summary:`);
  console.log(`  Inputs: ${tx.inputs.length} cells`);
  console.log(`  Outputs: ${tx.outputs.length} cells`);
  console.log(`  Market cell: OLD lock → ALWAYS-SUCCESS lock\n`);

  const txHash = await signer.sendTransaction(tx);

  console.log(`\n✅ Market cell lock upgraded!`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`\nNew market cell OutPoint:`);
  console.log(`  txHash: ${txHash}`);
  console.log(`  index: 0x0`);

  // Update deployment info
  deployed.marketCell = {
    txHash,
    outPoint: {
      txHash,
      index: "0x0"
    },
    typeScript: deployed.marketCell.typeScript,
    lock: {
      codeHash: alwaysSuccessCodeHash,
      hashType: "data2",
      args: "0x"
    },
    upgradedAt: new Date().toISOString(),
    previousVersion: oldMarketOutPoint.txHash
  };

  fs.writeFileSync(
    path.join(__dirname, "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  console.log("\n✅ Market info updated in deployed.json");
  console.log("🎉 Anyone can now mint/burn tokens by spending this market cell!");
}

upgradeMarketLock().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
