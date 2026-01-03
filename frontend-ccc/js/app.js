import { ccc } from "https://esm.sh/@ckb-ccc/ccc@1.1.22";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Make ccc available globally for debugging
window.ccc = ccc;

// Supabase client
const SUPABASE_URL = 'https://klcfshiaxmzcmxhvzhkv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_h7AK3_SLz8dcz1r5qCKX-w_kvqCz6zP';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabase = supabase;

// Version marker for cache debugging
console.log('🔄 App.js loaded - Version: Dec 24 2024 v13 - Supabase integration');
console.log('📝 Using market contract TX:', '0x5245d3227ee810c34f5a3beb00364e023803f20453de2b32de04af9e19c00590');
console.log('📝 Using token contract TX:', '0xc85097fc1367d51ba639bda59df53ad94d274d26aa176953a7aff287bcc37652');

// Network configuration (testnet only for now)
const CONFIG = {
    // Market contract (upgraded Dec 24, 2024 - NEW 35-byte format with token_code_hash)
    marketCodeHash: '0x5377ffaf1a41f5e79bd25f8d0e1eac411863a35de41be3db49350c584a16e60d',
    marketTxHash: '0x5245d3227ee810c34f5a3beb00364e023803f20453de2b32de04af9e19c00590',
    marketIndex: '0x0',

    // Token contract (with net payment calculation for buyer==seller)
    tokenCodeHash: '0x0dee9b1c589dacb5560f207594b22cead46e895c09d393187eec2b41b66bf1e8',
    tokenTxHash: '0x7060f10c0e8ecf00b73ce8d6a4b337627a2d096505f09f22a6f955cb7a029362',
    tokenIndex: '0x0',

    // Token IDs
    TOKEN_YES: '0x01',
    TOKEN_NO: '0x02',

    appName: 'CKB Prediction Market',
    appIcon: 'https://fav.farm/🎲'
};

class PredictionMarketApp {
    constructor() {
        this.client = null;
        this.signer = null;
    }

    async init() {
        this.log('Initializing CCC SDK...', 'info');

        // Initialize testnet client
        this.client = new ccc.ClientPublicTestnet();
        window.client = this.client;

        // Create JoyID signer
        this.signer = new ccc.JoyId.CkbSigner(
            this.client,
            CONFIG.appName,
            CONFIG.appIcon
        );
        window.signer = this.signer;

        this.log('CCC initialized on Testnet (Pudge)', 'success');

        // Update network status
        document.getElementById('network-name').textContent = 'Testnet (Pudge)';

        // Check if already connected
        if (await this.signer.isConnected()) {
            this.log('Found existing JoyID connection', 'info');
            await this.updateWalletInfo();
        }

        // Update block height periodically
        await this.updateStatus();
        setInterval(() => this.updateStatus(), 15000);
    }

    async connectWallet() {
        const btn = document.getElementById('btn-connect');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Connecting...';

        try {
            this.log('Opening JoyID popup...', 'info');
            await this.signer.connect();
            this.log('Connected to JoyID!', 'success');
            await this.updateWalletInfo();
        } catch (error) {
            this.log(`Failed to connect: ${error.message}`, 'error');
            console.error(error);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Connect JoyID';
        }
    }

    async disconnectWallet() {
        try {
            await this.signer.disconnect();
            this.log('Disconnected from JoyID', 'info');

            // Reset UI
            document.getElementById('wallet-address').textContent = 'Not connected';
            document.getElementById('wallet-balance').textContent = '-';
            document.getElementById('wallet-section').classList.remove('connected');
            document.getElementById('btn-connect').style.display = 'block';
            document.getElementById('btn-disconnect').style.display = 'none';
        } catch (error) {
            this.log(`Failed to disconnect: ${error.message}`, 'error');
        }
    }

    async updateWalletInfo() {
        try {
            const address = await this.signer.getRecommendedAddress();
            document.getElementById('wallet-address').textContent = address;

            // Show connected state
            document.getElementById('wallet-section').classList.add('connected');
            document.getElementById('btn-connect').style.display = 'none';
            document.getElementById('btn-disconnect').style.display = 'block';

            // Get balance by summing cells
            await this.updateBalance();

            this.log(`Wallet connected: ${address.slice(0, 20)}...`, 'success');
        } catch (error) {
            this.log(`Failed to get wallet info: ${error.message}`, 'error');
        }
    }

    async updateBalance() {
        try {
            const address = await this.signer.getRecommendedAddress();
            const { script } = await ccc.Address.fromString(address, this.client);

            let balance = 0n;
            for await (const cell of this.client.findCellsByLock(script, undefined, true)) {
                balance += cell.cellOutput.capacity;
            }

            const balanceStr = ccc.fixedPointToString(balance);
            document.getElementById('wallet-balance').textContent = balanceStr;
        } catch (error) {
            console.error('Balance update error:', error);
        }
    }

    async updateStatus() {
        try {
            const tipHeader = await this.client.getTip();
            const blockHeight = Number(tipHeader);

            document.getElementById('block-height').textContent = blockHeight.toLocaleString();
            document.getElementById('connection-status').textContent = 'Connected';
            document.getElementById('connection-status').className = 'status-value connected';
            document.getElementById('contract-status').textContent = 'Deployed';

        } catch (error) {
            console.error('Status update error:', error);
            document.getElementById('connection-status').textContent = 'Disconnected';
            document.getElementById('connection-status').className = 'status-value disconnected';
        }
    }

    async getUserTokenBalance(marketTypeHash, tokenCodeHash, tokenId) {
        try {
            if (!await this.signer.isConnected()) {
                return 0n;
            }

            // Validate inputs
            if (!tokenCodeHash || !marketTypeHash || !tokenId) {
                console.warn('Invalid token parameters:', { marketTypeHash, tokenCodeHash, tokenId });
                return 0n;
            }

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            // Build token type script args: marketTypeHash (32 bytes) + tokenId (1 byte)
            const tokenArgs = marketTypeHash + tokenId.slice(2);

            console.log('Searching for tokens with:', {
                codeHash: tokenCodeHash,
                hashType: 'data1',
                args: tokenArgs,
                lock: userLock.codeHash.slice(0, 10) + '...'
            });

            const tokenTypeScript = ccc.Script.from({
                codeHash: tokenCodeHash,
                hashType: 'data1',
                args: tokenArgs
            });

            let total = 0n;
            let cellCount = 0;

            // Search by type script only (not lock + type)
            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                // Check if this cell belongs to the user
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const view = new DataView(data.buffer, 0, 16);
                        const amount = view.getBigUint64(0, true);
                        total += amount;
                        cellCount++;
                        console.log(`Found token cell #${cellCount}: amount=${amount}`);
                    }
                }
            }

            console.log(`Total ${tokenId === CONFIG.TOKEN_YES ? 'YES' : 'NO'} balance: ${total} (${cellCount} cells)`);
            return total;
        } catch (error) {
            console.error('Error getting token balance:', error);
            return 0n;
        }
    }

    async listMarkets() {
        const btn = document.getElementById('btn-list-markets');
        const listContainer = document.getElementById('markets-list');

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Searching...';
        listContainer.innerHTML = '';

        try {
            this.log('Searching for markets on testnet...', 'info');

            const markets = [];

            // Search for cells with our market type script code hash
            const marketTypeScript = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: '0x' // Empty args for search prefix
            });

            // Iterate through all cells matching the market code hash
            let count = 0;
            for await (const cell of this.client.findCells({
                script: marketTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'prefix' // Match any args
            })) {
                // Parse market data (35 bytes: token_code_hash + hash_type + resolved + outcome)
                const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                if (data.length >= 35) {
                    // bytes 0-31: token_code_hash
                    const tokenCodeHash = '0x' + Array.from(data.slice(0, 32))
                        .map(b => b.toString(16).padStart(2, '0')).join('');
                    // byte 32: hash_type (0=Data, 1=Type, 2=Data1, 4=Data2)
                    const hashType = data[32];
                    // byte 33: resolved
                    const resolved = data[33];
                    // byte 34: outcome
                    const outcome = data[34];

                    const typeId = cell.cellOutput.type.args;
                    const marketTypeHash = cell.cellOutput.type.hash();

                    markets.push({
                        outpoint: cell.outPoint,
                        typeId,
                        marketTypeHash,
                        tokenCodeHash,
                        hashType,
                        resolved,
                        outcome,
                        capacity: cell.cellOutput.capacity
                    });

                    count++;
                    if (count >= 20) break; // Limit to 20 markets for now
                }
            }

            this.log(`Found ${markets.length} market(s)`, 'success');

            // Fetch metadata from Supabase
            const metadataMap = {};
            if (markets.length > 0) {
                const typeHashes = markets.map(m => m.marketTypeHash);
                const { data: metadataRows, error: metaError } = await supabase
                    .from('markets')
                    .select('type_hash, question, description')
                    .in('type_hash', typeHashes);

                if (metaError) {
                    this.log(`Warning: Could not fetch metadata: ${metaError.message}`, 'warning');
                }

                if (metadataRows) {
                    for (const row of metadataRows) {
                        metadataMap[row.type_hash] = row;
                    }
                }
            }

            // Attach metadata to markets
            for (const market of markets) {
                const meta = metadataMap[market.marketTypeHash];
                market.question = meta?.question || null;
                market.description = meta?.description || null;
            }

            // Fetch token balances for each market
            if (await this.signer.isConnected()) {
                this.log('Fetching token balances...', 'info');
                for (const market of markets) {
                    // Log market details for debugging
                    console.log('Fetching balances for market:', {
                        typeId: market.typeId.slice(0, 10) + '...',
                        tokenCodeHash: market.tokenCodeHash?.slice(0, 10) + '...',
                        marketTypeHash: market.marketTypeHash?.slice(0, 10) + '...'
                    });

                    market.yesBalance = await this.getUserTokenBalance(
                        market.marketTypeHash,
                        market.tokenCodeHash,
                        CONFIG.TOKEN_YES
                    );
                    market.noBalance = await this.getUserTokenBalance(
                        market.marketTypeHash,
                        market.tokenCodeHash,
                        CONFIG.TOKEN_NO
                    );
                }
            } else {
                // Not connected - set balances to 0
                for (const market of markets) {
                    market.yesBalance = 0n;
                    market.noBalance = 0n;
                }
            }

            // Display markets
            if (markets.length === 0) {
                listContainer.innerHTML = '<p style="color: #666; font-size: 14px; padding: 10px;">No markets found. Create one to get started!</p>';
            } else {
                listContainer.innerHTML = markets.map((market, i) => `
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                            <div style="flex: 1;">
                                <div style="font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 4px;">
                                    ${market.question || `Market #${i + 1}`}
                                </div>
                                ${market.description ? `<div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">${market.description}</div>` : ''}
                            </div>
                            <span style="font-size: 11px; padding: 4px 8px; border-radius: 12px; font-weight: 600; ${market.resolved ? 'background: #d1fae5; color: #059669;' : 'background: #fef3c7; color: #d97706;'}">
                                ${market.resolved ? '✓ RESOLVED' : '○ ACTIVE'}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: #9ca3af; margin-bottom: 8px;">
                            <span title="${market.typeId}">ID: ${market.typeId.slice(0, 8)}...${market.typeId.slice(-6)}</span>
                            <span style="margin-left: 12px;">Collateral: ${ccc.fixedPointToString(market.capacity)} CKB</span>
                        </div>
                            <div style="margin-top: 8px; padding: 8px; background: #f0f9ff; border-radius: 4px; border: 1px solid #e0f2fe;">
                                <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px; font-weight: 600;">Your Tokens:</div>
                                <div style="display: flex; gap: 12px; font-size: 12px;">
                                    <div style="flex: 1;">
                                        <span style="color: #10b981; font-weight: 600;">YES:</span>
                                        <span style="color: #1f2937;">${market.yesBalance}</span>
                                    </div>
                                    <div style="flex: 1;">
                                        <span style="color: #ef4444; font-weight: 600;">NO:</span>
                                        <span style="color: #1f2937;">${market.noBalance}</span>
                                    </div>
                                </div>
                            </div>
                            ${market.resolved ? `
                                <div style="margin-top: 6px; padding: 8px; background: #f0fdf4; border-radius: 4px; border: 1px solid #bbf7d0;">
                                    <div style="color: #059669; font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                                        Winner: <strong>${market.outcome ? 'YES' : 'NO'}</strong>
                                    </div>
                                    ${(market.outcome && market.yesBalance > 0n) || (!market.outcome && market.noBalance > 0n) ? `
                                        <div style="margin-top: 8px;">
                                            <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">
                                                Claim winning tokens (100 CKB each)
                                            </div>
                                            <div style="display: flex; gap: 8px; align-items: center;">
                                                <input
                                                    type="number"
                                                    id="claim-amount-${i}"
                                                    placeholder="Amount"
                                                    value="${market.outcome ? market.yesBalance : market.noBalance}"
                                                    min="1"
                                                    max="${market.outcome ? market.yesBalance : market.noBalance}"
                                                    style="flex: 1; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px;"
                                                >
                                                <button
                                                    onclick="app.claimForMarket('${market.outpoint.txHash}', ${market.outpoint.index}, document.getElementById('claim-amount-${i}').value, ${market.outcome})"
                                                    style="padding: 8px 16px; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;"
                                                >
                                                    Claim CKB
                                                </button>
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            ` : `
                                <div style="margin-top: 10px; padding: 10px; background: #f9fafb; border-radius: 6px;">
                                    <div style="font-size: 11px; color: #6b7280; margin-bottom: 6px;">
                                        Mint complete sets (1 YES + 1 NO = 100 CKB)
                                    </div>
                                    <div style="display: flex; gap: 8px; align-items: center;">
                                        <input
                                            type="number"
                                            id="mint-amount-${i}"
                                            placeholder="Amount"
                                            value="10"
                                            min="1"
                                            style="flex: 1; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 12px;"
                                        >
                                        <button
                                            onclick="app.mintForMarket('${market.outpoint.txHash}', ${market.outpoint.index}, document.getElementById('mint-amount-${i}').value)"
                                            style="padding: 8px 16px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;"
                                        >
                                            Mint Tokens
                                        </button>
                                    </div>
                                </div>
                                <div style="margin-top: 8px; padding: 10px; background: #fef3c7; border-radius: 6px; border: 1px solid #fde68a;">
                                    <div style="font-size: 11px; color: #92400e; margin-bottom: 6px; font-weight: 600;">
                                        Resolve Market (MVP - no auth)
                                    </div>
                                    <div style="display: flex; gap: 8px; align-items: center;">
                                        <button
                                            onclick="app.resolveForMarket('${market.outpoint.txHash}', ${market.outpoint.index}, true)"
                                            style="flex: 1; padding: 8px 12px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;"
                                        >
                                            YES Wins
                                        </button>
                                        <button
                                            onclick="app.resolveForMarket('${market.outpoint.txHash}', ${market.outpoint.index}, false)"
                                            style="flex: 1; padding: 8px 12px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;"
                                        >
                                            NO Wins
                                        </button>
                                    </div>
                                </div>
                            `}
                        </div>
                    </div>
                `).join('');
            }

        } catch (error) {
            this.log(`Error listing markets: ${error.message}`, 'error');
            console.error(error);
            listContainer.innerHTML = '<p style="color: #dc2626; font-size: 14px; padding: 10px;">Error loading markets. See console for details.</p>';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔍 List All Markets';
        }
    }

    async mintForMarket(txHash, index, amount) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect your wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        // Handle index format - could be number, bigint, or hex string
        let indexHex;
        if (typeof index === 'string' && index.startsWith('0x')) {
            indexHex = index;
        } else {
            indexHex = `0x${Number(index).toString(16)}`;
        }

        const marketOutpoint = { txHash, index: indexHex };
        this.log(`Minting for market: ${txHash.slice(0, 10)}...:${indexHex}`, 'info');

        await this.mintTokensForMarket(marketOutpoint, amountInt);
    }

    async createMarket() {
        if (!await this.signer.isConnected()) {
            this.log('Please connect your wallet first', 'warning');
            return;
        }

        // Get market question from input
        const questionInput = document.getElementById('market-question');
        const descriptionInput = document.getElementById('market-description');
        const question = questionInput?.value?.trim();
        const description = descriptionInput?.value?.trim() || '';

        if (!question) {
            this.log('Please enter a question for the market', 'warning');
            return;
        }

        const btn = document.getElementById('btn-create');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Creating...';

        try {
            this.log('Creating new market cell...', 'info');

            // Use AlwaysSuccess lock script for market cell
            // This allows anyone to interact with the market (type script enforces rules)
            const lockScript = await ccc.Script.fromKnownScript(
                this.client,
                ccc.KnownScript.AlwaysSuccess,
                '0x'
            );
            this.log('Using AlwaysSuccess lock for market cell', 'info');

            // Build transaction with placeholder Type ID first
            // We need to complete inputs before calculating the real Type ID
            const placeholderTypeId = '0x' + '00'.repeat(32);
            const marketTypeScript = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: placeholderTypeId
            });

            // Create initial market data (35 bytes)
            // token_code_hash(32) + hash_type(1) + resolved(1) + outcome(1)
            const marketData = new Uint8Array(35);

            // Set token contract code hash (bytes 0-31)
            const tokenCodeHashBytes = ccc.bytesFrom(CONFIG.tokenCodeHash);
            this.log(`Token code hash: ${CONFIG.tokenCodeHash}`, 'info');
            this.log(`Token code hash bytes length: ${tokenCodeHashBytes.length}`, 'info');

            if (tokenCodeHashBytes.length !== 32) {
                throw new Error(`Invalid token code hash: expected 32 bytes, got ${tokenCodeHashBytes.length}`);
            }

            marketData.set(tokenCodeHashBytes, 0);

            // Set hash_type (byte 32): 2 = Data1
            marketData[32] = 2;
            // resolved (byte 33) = 0
            marketData[33] = 0;
            // outcome (byte 34) = 0
            marketData[34] = 0;

            const marketDataHex = '0x' + Array.from(marketData).map(b => b.toString(16).padStart(2, '0')).join('');
            this.log('Market data: ' + marketDataHex, 'info');

            // Verify token_code_hash is not all zeros
            const isAllZeros = tokenCodeHashBytes.every(b => b === 0);
            if (isAllZeros) {
                throw new Error('Token code hash is all zeros! Check CONFIG.tokenCodeHash');
            }

            // Build transaction
            const tx = ccc.Transaction.from({
                outputs: [
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(200), // 200 CKB for market cell
                        lock: lockScript,
                        type: marketTypeScript
                    })
                ],
                outputsData: [marketDataHex]
            });

            // Add cell dep for the market contract
            this.log('Adding market contract cell dep...', 'info');
            tx.cellDeps.push(
                ccc.CellDep.from({
                    outPoint: {
                        txHash: CONFIG.marketTxHash,
                        index: CONFIG.marketIndex
                    },
                    depType: 'code'
                })
            );

            // Add secp256k1 cell dep for signature verification
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);

            this.log('Completing inputs...', 'info');
            await tx.completeInputsByCapacity(this.signer);

            this.log('Adding fee...', 'info');
            await tx.completeFeeBy(this.signer, 1000);

            // NOW find the actual market cell output index (it might have moved!)
            let marketOutputIndex = -1;
            for (let i = 0; i < tx.outputs.length; i++) {
                if (tx.outputs[i].type &&
                    tx.outputs[i].type.codeHash === CONFIG.marketCodeHash) {
                    marketOutputIndex = i;
                    break;
                }
            }

            if (marketOutputIndex === -1) {
                throw new Error('Market cell not found in outputs!');
            }

            this.log(`Market cell found at output index: ${marketOutputIndex}`, 'info');

            // Now calculate proper Type ID: blake2b(first_input.outpoint || output_index)
            const firstInput = tx.inputs[0];
            const outputIndex = marketOutputIndex; // Use actual market cell index!

            this.log(`First input: ${firstInput.previousOutput.txHash}:${firstInput.previousOutput.index}`, 'info');

            // Serialize outpoint: tx_hash (32 bytes) + index (4 bytes LE)
            const outpointBytes = new Uint8Array(36);
            outpointBytes.set(ccc.bytesFrom(firstInput.previousOutput.txHash), 0);
            const indexView = new DataView(outpointBytes.buffer, 32, 4);
            indexView.setUint32(0, parseInt(firstInput.previousOutput.index), true);

            this.log(`Outpoint bytes (36): ${ccc.hexFrom(outpointBytes)}`, 'info');

            // Append output index (8 bytes LE)
            const typeIdInput = new Uint8Array(44);
            typeIdInput.set(outpointBytes, 0);
            const outputIndexView = new DataView(typeIdInput.buffer, 36, 8);
            outputIndexView.setBigUint64(0, BigInt(outputIndex), true);

            this.log(`Type ID input (44 bytes): ${ccc.hexFrom(typeIdInput)}`, 'info');

            // Calculate Type ID using CKB blake2b
            const typeId = ccc.hashCkb(ccc.hexFrom(typeIdInput));
            this.log(`Calculated Type ID: ${typeId}`, 'info');

            // Create NEW type script with the real Type ID (don't mutate existing)
            const finalMarketTypeScript = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: typeId
            });
            tx.outputs[marketOutputIndex].type = finalMarketTypeScript;
            this.log(`Updated market type script with Type ID`, 'info');

            // Final verification before signing
            this.log('=== FINAL TRANSACTION VERIFICATION ===', 'info');
            this.log(`Market cell at output[${marketOutputIndex}]`, 'info');
            this.log(`  Capacity: ${ccc.fixedPointToString(tx.outputs[marketOutputIndex].capacity)} CKB`, 'info');
            this.log(`  Type args (Type ID): ${tx.outputs[marketOutputIndex].type.args}`, 'info');
            this.log(`  Type code_hash: ${tx.outputs[marketOutputIndex].type.codeHash}`, 'info');
            this.log(`  Data: ${tx.outputsData[marketOutputIndex]}`, 'info');
            this.log(`  Data length: ${tx.outputsData[marketOutputIndex].length} chars = ${(tx.outputsData[marketOutputIndex].length - 2) / 2} bytes`, 'info');

            // Verify data is 35 bytes
            const dataBytes = (tx.outputsData[marketOutputIndex].length - 2) / 2; // Subtract 0x prefix
            if (dataBytes !== 35) {
                throw new Error(`Market data must be 35 bytes, got ${dataBytes} bytes`);
            }

            this.log('Please approve the transaction in JoyID...', 'info');
            const signedTx = await this.signer.signTransaction(tx);

            this.log('Sending transaction...', 'info');
            const txHash = await this.client.sendTransaction(signedTx);

            this.log(`Market created! TX: ${txHash}`, 'success');
            this.log(`View on explorer: https://pudge.explorer.nervos.org/transaction/${txHash}`, 'info');

            // Save market metadata to Supabase
            const marketTypeHash = finalMarketTypeScript.hash();
            this.log(`Saving market metadata for ${marketTypeHash.slice(0, 10)}...`, 'info');

            const { error: dbError } = await supabase
                .from('markets')
                .insert({
                    type_hash: marketTypeHash,
                    question: question,
                    description: description
                });

            if (dbError) {
                this.log(`Warning: Failed to save metadata: ${dbError.message}`, 'warning');
            } else {
                this.log('Market metadata saved!', 'success');
            }

            // Clear inputs
            if (questionInput) questionInput.value = '';
            if (descriptionInput) descriptionInput.value = '';

            await this.updateBalance();

            // Refresh market list to show the new market
            await this.listMarkets();

        } catch (error) {
            this.log(`Error creating market: ${error.message}`, 'error');
            console.error(error);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Create Market Cell';
        }
    }

    async mintTokensForMarket(marketOutpoint, amount) {
        try {
            this.log(`Minting ${amount} complete sets (${amount} YES + ${amount} NO)...`, 'info');

            // Get user's address for token cells
            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            // Fetch the market cell
            this.log('Fetching market cell...', 'info');
            this.log(`OutPoint: ${marketOutpoint.txHash}:${marketOutpoint.index}`, 'info');

            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) {
                this.log('Market cell not found - it may have been spent. Refreshing list...', 'warning');
                await this.listMarkets();
                throw new Error('Market cell not found. The market list has been refreshed - please try again with an active market.');
            }

            this.log(`Found market cell with capacity: ${ccc.fixedPointToString(marketCell.cellOutput.capacity)} CKB`, 'info');

            // Parse current market data (35 bytes: token_code_hash + hash_type + resolved + outcome)
            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData.length < 35) {
                throw new Error('Invalid market data: expected 35 bytes');
            }

            // Extract token contract info from market data
            const storedTokenCodeHash = '0x' + Array.from(marketData.slice(0, 32))
                .map(b => b.toString(16).padStart(2, '0')).join('');
            const hashType = marketData[32];
            const resolved = marketData[33];

            this.log(`Market stores token code hash: ${storedTokenCodeHash}`, 'info');
            this.log(`CONFIG token code hash: ${CONFIG.tokenCodeHash}`, 'info');
            this.log(`Hash type: ${hashType} (2=Data1)`, 'info');

            // Check if market's stored hash matches our CONFIG
            if (storedTokenCodeHash !== CONFIG.tokenCodeHash) {
                this.log(`ERROR: Token code hash mismatch!`, 'error');
                this.log(`Market expects: ${storedTokenCodeHash}`, 'error');
                this.log(`We're using: ${CONFIG.tokenCodeHash}`, 'error');
                throw new Error('Token code hash mismatch - this market was created with a different token contract. Please use a newer market.');
            }

            if (resolved) {
                throw new Error('Cannot mint tokens: market is already resolved');
            }

            // Market data stays the same (contract validates token counts in transaction)
            const newMarketDataHex = marketCell.outputData;

            // Calculate collateral (100 CKB per token)
            const amountBigInt = BigInt(amount);
            const collateralPerToken = 100n * 100000000n; // 100 CKB in shannons
            const totalCollateral = collateralPerToken * amountBigInt;
            const newMarketCapacity = marketCell.cellOutput.capacity + totalCollateral;

            this.log(`Collateral required: ${ccc.fixedPointToString(totalCollateral)} CKB`, 'info');

            // Create token type script args (market type hash + token ID)
            const marketTypeHash = marketCell.cellOutput.type.hash();
            const yesTokenArgs = marketTypeHash + CONFIG.TOKEN_YES.slice(2);
            const noTokenArgs = marketTypeHash + CONFIG.TOKEN_NO.slice(2);

            this.log(`YES token args: ${yesTokenArgs}`, 'info');
            this.log(`NO token args: ${noTokenArgs}`, 'info');

            // Create token data (u128 amount as 16 bytes little-endian)
            const tokenData = new Uint8Array(16);
            const tokenView = new DataView(tokenData.buffer);
            tokenView.setBigUint64(0, amountBigInt, true); // Low 64 bits
            tokenView.setBigUint64(8, 0n, true);           // High 64 bits
            const tokenDataHex = '0x' + Array.from(tokenData).map(b => b.toString(16).padStart(2, '0')).join('');

            // Build transaction
            const tx = ccc.Transaction.from({
                inputs: [
                    { previousOutput: marketOutpoint }
                ],
                outputs: [
                    // Updated market cell
                    ccc.CellOutput.from({
                        capacity: newMarketCapacity,
                        lock: marketCell.cellOutput.lock,
                        type: marketCell.cellOutput.type
                    }),
                    // YES token cell
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(150),
                        lock: userLock,
                        type: ccc.Script.from({
                            codeHash: CONFIG.tokenCodeHash,
                            hashType: 'data1',
                            args: yesTokenArgs
                        })
                    }),
                    // NO token cell
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(150),
                        lock: userLock,
                        type: ccc.Script.from({
                            codeHash: CONFIG.tokenCodeHash,
                            hashType: 'data1',
                            args: noTokenArgs
                        })
                    })
                ],
                outputsData: [newMarketDataHex, tokenDataHex, tokenDataHex]
            });

            // Add cell deps
            this.log('Adding cell deps...', 'info');

            // Market contract dep (type script)
            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex },
                depType: 'code'
            }));

            // Token contract dep (type script)
            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex },
                depType: 'code'
            }));

            // AlwaysSuccess dep (for market cell's lock script)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);

            // Secp256k1 dep (for user's lock script)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);

            // Complete inputs for collateral + token cell capacity
            this.log('Adding inputs for collateral and fees...', 'info');
            await tx.completeInputsByCapacity(this.signer);

            // Add fee
            this.log('Adding fee...', 'info');
            await tx.completeFeeBy(this.signer, 1000);

            // Sign
            this.log('Please approve the transaction in JoyID...', 'info');
            const signedTx = await this.signer.signTransaction(tx);

            // Send
            this.log('Sending transaction...', 'info');
            const txHash = await this.client.sendTransaction(signedTx);

            this.log(`Minting successful! TX: ${txHash}`, 'success');
            this.log(`View on explorer: https://pudge.explorer.nervos.org/transaction/${txHash}`, 'info');
            this.log(`Minted ${amount} YES + ${amount} NO tokens`, 'success');

            await this.updateBalance();

            // Refresh market list to show updated state
            await this.listMarkets();

        } catch (error) {
            this.log(`Error minting tokens: ${error.message}`, 'error');
            console.error(error);
        }
    }

    async resolveForMarket(txHash, index, outcome) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect your wallet first', 'warning');
            return;
        }

        // Handle index format
        let indexHex;
        if (typeof index === 'string' && index.startsWith('0x')) {
            indexHex = index;
        } else {
            indexHex = `0x${Number(index).toString(16)}`;
        }

        const marketOutpoint = { txHash, index: indexHex };
        this.log(`Resolving market: ${txHash.slice(0, 10)}...:${indexHex} with outcome: ${outcome ? 'YES' : 'NO'}`, 'info');

        try {
            // Fetch the market cell
            this.log('Fetching market cell...', 'info');
            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) {
                this.log('Market cell not found - it may have been spent. Refreshing list...', 'warning');
                await this.listMarkets();
                throw new Error('Market cell not found');
            }

            // Parse current market data
            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData.length < 35) {
                throw new Error('Invalid market data: expected 35 bytes');
            }

            // Check if already resolved
            if (marketData[33] !== 0) {
                this.log('Market is already resolved!', 'warning');
                return;
            }

            this.log(`Current market capacity: ${ccc.fixedPointToString(marketCell.cellOutput.capacity)} CKB`, 'info');

            // Create new market data with resolution
            const newMarketData = new Uint8Array(35);
            newMarketData.set(marketData.slice(0, 32), 0);  // token_code_hash unchanged
            newMarketData[32] = marketData[32];              // hash_type unchanged
            newMarketData[33] = 1;                           // resolved = true
            newMarketData[34] = outcome ? 1 : 0;             // outcome

            const newMarketDataHex = '0x' + Array.from(newMarketData).map(b => b.toString(16).padStart(2, '0')).join('');

            this.log(`New market data: resolved=1, outcome=${outcome ? 1 : 0}`, 'info');

            // Build transaction - capacity stays the same, just change data
            const tx = ccc.Transaction.from({
                inputs: [
                    { previousOutput: marketOutpoint }
                ],
                outputs: [
                    ccc.CellOutput.from({
                        capacity: marketCell.cellOutput.capacity,  // Same capacity
                        lock: marketCell.cellOutput.lock,          // Same lock
                        type: marketCell.cellOutput.type           // Same type
                    })
                ],
                outputsData: [newMarketDataHex]
            });

            // Add cell deps
            this.log('Adding cell deps...', 'info');

            // Market contract dep
            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex },
                depType: 'code'
            }));

            // AlwaysSuccess dep (for market cell's lock script)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);

            // Secp256k1 dep (for user's lock script to pay fees)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);

            // Complete inputs for fees
            this.log('Adding fee inputs...', 'info');
            await tx.completeInputsByCapacity(this.signer);

            // Add fee
            await tx.completeFeeBy(this.signer, 1000);

            // Sign
            this.log('Please approve the transaction in JoyID...', 'info');
            const signedTx = await this.signer.signTransaction(tx);

            // Send
            this.log('Sending transaction...', 'info');
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Market resolved! TX: ${resultTxHash}`, 'success');
            this.log(`Winner: ${outcome ? 'YES' : 'NO'}`, 'success');
            this.log(`View on explorer: https://pudge.explorer.nervos.org/transaction/${resultTxHash}`, 'info');

            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error resolving market: ${error.message}`, 'error');
            console.error(error);
        }
    }

    async claimForMarket(txHash, index, amount, outcome) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect your wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        // Normalize outcome to boolean (could come as number 0/1 or boolean)
        const outcomeBool = outcome === true || outcome === 1 || outcome === '1' || outcome === 'true';

        // Handle index format
        let indexHex;
        if (typeof index === 'string' && index.startsWith('0x')) {
            indexHex = index;
        } else {
            indexHex = `0x${Number(index).toString(16)}`;
        }

        const marketOutpoint = { txHash, index: indexHex };
        const winningToken = outcomeBool ? 'YES' : 'NO';
        this.log(`Claiming ${amountInt} ${winningToken} tokens from market ${txHash.slice(0, 10)}...`, 'info');

        try {
            // Get user's lock script
            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            // Fetch the market cell
            this.log('Fetching market cell...', 'info');
            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) {
                this.log('Market cell not found - it may have been spent. Refreshing list...', 'warning');
                await this.listMarkets();
                throw new Error('Market cell not found');
            }

            // Parse market data
            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData.length < 35) {
                throw new Error('Invalid market data: expected 35 bytes');
            }

            // Verify market is resolved
            if (marketData[33] !== 1) {
                throw new Error('Market is not resolved yet');
            }

            // Verify outcome matches
            const storedOutcome = marketData[34] === 1;
            if (storedOutcome !== outcomeBool) {
                throw new Error(`Outcome mismatch: market resolved to ${storedOutcome ? 'YES' : 'NO'}, not ${winningToken}`);
            }

            const marketTypeHash = marketCell.cellOutput.type.hash();
            const tokenCodeHash = '0x' + Array.from(marketData.slice(0, 32))
                .map(b => b.toString(16).padStart(2, '0')).join('');

            // Build winning token args
            const winningTokenId = outcomeBool ? CONFIG.TOKEN_YES : CONFIG.TOKEN_NO;
            const winningTokenArgs = marketTypeHash + winningTokenId.slice(2);

            this.log(`Looking for ${winningToken} tokens with args: ${winningTokenArgs.slice(0, 20)}...`, 'info');

            // Find user's winning token cells
            const tokenTypeScript = ccc.Script.from({
                codeHash: tokenCodeHash,
                hashType: 'data1',
                args: winningTokenArgs
            });

            const tokenCells = [];
            let totalTokens = 0n;

            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                // Check if this cell belongs to the user
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const view = new DataView(data.buffer, 0, 16);
                        const cellAmount = view.getBigUint64(0, true);
                        tokenCells.push({ cell, amount: cellAmount });
                        totalTokens += cellAmount;
                        this.log(`Found token cell with ${cellAmount} tokens`, 'info');
                    }
                }
            }

            if (tokenCells.length === 0) {
                throw new Error(`No ${winningToken} tokens found in your wallet`);
            }

            const claimAmount = BigInt(amountInt);
            if (claimAmount > totalTokens) {
                throw new Error(`Insufficient tokens: you have ${totalTokens}, trying to claim ${claimAmount}`);
            }

            this.log(`Total ${winningToken} tokens found: ${totalTokens}`, 'info');

            // Calculate capacity to release (100 CKB per token)
            const collateralPerToken = 100n * 100000000n; // 100 CKB in shannons
            const capacityToRelease = collateralPerToken * claimAmount;
            const newMarketCapacity = marketCell.cellOutput.capacity - capacityToRelease;

            this.log(`Releasing ${ccc.fixedPointToString(capacityToRelease)} CKB from market`, 'info');

            // Build transaction inputs
            const inputs = [{ previousOutput: marketOutpoint }];

            // Collect enough token cells to cover the claim amount
            let collectedTokens = 0n;
            let collectedCapacity = 0n;
            const usedTokenCells = [];

            for (const { cell, amount: cellAmount } of tokenCells) {
                if (collectedTokens >= claimAmount) break;

                inputs.push({ previousOutput: cell.outPoint });
                usedTokenCells.push({ cell, amount: cellAmount });
                collectedTokens += cellAmount;
                collectedCapacity += cell.cellOutput.capacity;
            }

            // Build transaction outputs
            const outputs = [];
            const outputsData = [];

            // 1. Updated market cell (with reduced capacity, same data)
            outputs.push(ccc.CellOutput.from({
                capacity: newMarketCapacity,
                lock: marketCell.cellOutput.lock,
                type: marketCell.cellOutput.type
            }));
            outputsData.push(marketCell.outputData);

            // 2. Remaining tokens (if any)
            const remainingTokens = collectedTokens - claimAmount;
            if (remainingTokens > 0n) {
                const remainingTokenData = new Uint8Array(16);
                const remainingView = new DataView(remainingTokenData.buffer);
                remainingView.setBigUint64(0, remainingTokens, true);
                remainingView.setBigUint64(8, 0n, true);
                const remainingTokenDataHex = '0x' + Array.from(remainingTokenData).map(b => b.toString(16).padStart(2, '0')).join('');

                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(150), // 150 CKB for token cell
                    lock: userLock,
                    type: tokenTypeScript
                }));
                outputsData.push(remainingTokenDataHex);
            }

            // Build transaction
            const tx = ccc.Transaction.from({
                inputs,
                outputs,
                outputsData
            });

            // Add cell deps
            this.log('Adding cell deps...', 'info');

            // Market contract dep
            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex },
                depType: 'code'
            }));

            // Token contract dep
            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex },
                depType: 'code'
            }));

            // AlwaysSuccess dep (for market cell's lock script)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);

            // Secp256k1 dep (for user's lock script)
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);

            // Complete inputs for fees (will also add change output for released CKB)
            this.log('Adding fee inputs...', 'info');
            await tx.completeInputsByCapacity(this.signer);

            // Add fee
            await tx.completeFeeBy(this.signer, 1000);

            // Sign
            this.log('Please approve the transaction in JoyID...', 'info');
            const signedTx = await this.signer.signTransaction(tx);

            // Send
            this.log('Sending transaction...', 'info');
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Claim successful! TX: ${resultTxHash}`, 'success');
            this.log(`Claimed ${amountInt} ${winningToken} tokens for ${ccc.fixedPointToString(capacityToRelease)} CKB`, 'success');
            this.log(`View on explorer: https://pudge.explorer.nervos.org/transaction/${resultTxHash}`, 'info');

            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error claiming tokens: ${error.message}`, 'error');
            console.error(error);
        }
    }

    log(message, type = 'info') {
        const container = document.getElementById('log-container');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;

        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;

        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;

        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Initialize app
const app = new PredictionMarketApp();
window.app = app; // Make available for onclick handlers
app.init();
