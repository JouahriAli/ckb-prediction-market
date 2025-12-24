import { ccc } from "@ckb-ccc/ccc";
import fs from "fs";
import "dotenv/config";

const PRIVATE_KEY = process.env.PRIVATE_KEY;

/**
 * Upgrade a deployed contract cell on CKB testnet.
 *
 * Consumes the existing cell containing the old binary and creates
 * a new cell with the same lock/type scripts but updated data.
 *
 * @param {Object} options - Upgrade options
 * @param {string} options.txHash - Transaction hash of the cell to upgrade
 * @param {number} options.index - Output index of the cell to upgrade
 * @param {string} options.newBinaryPath - Path to the new contract binary
 * @returns {Promise<string>} - Transaction hash of the upgrade transaction
 */
async function upgradeContract({ txHash, index, newBinaryPath }) {
    const client = new ccc.ClientPublicTestnet();
    const signer = new ccc.SignerCkbPrivateKey(client, PRIVATE_KEY);

    // Fetch the existing cell
    const outPoint = { txHash, index };
    const cell = await client.getCell(outPoint);
    if (!cell) {
        throw new Error(`Cell not found: ${txHash}:${index}`);
    }

    console.log("Found cell to upgrade:");
    console.log(`  Capacity: ${ccc.fixedPointToString(cell.cellOutput.capacity)} CKB`);
    console.log(`  Data size: ${cell.outputData.length / 2 - 1} bytes`);

    // Read the new binary
    const newBinary = fs.readFileSync(newBinaryPath);
    const newDataHex = "0x" + newBinary.toString("hex");
    console.log(`New binary size: ${newBinary.length} bytes`);

    // Calculate required capacity for new cell
    // Capacity = (cell overhead + data bytes) * 1 CKB per byte
    const dataBytes = BigInt(newBinary.length);
    const cellOverhead = 61n; // minimum cell overhead in bytes
    const lockScriptBytes = 33n; // secp256k1 lock script size
    const requiredCapacity = (cellOverhead + lockScriptBytes + dataBytes) * 100000000n;

    console.log(`Required capacity: ${ccc.fixedPointToString(requiredCapacity)} CKB`);

    // Build the transaction
    const tx = ccc.Transaction.from({
        inputs: [{ previousOutput: outPoint }],
        outputs: [
            ccc.CellOutput.from({
                capacity: requiredCapacity,
                lock: cell.cellOutput.lock,
                type: cell.cellOutput.type
            })
        ],
        outputsData: [newDataHex]
    });

    // If old cell has more capacity than needed, return the difference
    const oldCapacity = cell.cellOutput.capacity;
    if (oldCapacity > requiredCapacity) {
        const change = oldCapacity - requiredCapacity;
        console.log(`Returning excess capacity: ${ccc.fixedPointToString(change)} CKB`);
        tx.outputs.push(
            ccc.CellOutput.from({
                capacity: change,
                lock: cell.cellOutput.lock
            })
        );
        tx.outputsData.push("0x");
    }

    // Add cell deps for secp256k1
    await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.Secp256k1Blake160);

    // Complete fee (may need additional inputs)
    console.log("Completing fee...");
    await tx.completeFeeBy(signer, 1000);

    // Sign
    console.log("Signing transaction...");
    const signedTx = await signer.signTransaction(tx);

    // Send
    console.log("Sending transaction...");
    const newTxHash = await client.sendTransaction(signedTx);

    console.log(`\nUpgrade successful!`);
    console.log(`TX: ${newTxHash}`);
    console.log(`Explorer: https://pudge.explorer.nervos.org/transaction/${newTxHash}`);

    return newTxHash;
}

/**
 * Find contract cells deployed by a specific address.
 *
 * Searches for cells with large data fields (likely contract binaries)
 * owned by the given address.
 *
 * @param {string} address - CKB address to search
 * @returns {Promise<Array<{txHash: string, index: number, capacity: bigint, dataSize: number}>>}
 */
async function findContractCells(address) {
    const client = new ccc.ClientPublicTestnet();
    const { script } = await ccc.Address.fromString(address, client);

    const cells = [];
    const MIN_DATA_SIZE = 10000; // 10KB minimum to be considered a contract

    for await (const cell of client.findCellsByLock(script, null, true)) {
        const dataSize = cell.outputData.length / 2 - 1; // hex string to bytes
        if (dataSize >= MIN_DATA_SIZE) {
            cells.push({
                txHash: cell.outPoint.txHash,
                index: cell.outPoint.index,
                capacity: cell.cellOutput.capacity,
                dataSize
            });
        }
    }

    return cells;
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args[0] === "--list" || args[0] === "-l") {
        // List contract cells
        const address = process.env.ADDRESS;
        console.log(`Finding contract cells for ${address}...\n`);

        const cells = await findContractCells(address);
        if (cells.length === 0) {
            console.log("No contract cells found.");
            return;
        }

        console.log("Contract cells found:");
        for (const cell of cells) {
            console.log(`  ${cell.txHash}:${cell.index}`);
            console.log(`    Capacity: ${ccc.fixedPointToString(cell.capacity)} CKB`);
            console.log(`    Data size: ${cell.dataSize} bytes`);
            console.log();
        }
    } else if (args[0] === "--upgrade" || args[0] === "-u") {
        // Upgrade a contract cell
        if (args.length < 4) {
            console.log("Usage: node upgrade-contract.js --upgrade <txHash> <index> <newBinaryPath>");
            process.exit(1);
        }

        const txHash = args[1];
        const index = parseInt(args[2]);
        const newBinaryPath = args[3];

        await upgradeContract({ txHash, index, newBinaryPath });
    } else {
        console.log("CKB Contract Upgrade Tool");
        console.log();
        console.log("Usage:");
        console.log("  node upgrade-contract.js --list                     List contract cells");
        console.log("  node upgrade-contract.js --upgrade <txHash> <index> <binaryPath>");
        console.log();
        console.log("Examples:");
        console.log("  node upgrade-contract.js -l");
        console.log("  node upgrade-contract.js -u 0x1234...abcd 0 ./contracts/market/build/market");
    }
}

main().catch(console.error);

