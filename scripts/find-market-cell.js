#!/usr/bin/env node

const { ccc } = require("@ckb-ccc/shell");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function findMarketCell() {
  console.log("=== Finding Current Market Cell ===\n");

  // Load deployment info
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "deployed.json"))
  );

  if (!deployed.marketCell || !deployed.marketCell.typeScript) {
    console.error("❌ Market type script not found in deployed.json");
    process.exit(1);
  }

  const client = new ccc.ClientPublicTestnet();

  // Search for cells with the market type script
  const typeScript = new ccc.Script(
    deployed.marketCell.typeScript.codeHash,
    deployed.marketCell.typeScript.hashType,
    deployed.marketCell.typeScript.args
  );

  console.log(`Searching for market cells with type script:`);
  console.log(`  Code Hash: ${typeScript.codeHash}`);
  console.log(`  Hash Type: ${typeScript.hashType}`);
  console.log(`  Args: ${typeScript.args}\n`);

  const cells = [];
  const collector = client.findCellsByType(typeScript, true);

  for await (const cell of collector) {
    cells.push(cell);
  }

  if (cells.length === 0) {
    console.log("❌ No live market cells found");
    console.log("\nThe market cell may have been:");
    console.log("- Consumed and not yet confirmed");
    console.log("- Deployed on a different network");
    console.log("- Using a different type script");
    process.exit(1);
  }

  console.log(`✅ Found ${cells.length} live market cell(s):\n`);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    console.log(`Market Cell #${i + 1}:`);
    console.log(`  OutPoint: ${cell.outPoint.txHash}:${cell.outPoint.index}`);
    console.log(`  Capacity: ${Number(cell.cellOutput.capacity) / 100_000_000} CKB`);
    console.log(`  Lock: ${cell.cellOutput.lock.codeHash.slice(0, 20)}...`);
    console.log(`  Data: ${cell.outputData}`);

    // Parse market data
    if (cell.outputData && cell.outputData.length >= 70) { // 0x + 68 hex chars (34 bytes)
      const dataHex = cell.outputData.slice(2);
      const yesSupplyHex = dataHex.slice(0, 32);
      const noSupplyHex = dataHex.slice(32, 64);

      // Parse as little-endian u128
      const yesSupply = BigInt('0x' + yesSupplyHex.match(/../g).reverse().join(''));
      const noSupply = BigInt('0x' + noSupplyHex.match(/../g).reverse().join(''));

      console.log(`  YES Supply: ${yesSupply}`);
      console.log(`  NO Supply: ${noSupply}`);
    }
    console.log();
  }

  // Update deployed.json with the current market cell
  if (cells.length === 1) {
    const cell = cells[0];
    deployed.marketCell.outPoint = {
      txHash: cell.outPoint.txHash,
      index: "0x" + cell.outPoint.index.toString(16)
    };
    deployed.marketCell.txHash = cell.outPoint.txHash;
    deployed.marketCell.currentLock = {
      codeHash: cell.cellOutput.lock.codeHash,
      hashType: cell.cellOutput.lock.hashType,
      args: cell.cellOutput.lock.args
    };
    deployed.marketCell.lastUpdated = new Date().toISOString();

    fs.writeFileSync(
      path.join(__dirname, "deployed.json"),
      JSON.stringify(deployed, null, 2)
    );

    console.log("✅ Updated deployed.json with current market cell location");
  }
}

findMarketCell().catch(err => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
