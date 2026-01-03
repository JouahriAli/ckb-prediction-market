import { ccc } from "https://esm.sh/@ckb-ccc/ccc@1.1.22";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================
// Configuration
// ============================================

const CONFIG = {
    // Supabase
    supabaseUrl: 'https://klcfshiaxmzcmxhvzhkv.supabase.co',
    supabaseKey: 'sb_publishable_h7AK3_SLz8dcz1r5qCKX-w_kvqCz6zP',

    // Market contract
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

    // Cell capacity requirements (in CKB)
    // Calculated from: overhead + lock + type + data + safety margin
    CELL_CAPACITY: {
        MARKET: 200,      // Market cell (AlwaysSuccess lock + market type + 35 byte data)
        TOKEN: 170,       // Token cell (Secp256k1 lock + token type + 16-32 byte data)
        LIMIT_ORDER: 175, // Limit order cell (AlwaysSuccess lock with 32-byte args + token type + 32 byte data)
        CKB: 63,          // Pure CKB cell (Secp256k1 lock + no type + no data) - min ~61 CKB
    },

    appName: 'Verdict',
    appIcon: 'https://fav.farm/⚖️'
};

// Initialize Supabase
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// Detect page type
const isAdminPage = window.location.pathname.includes('admin');

console.log(`⚖️ Verdict loaded - ${isAdminPage ? 'Admin' : 'User'} mode`);

// ============================================
// Main App Class
// ============================================

class VerdictApp {
    constructor() {
        this.client = null;
        this.signer = null;
        this.orderBooks = {}; // Store order books by marketIndex
    }

    async init() {
        this.log('Initializing...', 'info');

        // Initialize CKB client
        this.client = new ccc.ClientPublicTestnet();

        // Initialize JoyID signer
        this.signer = new ccc.JoyId.CkbSigner(
            this.client,
            CONFIG.appName,
            CONFIG.appIcon
        );

        // Check existing connection
        if (await this.signer.isConnected()) {
            await this.updateWalletUI();
        }

        // Update network status
        await this.updateNetworkStatus();
        setInterval(() => this.updateNetworkStatus(), 15000);

        // Auto-load markets
        await this.listMarkets();

        this.log('Ready', 'success');
    }

    // ============================================
    // Wallet Management
    // ============================================

    async connectWallet() {
        const btn = document.getElementById('btn-connect');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Connecting...';

        try {
            await this.signer.connect();
            await this.updateWalletUI();
            this.log('Wallet connected', 'success');
            await this.listMarkets();
        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Connect Wallet';
        }
    }

    async disconnectWallet() {
        await this.signer.disconnect();
        document.getElementById('wallet-info').style.display = 'none';
        document.getElementById('btn-connect').style.display = 'block';
        document.getElementById('btn-disconnect').style.display = 'none';
        this.log('Wallet disconnected', 'info');
    }

    async updateWalletUI() {
        const address = await this.signer.getRecommendedAddress();
        const shortAddr = address.slice(0, 10) + '...' + address.slice(-6);

        this.fullAddress = address; // Store full address for copying
        document.getElementById('wallet-address').textContent = shortAddr + ' 📋';
        document.getElementById('wallet-info').style.display = 'block';
        document.getElementById('btn-connect').style.display = 'none';
        document.getElementById('btn-disconnect').style.display = 'block';

        await this.updateBalance();
    }

    async copyAddress() {
        if (!this.fullAddress) return;

        try {
            await navigator.clipboard.writeText(this.fullAddress);
            const el = document.getElementById('wallet-address');
            const originalText = el.textContent;
            el.textContent = '✓ Copied!';
            setTimeout(() => {
                el.textContent = originalText;
            }, 2000);
            this.log('Address copied to clipboard', 'success');
        } catch (error) {
            this.log('Failed to copy address', 'error');
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

            document.getElementById('wallet-balance').textContent = ccc.fixedPointToString(balance);
        } catch (error) {
            console.error('Balance error:', error);
        }
    }

    async updateNetworkStatus() {
        try {
            const tip = await this.client.getTip();
            const el = document.getElementById('block-height');
            if (el) el.textContent = Number(tip).toLocaleString();

            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = 'Connected';
                statusEl.style.color = 'var(--ckb-green)';
            }
        } catch (error) {
            const statusEl = document.getElementById('connection-status');
            if (statusEl) {
                statusEl.textContent = 'Disconnected';
                statusEl.style.color = 'var(--no-red)';
            }
        }
    }

    // ============================================
    // Token Balance
    // ============================================

    async getUserTokenBalance(marketTypeHash, tokenCodeHash, tokenId) {
        try {
            if (!await this.signer.isConnected()) return 0n;

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            const tokenArgs = marketTypeHash + tokenId.slice(2);
            const tokenTypeScript = ccc.Script.from({
                codeHash: tokenCodeHash,
                hashType: 'data1',
                args: tokenArgs
            });

            let total = 0n;
            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const view = new DataView(data.buffer, 0, 16);
                        total += view.getBigUint64(0, true);
                    }
                }
            }
            return total;
        } catch (error) {
            console.error('Token balance error:', error);
            return 0n;
        }
    }

    // ============================================
    // List Markets
    // ============================================

    async listMarkets() {
        const listContainer = document.getElementById('markets-list');
        const refreshBtn = document.getElementById('btn-refresh');

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<span class="spinner"></span> Loading...';
        }

        try {
            const markets = [];

            const marketTypeScript = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: '0x'
            });

            for await (const cell of this.client.findCells({
                script: marketTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'prefix'
            })) {
                try {
                    if (!cell || !cell.cellOutput) continue;  // Skip if cell is invalid

                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 35) {
                        const tokenCodeHash = '0x' + Array.from(data.slice(0, 32))
                            .map(b => b.toString(16).padStart(2, '0')).join('');

                        markets.push({
                            outpoint: cell.outPoint,
                            typeId: cell.cellOutput.type.args,
                            marketTypeHash: cell.cellOutput.type.hash(),
                            tokenCodeHash,
                            hashType: data[32],
                            resolved: data[33] !== 0,
                            outcome: data[34] !== 0,
                            capacity: cell.cellOutput.capacity
                        });

                        if (markets.length >= 20) break;
                    }
                } catch (error) {
                    console.error('Error processing market cell:', error);
                    continue;  // Skip this cell and continue with others
                }
            }

            // Fetch metadata from Supabase (including created_at for sorting)
            const metadataMap = {};
            if (markets.length > 0) {
                const { data: rows } = await supabase
                    .from('markets')
                    .select('type_hash, question, description, created_at')
                    .in('type_hash', markets.map(m => m.marketTypeHash));

                if (rows) {
                    for (const row of rows) {
                        metadataMap[row.type_hash] = row;
                    }
                }
            }

            // Attach metadata and fetch balances
            for (const market of markets) {
                const meta = metadataMap[market.marketTypeHash];
                market.question = meta?.question || null;
                market.description = meta?.description || null;
                market.createdAt = meta?.created_at || null;

                if (await this.signer.isConnected()) {
                    market.yesBalance = await this.getUserTokenBalance(
                        market.marketTypeHash, market.tokenCodeHash, CONFIG.TOKEN_YES
                    );
                    market.noBalance = await this.getUserTokenBalance(
                        market.marketTypeHash, market.tokenCodeHash, CONFIG.TOKEN_NO
                    );
                } else {
                    market.yesBalance = 0n;
                    market.noBalance = 0n;
                }
            }

            // Sort markets by created_at (newest first)
            markets.sort((a, b) => {
                if (!a.createdAt && !b.createdAt) return 0;
                if (!a.createdAt) return 1;  // Markets without date go to end
                if (!b.createdAt) return -1;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            // Render markets
            this.renderMarkets(markets, listContainer);
            this.log(`Found ${markets.length} market(s)`, 'success');

        } catch (error) {
            this.log(`Error loading markets: ${error.message}`, 'error');
            listContainer.innerHTML = `<div class="empty-state"><h3>Error loading markets</h3><p>${error.message}</p></div>`;
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = 'Refresh';
            }
        }
    }

    renderMarkets(markets, container) {
        if (markets.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No markets found</h3>
                    <p>${isAdminPage ? 'Create a new market above.' : 'Check back later or ask an admin to create one.'}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = markets.map((m, i) => this.renderMarketCard(m, i)).join('');
    }

    renderMarketCard(market, index) {
        const statusClass = market.resolved ? 'resolved' : 'active';
        const statusText = market.resolved ? 'Resolved' : 'Active';

        let actionsHtml = '';

        if (market.resolved) {
            // Resolved: show winner and claim button if user has winning tokens
            const winningBalance = market.outcome ? market.yesBalance : market.noBalance;
            actionsHtml = `
                <div class="market-winner">
                    <div class="label">Winner</div>
                    <div class="value">${market.outcome ? 'YES' : 'NO'}</div>
                </div>
                ${winningBalance > 0n ? `
                    <div class="market-actions">
                        <input type="number" class="input input-sm" id="claim-${index}" value="${winningBalance}" min="1" max="${winningBalance}">
                        <button class="btn btn-warning" onclick="app.claimForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', document.getElementById('claim-${index}').value, ${market.outcome})">
                            Claim ${ccc.fixedPointToString(winningBalance * 10000000000n)} CKB
                        </button>
                    </div>
                ` : ''}
            `;
        } else if (isAdminPage) {
            // Admin: show resolve buttons
            actionsHtml = `
                <div class="market-actions">
                    <button class="btn btn-success" onclick="app.resolveForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', true)">
                        Resolve: YES Wins
                    </button>
                    <button class="btn btn-danger" onclick="app.resolveForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', false)">
                        Resolve: NO Wins
                    </button>
                </div>
            `;
        } else {
            // User: show mint button + burn button if has tokens
            const canBurn = market.yesBalance > 0n && market.noBalance > 0n;
            const maxBurn = market.yesBalance < market.noBalance ? market.yesBalance : market.noBalance;

            actionsHtml = `
                <div class="market-actions">
                    <input type="number" class="input input-sm" id="mint-${index}" value="10" min="1" placeholder="Amount">
                    <button class="btn btn-primary" onclick="app.mintForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', document.getElementById('mint-${index}').value)">
                        Mint Tokens
                    </button>
                </div>
                ${canBurn ? `
                <div class="market-actions" style="margin-top: 12px;">
                    <input type="number" class="input input-sm" id="burn-${index}" value="${maxBurn}" min="1" max="${maxBurn}" placeholder="Amount">
                    <button class="btn btn-secondary" onclick="app.burnForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', document.getElementById('burn-${index}').value)">
                        Burn & Redeem ${maxBurn > 0n ? ccc.fixedPointToString(maxBurn * 10000000000n) + ' CKB' : ''}
                    </button>
                </div>
                ` : ''}
            `;
        }

        return `
            <div class="market-card">
                <div class="market-header">
                    <div>
                        <div class="market-question">${market.question || `Market #${index + 1}`}</div>
                        ${market.description ? `<div class="market-description">${market.description}</div>` : ''}
                    </div>
                    <span class="market-status ${statusClass}">${statusText}</span>
                </div>
                <div class="market-meta">
                    <span title="${market.typeId}">ID: ${market.typeId.slice(0, 8)}...${market.typeId.slice(-6)}</span>
                    <span>Collateral: ${ccc.fixedPointToString(market.capacity)} CKB</span>
                </div>
                <div class="market-tokens">
                    <div class="token-balance">
                        <div class="token-label">Your YES</div>
                        <div class="token-value yes">${market.yesBalance}</div>
                    </div>
                    <div class="token-balance">
                        <div class="token-label">Your NO</div>
                        <div class="token-value no">${market.noBalance}</div>
                    </div>
                </div>

                <!-- Order Book Section -->
                ${!market.resolved ? `
                <div class="order-book-section">
                    <button class="btn btn-sm btn-secondary" onclick="app.toggleOrderBook(${index}, '${market.outpoint.txHash}', '${market.outpoint.index}')">
                        <span id="orderbook-arrow-${index}">▶</span> View Order Book
                    </button>
                    <div class="order-book-container" id="orderbook-${index}" style="display: none;">
                        <div class="order-book-content">
                            <div class="order-book-side">
                                <h4>YES Orders</h4>
                                <div class="order-list" id="orderbook-yes-${index}">
                                    <div class="empty-orders">No orders yet</div>
                                </div>
                            </div>
                            <div class="order-book-side">
                                <h4>NO Orders</h4>
                                <div class="order-list" id="orderbook-no-${index}">
                                    <div class="empty-orders">No orders yet</div>
                                </div>
                            </div>
                        </div>

                        <!-- Create Order Form -->
                        <div class="create-order-form">
                            <h4>Create Limit Sell Order</h4>
                            <div class="order-inputs">
                                <select class="input input-sm" id="order-token-${index}">
                                    <option value="YES">YES</option>
                                    <option value="NO">NO</option>
                                </select>
                                <input type="number" class="input input-sm" id="order-amount-${index}" placeholder="Amount" min="1">
                                <input type="number" class="input input-sm" id="order-price-${index}" placeholder="Price (CKB)" min="0.01" step="0.01">
                                <button class="btn btn-warning btn-sm" onclick="app.createLimitOrder('${market.outpoint.txHash}', '${market.outpoint.index}', document.getElementById('order-token-${index}').value, document.getElementById('order-amount-${index}').value, document.getElementById('order-price-${index}').value, ${index})">
                                    Create Order
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                ` : ''}

                ${actionsHtml}
            </div>
        `;
    }

    // ============================================
    // Create Market (Admin)
    // ============================================

    async createMarket() {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const question = document.getElementById('market-question')?.value?.trim();
        const description = document.getElementById('market-description')?.value?.trim() || '';

        if (!question) {
            this.log('Please enter a question', 'warning');
            return;
        }

        const btn = document.getElementById('btn-create');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Creating...';

        try {
            this.log('Creating market...', 'info');

            const lockScript = await ccc.Script.fromKnownScript(
                this.client,
                ccc.KnownScript.AlwaysSuccess,
                '0x'
            );

            const placeholderTypeId = '0x' + '00'.repeat(32);
            const marketTypeScript = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: placeholderTypeId
            });

            // Market data: token_code_hash(32) + hash_type(1) + resolved(1) + outcome(1)
            const marketData = new Uint8Array(35);
            marketData.set(ccc.bytesFrom(CONFIG.tokenCodeHash), 0);
            marketData[32] = 2; // Data1
            marketData[33] = 0; // Not resolved
            marketData[34] = 0; // No outcome

            const marketDataHex = '0x' + Array.from(marketData).map(b => b.toString(16).padStart(2, '0')).join('');

            const tx = ccc.Transaction.from({
                outputs: [
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.MARKET),
                        lock: lockScript,
                        type: marketTypeScript
                    })
                ],
                outputsData: [marketDataHex]
            });

            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex },
                depType: 'code'
            }));

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeInputsByCapacity(this.signer);  // Add inputs to cover outputs + fees
            await tx.completeFeeBy(this.signer, 1000);  // Add fee, create change output

            // Find market output and calculate Type ID
            let marketOutputIndex = tx.outputs.findIndex(o => o.type?.codeHash === CONFIG.marketCodeHash);
            const firstInput = tx.inputs[0];

            const outpointBytes = new Uint8Array(36);
            outpointBytes.set(ccc.bytesFrom(firstInput.previousOutput.txHash), 0);
            new DataView(outpointBytes.buffer, 32, 4).setUint32(0, parseInt(firstInput.previousOutput.index), true);

            const typeIdInput = new Uint8Array(44);
            typeIdInput.set(outpointBytes, 0);
            new DataView(typeIdInput.buffer, 36, 8).setBigUint64(0, BigInt(marketOutputIndex), true);

            const typeId = ccc.hashCkb(ccc.hexFrom(typeIdInput));

            tx.outputs[marketOutputIndex].type = ccc.Script.from({
                codeHash: CONFIG.marketCodeHash,
                hashType: 'data1',
                args: typeId
            });

            this.log('Signing transaction...', 'info');
            const signedTx = await this.signer.signTransaction(tx);

            this.log('Sending transaction...', 'info');
            const txHash = await this.client.sendTransaction(signedTx);

            // Save to Supabase
            const marketTypeHash = tx.outputs[marketOutputIndex].type.hash();
            await supabase.from('markets').insert({
                type_hash: marketTypeHash,
                question,
                description
            });

            this.log(`Market created! TX: ${txHash}`, 'success');

            document.getElementById('market-question').value = '';
            document.getElementById('market-description').value = '';

            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Create Market';
        }
    }

    // ============================================
    // Mint Tokens (User)
    // ============================================

    async mintForMarket(txHash, index, amount) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };

        try {
            this.log(`Minting ${amountInt} complete sets...`, 'info');

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) throw new Error('Market cell not found');

            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData[33] !== 0) throw new Error('Market is already resolved');

            const collateralPerToken = 100n * 100000000n;
            const totalCollateral = collateralPerToken * BigInt(amountInt);
            const newMarketCapacity = marketCell.cellOutput.capacity + totalCollateral;

            const marketTypeHash = marketCell.cellOutput.type.hash();
            const yesTokenArgs = marketTypeHash + CONFIG.TOKEN_YES.slice(2);
            const noTokenArgs = marketTypeHash + CONFIG.TOKEN_NO.slice(2);

            const tokenData = new Uint8Array(16);
            new DataView(tokenData.buffer).setBigUint64(0, BigInt(amountInt), true);
            const tokenDataHex = '0x' + Array.from(tokenData).map(b => b.toString(16).padStart(2, '0')).join('');

            const tx = ccc.Transaction.from({
                inputs: [{ previousOutput: marketOutpoint }],
                outputs: [
                    ccc.CellOutput.from({
                        capacity: newMarketCapacity,
                        lock: marketCell.cellOutput.lock,
                        type: marketCell.cellOutput.type
                    }),
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                        lock: userLock,
                        type: ccc.Script.from({ codeHash: CONFIG.tokenCodeHash, hashType: 'data1', args: yesTokenArgs })
                    }),
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                        lock: userLock,
                        type: ccc.Script.from({ codeHash: CONFIG.tokenCodeHash, hashType: 'data1', args: noTokenArgs })
                    })
                ],
                outputsData: [marketCell.outputData, tokenDataHex, tokenDataHex]
            });

            tx.cellDeps.push(
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex }, depType: 'code' }),
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex }, depType: 'code' })
            );

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeInputsByCapacity(this.signer);  // Add inputs to cover outputs
            await tx.completeFeeBy(this.signer, 1000);  // Add fee, create change output

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Minted ${amountInt} YES + ${amountInt} NO! TX: ${resultTxHash}`, 'success');
            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Burn Tokens (User) - Redeem complete sets
    // ============================================

    async burnForMarket(txHash, index, amount) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };

        try {
            this.log(`Burning ${amountInt} complete sets...`, 'info');

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) throw new Error('Market cell not found');

            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData[33] !== 0) throw new Error('Market is already resolved - use claim instead');

            // Verify market's token_code_hash matches current config (critical for contract validation)
            const storedTokenCodeHash = '0x' + Array.from(marketData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');
            if (storedTokenCodeHash !== CONFIG.tokenCodeHash) {
                console.error('Token code hash mismatch!');
                console.error('Market stored:', storedTokenCodeHash);
                console.error('Config:', CONFIG.tokenCodeHash);
                throw new Error('Market uses outdated token contract. Create a new market with current contracts.');
            }

            const marketTypeHash = marketCell.cellOutput.type.hash();

            // Use CONFIG.tokenCodeHash directly (same as minting) for consistency
            const yesTokenArgs = marketTypeHash + CONFIG.TOKEN_YES.slice(2);
            const noTokenArgs = marketTypeHash + CONFIG.TOKEN_NO.slice(2);

            const yesTypeScript = ccc.Script.from({
                codeHash: CONFIG.tokenCodeHash,
                hashType: 'data1',
                args: yesTokenArgs
            });
            const noTypeScript = ccc.Script.from({
                codeHash: CONFIG.tokenCodeHash,
                hashType: 'data1',
                args: noTokenArgs
            });

            // Find YES token cells (same pattern as claim)
            const yesCells = [];
            let yesTotal = 0n;
            for await (const cell of this.client.findCells({
                script: yesTypeScript, scriptType: 'type', scriptSearchMode: 'exact'
            })) {
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const cellAmount = new DataView(data.buffer, 0, 16).getBigUint64(0, true);
                        yesCells.push({ cell, amount: cellAmount });
                        yesTotal += cellAmount;
                    }
                }
            }

            // Find NO token cells (same pattern as claim)
            const noCells = [];
            let noTotal = 0n;
            for await (const cell of this.client.findCells({
                script: noTypeScript, scriptType: 'type', scriptSearchMode: 'exact'
            })) {
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const cellAmount = new DataView(data.buffer, 0, 16).getBigUint64(0, true);
                        noCells.push({ cell, amount: cellAmount });
                        noTotal += cellAmount;
                    }
                }
            }

            const burnAmount = BigInt(amountInt);
            if (burnAmount > yesTotal) throw new Error(`Insufficient YES tokens: have ${yesTotal}, need ${burnAmount}`);
            if (burnAmount > noTotal) throw new Error(`Insufficient NO tokens: have ${noTotal}, need ${burnAmount}`);

            // Calculate capacity to release (100 CKB per complete set)
            const collateralPerToken = 100n * 100000000n;
            const capacityToRelease = collateralPerToken * burnAmount;
            const newMarketCapacity = marketCell.cellOutput.capacity - capacityToRelease;

            // Build inputs: market cell first, then YES cells, then NO cells
            const inputs = [{ previousOutput: marketOutpoint }];
            let collectedYes = 0n;
            let collectedNo = 0n;

            // Add YES cells (same pattern as claim)
            for (const { cell, amount: cellAmount } of yesCells) {
                if (collectedYes >= burnAmount) break;
                inputs.push({ previousOutput: cell.outPoint });
                collectedYes += cellAmount;
            }

            // Add NO cells (same pattern as claim)
            for (const { cell, amount: cellAmount } of noCells) {
                if (collectedNo >= burnAmount) break;
                inputs.push({ previousOutput: cell.outPoint });
                collectedNo += cellAmount;
            }

            // Build outputs: updated market cell + remaining tokens
            const outputs = [
                ccc.CellOutput.from({
                    capacity: newMarketCapacity,
                    lock: marketCell.cellOutput.lock,
                    type: marketCell.cellOutput.type
                })
            ];
            const outputsData = [marketCell.outputData];

            // Remaining YES tokens (if any)
            const remainingYes = collectedYes - burnAmount;
            if (remainingYes > 0n) {
                const remainingData = new Uint8Array(16);
                new DataView(remainingData.buffer).setBigUint64(0, remainingYes, true);
                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                    lock: userLock,
                    type: yesTypeScript
                }));
                outputsData.push('0x' + Array.from(remainingData).map(b => b.toString(16).padStart(2, '0')).join(''));
            }

            // Remaining NO tokens (if any)
            const remainingNo = collectedNo - burnAmount;
            if (remainingNo > 0n) {
                const remainingData = new Uint8Array(16);
                new DataView(remainingData.buffer).setBigUint64(0, remainingNo, true);
                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                    lock: userLock,
                    type: noTypeScript
                }));
                outputsData.push('0x' + Array.from(remainingData).map(b => b.toString(16).padStart(2, '0')).join(''));
            }

            const tx = ccc.Transaction.from({ inputs, outputs, outputsData });

            tx.cellDeps.push(
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex }, depType: 'code' }),
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex }, depType: 'code' })
            );

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeFeeBy(this.signer, 1000);  // Send released collateral + token capacity to user

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Burned ${amountInt} sets! Redeemed ${ccc.fixedPointToString(capacityToRelease)} CKB. TX: ${resultTxHash}`, 'success');
            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Resolve Market (Admin)
    // ============================================

    async resolveForMarket(txHash, index, outcome) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };

        try {
            this.log(`Resolving market with outcome: ${outcome ? 'YES' : 'NO'}...`, 'info');

            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) throw new Error('Market cell not found');

            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData[33] !== 0) {
                this.log('Market is already resolved', 'warning');
                return;
            }

            const newMarketData = new Uint8Array(35);
            newMarketData.set(marketData.slice(0, 32), 0);
            newMarketData[32] = marketData[32];
            newMarketData[33] = 1;
            newMarketData[34] = outcome ? 1 : 0;

            const newMarketDataHex = '0x' + Array.from(newMarketData).map(b => b.toString(16).padStart(2, '0')).join('');

            const tx = ccc.Transaction.from({
                inputs: [{ previousOutput: marketOutpoint }],
                outputs: [
                    ccc.CellOutput.from({
                        capacity: marketCell.cellOutput.capacity,
                        lock: marketCell.cellOutput.lock,
                        type: marketCell.cellOutput.type
                    })
                ],
                outputsData: [newMarketDataHex]
            });

            tx.cellDeps.push(ccc.CellDep.from({
                outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex },
                depType: 'code'
            }));

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeInputsByCapacity(this.signer);  // Add inputs to cover outputs
            await tx.completeFeeBy(this.signer, 1000);  // Add fee, create change output

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Market resolved! Winner: ${outcome ? 'YES' : 'NO'} TX: ${resultTxHash}`, 'success');
            this.log('Waiting for transaction to be indexed...', 'info');

            // Wait a bit for transaction to be indexed before refreshing
            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Claim Winnings
    // ============================================

    async claimForMarket(txHash, index, amount, outcome) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        const outcomeBool = outcome === true || outcome === 1 || outcome === '1' || outcome === 'true';
        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };
        const winningToken = outcomeBool ? 'YES' : 'NO';

        try {
            this.log(`Claiming ${amountInt} ${winningToken} tokens...`, 'info');

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) throw new Error('Market cell not found');

            const marketData = new Uint8Array(ccc.bytesFrom(marketCell.outputData));
            if (marketData[33] !== 1) throw new Error('Market is not resolved');

            const storedOutcome = marketData[34] === 1;
            if (storedOutcome !== outcomeBool) throw new Error('Outcome mismatch');

            // Verify market's token_code_hash matches current config (critical for contract validation)
            const storedTokenCodeHash = '0x' + Array.from(marketData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');
            if (storedTokenCodeHash !== CONFIG.tokenCodeHash) {
                console.error('Token code hash mismatch!');
                console.error('Market stored:', storedTokenCodeHash);
                console.error('Config:', CONFIG.tokenCodeHash);
                throw new Error('Market uses outdated token contract. Create a new market with current contracts.');
            }

            const marketTypeHash = marketCell.cellOutput.type.hash();

            // Use CONFIG.tokenCodeHash directly (same as minting) for consistency
            const winningTokenId = outcomeBool ? CONFIG.TOKEN_YES : CONFIG.TOKEN_NO;
            const winningTokenArgs = marketTypeHash + winningTokenId.slice(2);

            const tokenTypeScript = ccc.Script.from({
                codeHash: CONFIG.tokenCodeHash,
                hashType: 'data1',
                args: winningTokenArgs
            });

            // Find token cells
            const tokenCells = [];
            let totalTokens = 0n;

            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        const cellAmount = new DataView(data.buffer, 0, 16).getBigUint64(0, true);
                        tokenCells.push({ cell, amount: cellAmount });
                        totalTokens += cellAmount;
                    }
                }
            }

            if (tokenCells.length === 0) throw new Error('No winning tokens found');

            const claimAmount = BigInt(amountInt);
            if (claimAmount > totalTokens) throw new Error('Insufficient tokens');

            const collateralPerToken = 100n * 100000000n;
            const capacityToRelease = collateralPerToken * claimAmount;
            const newMarketCapacity = marketCell.cellOutput.capacity - capacityToRelease;

            const inputs = [{ previousOutput: marketOutpoint }];
            let collectedTokens = 0n;

            for (const { cell, amount: cellAmount } of tokenCells) {
                if (collectedTokens >= claimAmount) break;
                inputs.push({ previousOutput: cell.outPoint });
                collectedTokens += cellAmount;
            }

            const outputs = [
                ccc.CellOutput.from({
                    capacity: newMarketCapacity,
                    lock: marketCell.cellOutput.lock,
                    type: marketCell.cellOutput.type
                })
            ];
            const outputsData = [marketCell.outputData];

            const remainingTokens = collectedTokens - claimAmount;
            if (remainingTokens > 0n) {
                const remainingData = new Uint8Array(16);
                new DataView(remainingData.buffer).setBigUint64(0, remainingTokens, true);
                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                    lock: userLock,
                    type: tokenTypeScript
                }));
                outputsData.push('0x' + Array.from(remainingData).map(b => b.toString(16).padStart(2, '0')).join(''));
            }

            const tx = ccc.Transaction.from({ inputs, outputs, outputsData });

            tx.cellDeps.push(
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.marketTxHash, index: CONFIG.marketIndex }, depType: 'code' }),
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex }, depType: 'code' })
            );

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeFeeBy(this.signer, 1000);  // Send released collateral + token capacity to user

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Claimed ${amountInt} tokens for ${ccc.fixedPointToString(capacityToRelease)} CKB! TX: ${resultTxHash}`, 'success');
            await this.updateBalance();
            await this.listMarkets();

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Create Limit Order - Set price on tokens
    // ============================================

    async createLimitOrder(txHash, index, tokenType, amount, pricePerToken, marketArrayIndex = null) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const amountInt = parseInt(amount);
        const price = parseFloat(pricePerToken);

        if (!amountInt || amountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        if (!price || price <= 0) {
            this.log('Please enter a valid price', 'warning');
            return;
        }

        const isYes = tokenType.toUpperCase() === 'YES';
        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };

        try {
            this.log(`Creating limit sell order: ${amountInt} ${tokenType} @ ${price} CKB each...`, 'info');

            const address = await this.signer.getRecommendedAddress();
            const { script: userLock } = await ccc.Address.fromString(address, this.client);

            // Get market cell to extract market type hash
            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) throw new Error('Market cell not found');

            const marketTypeHash = marketCell.cellOutput.type.hash();
            const tokenId = isYes ? CONFIG.TOKEN_YES : CONFIG.TOKEN_NO;
            const tokenArgs = marketTypeHash + tokenId.slice(2);

            const tokenTypeScript = ccc.Script.from({
                codeHash: CONFIG.tokenCodeHash,
                hashType: 'data1',
                args: tokenArgs
            });

            // Find user's token cells
            const tokenCells = [];
            let totalTokens = 0n;
            let availableTokens = 0n; // Tokens not already in limit orders

            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                if (cell.cellOutput.lock.hash() === userLock.hash()) {
                    const data = new Uint8Array(ccc.bytesFrom(cell.outputData));
                    if (data.length >= 16) {
                        // Parse amount from first 16 bytes
                        const cellAmount = new DataView(data.buffer, 0, 16).getBigUint64(0, true);

                        // Check if already has a limit price (bytes 16-32)
                        let existingPrice = 0n;
                        if (data.length >= 32) {
                            existingPrice = new DataView(data.buffer, 16, 16).getBigUint64(0, true);
                        }

                        const hasPrice = existingPrice > 0n;
                        tokenCells.push({ cell, amount: cellAmount, hasPrice });
                        totalTokens += cellAmount;
                        if (!hasPrice) availableTokens += cellAmount;
                    }
                }
            }

            if (tokenCells.length === 0) {
                throw new Error(`No ${tokenType} tokens found`);
            }

            const orderAmount = BigInt(amountInt);
            if (orderAmount > availableTokens) {
                throw new Error(`Insufficient available tokens. You have ${availableTokens} available (${totalTokens} total, some already in orders)`);
            }

            // Convert price to CKB shanons (1 CKB = 10^8 shanons)
            const limitPrice = BigInt(Math.floor(price * 100000000));

            // Collect inputs until we have enough tokens
            // Only use cells that are NOT already limit orders (hasPrice === false)
            const inputs = [];
            let collectedTokens = 0n;

            for (const { cell, amount: cellAmount, hasPrice } of tokenCells) {
                if (hasPrice) continue; // Skip cells that are already limit orders
                if (collectedTokens >= orderAmount) break;
                inputs.push({ previousOutput: cell.outPoint });
                collectedTokens += cellAmount;
            }

            // Create output with limit order using AlwaysSuccess lock
            // Store seller's lock hash in lock.args for contract validation
            const sellerLockHash = userLock.hash();
            const sellerLockHashHex = typeof sellerLockHash === 'string'
                ? sellerLockHash
                : '0x' + Array.from(sellerLockHash).map(b => b.toString(16).padStart(2, '0')).join('');

            const alwaysSuccessLock = await ccc.Script.fromKnownScript(
                this.client,
                ccc.KnownScript.AlwaysSuccess,
                sellerLockHashHex  // Seller's lock hash in args
            );

            // Simple 32-byte data format: amount(16) + limit_price(16)
            const orderData = new Uint8Array(32);
            new DataView(orderData.buffer).setBigUint64(0, orderAmount, true); // amount
            new DataView(orderData.buffer, 16).setBigUint64(0, limitPrice, true); // limit_price
            const orderDataHex = '0x' + Array.from(orderData).map(b => b.toString(16).padStart(2, '0')).join('');

            const outputs = [
                ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.LIMIT_ORDER),
                    lock: alwaysSuccessLock,  // AlwaysSuccess so anyone can fill
                    type: tokenTypeScript
                })
            ];
            const outputsData = [orderDataHex];

            // If we collected more than needed, create change cell (no price, for holding)
            const remainingTokens = collectedTokens - orderAmount;
            if (remainingTokens > 0n) {
                const changeData = new Uint8Array(32);
                new DataView(changeData.buffer).setBigUint64(0, remainingTokens, true); // amount
                new DataView(changeData.buffer, 16).setBigUint64(0, 0n, true); // no price (holding)
                const changeDataHex = '0x' + Array.from(changeData).map(b => b.toString(16).padStart(2, '0')).join('');

                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                    lock: userLock,
                    type: tokenTypeScript
                }));
                outputsData.push(changeDataHex);
            }

            const tx = ccc.Transaction.from({ inputs, outputs, outputsData });

            // Add cell deps for token contract and AlwaysSuccess
            tx.cellDeps.push(
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex }, depType: 'code' })
            );

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeInputsByCapacity(this.signer);  // Add inputs to cover outputs
            await tx.completeFeeBy(this.signer, 1000);  // Add fee, create change output

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            // Store seller's address in Supabase for order book lookups
            await supabase.from('limit_orders').insert({
                tx_hash: resultTxHash,
                output_index: 0,
                market_tx_hash: txHash,
                market_index: index,
                token_type: tokenType.toUpperCase(),
                seller_address: address,
                amount: amountInt,
                price_ckb: price,
                status: 'active'
            });

            this.log(`Limit order created! ${amountInt} ${tokenType} @ ${price} CKB. TX: ${resultTxHash}`, 'success');
            await this.updateBalance();

            // Reload order book if it's open (check if container is visible)
            if (marketArrayIndex !== null) {
                const container = document.getElementById(`orderbook-${marketArrayIndex}`);
                if (container && container.style.display !== 'none') {
                    await this.loadOrderBooks(marketArrayIndex, txHash, index);
                }
            }

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Get Order Book - Query all sell orders
    // ============================================

    async getOrderBook(txHash, index, tokenType) {
        const isYes = tokenType.toUpperCase() === 'YES';
        const indexHex = typeof index === 'string' && index.startsWith('0x') ? index : `0x${Number(index).toString(16)}`;
        const marketOutpoint = { txHash, index: indexHex };

        try {
            // Get market cell to extract market type hash
            const marketCell = await this.client.getCell(marketOutpoint);
            if (!marketCell) {
                throw new Error('Market cell not found');
            }

            const marketTypeHash = marketCell.cellOutput.type.hash();
            const tokenId = isYes ? CONFIG.TOKEN_YES : CONFIG.TOKEN_NO;
            const tokenArgs = marketTypeHash + tokenId.slice(2);

            const tokenTypeScript = ccc.Script.from({
                codeHash: CONFIG.tokenCodeHash,
                hashType: 'data1',
                args: tokenArgs
            });

            // Find all token cells with limit orders
            const orders = [];

            for await (const cell of this.client.findCells({
                script: tokenTypeScript,
                scriptType: 'type',
                scriptSearchMode: 'exact'
            })) {
                const data = new Uint8Array(ccc.bytesFrom(cell.outputData));

                // Process cells with 32-byte data format: amount(16) + limit_price(16)
                if (data.length >= 32) {
                    const amount = new DataView(data.buffer, 0, 16).getBigUint64(0, true);
                    const limitPrice = new DataView(data.buffer, 16, 16).getBigUint64(0, true);

                    // Only include orders with price > 0
                    if (limitPrice > 0n) {
                        const priceInCKB = Number(limitPrice) / 100000000;
                        const totalCKB = Number(amount) * priceInCKB;

                        // Look up seller address from Supabase
                        const outPointKey = `${cell.outPoint.txHash}:${cell.outPoint.index}`;
                        const { data: orderData } = await supabase
                            .from('limit_orders')
                            .select('seller_address')
                            .eq('tx_hash', cell.outPoint.txHash)
                            .eq('output_index', Number(cell.outPoint.index))
                            .single();

                        if (orderData?.seller_address) {
                            const { script: sellerLock } = await ccc.Address.fromString(orderData.seller_address, this.client);

                            orders.push({
                                outPoint: cell.outPoint,
                                amount: amount,
                                limitPrice: limitPrice,
                                pricePerToken: priceInCKB,
                                totalCKB: totalCKB,
                                cell: cell,
                                sellerLock: sellerLock,
                                sellerAddress: orderData.seller_address
                            });
                        }
                    }
                }
            }

            // Sort by price (best price first = lowest ask)
            orders.sort((a, b) => {
                if (a.limitPrice < b.limitPrice) return -1;
                if (a.limitPrice > b.limitPrice) return 1;
                return 0;
            });

            return orders;

        } catch (error) {
            console.error('Error fetching order book:', error);
            throw error;
        }
    }

    // ============================================
    // Fill Order - Buy tokens at posted price
    // ============================================

    async fillOrder(order, buyAmount, marketArrayIndex = null) {
        if (!await this.signer.isConnected()) {
            this.log('Please connect wallet first', 'warning');
            return;
        }

        const buyAmountInt = parseInt(buyAmount);
        if (!buyAmountInt || buyAmountInt < 1) {
            this.log('Please enter a valid amount', 'warning');
            return;
        }

        const buyAmountBigInt = BigInt(buyAmountInt);
        if (buyAmountBigInt > order.amount) {
            this.log(`Order only has ${order.amount} tokens available`, 'warning');
            return;
        }

        try {
            const tokenType = order.cell.cellOutput.type.args.slice(-2) === CONFIG.TOKEN_YES.slice(2) ? 'YES' : 'NO';
            this.log(`Buying ${buyAmountInt} ${tokenType} @ ${order.pricePerToken} CKB each...`, 'info');

            const address = await this.signer.getRecommendedAddress();
            const { script: buyerLock } = await ccc.Address.fromString(address, this.client);

            // Calculate payment
            const paymentAmount = buyAmountBigInt * order.limitPrice;

            // Build transaction
            const inputs = [{ previousOutput: order.outPoint }];
            const outputs = [];
            const outputsData = [];

            // Output 1: Buyer receives tokens (16-byte format, for holding)
            const buyerTokenData = new Uint8Array(16);
            new DataView(buyerTokenData.buffer).setBigUint64(0, buyAmountBigInt, true);

            outputs.push(ccc.CellOutput.from({
                capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.TOKEN),
                lock: buyerLock,
                type: order.cell.cellOutput.type
            }));
            outputsData.push('0x' + Array.from(buyerTokenData).map(b => b.toString(16).padStart(2, '0')).join(''));

            // Output 2: If partial fill, seller keeps remaining tokens at same price (AlwaysSuccess lock)
            const remainingTokens = order.amount - buyAmountBigInt;
            if (remainingTokens > 0n) {
                // Simple 32-byte data format for remaining order
                const remainingOrderData = new Uint8Array(32);
                new DataView(remainingOrderData.buffer).setBigUint64(0, remainingTokens, true); // amount
                new DataView(remainingOrderData.buffer, 16).setBigUint64(0, order.limitPrice, true); // same price

                outputs.push(ccc.CellOutput.from({
                    capacity: ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.LIMIT_ORDER),
                    lock: order.cell.cellOutput.lock,  // Keep AlwaysSuccess lock
                    type: order.cell.cellOutput.type
                }));
                outputsData.push('0x' + Array.from(remainingOrderData).map(b => b.toString(16).padStart(2, '0')).join(''));
            }

            // Output 3: Seller receives CKB payment (to seller's REAL lock, not AlwaysSuccess!)
            // Ensure payment cell meets minimum capacity requirement
            const minCapacity = ccc.fixedPointFrom(CONFIG.CELL_CAPACITY.CKB);
            const paymentCapacity = paymentAmount > minCapacity ? paymentAmount : minCapacity;

            outputs.push(ccc.CellOutput.from({
                capacity: paymentCapacity,
                lock: order.sellerLock  // Pay to seller's real lock (from cell data)
            }));
            outputsData.push('0x');

            const tx = ccc.Transaction.from({ inputs, outputs, outputsData });

            // Add cell deps for token contract and AlwaysSuccess
            tx.cellDeps.push(
                ccc.CellDep.from({ outPoint: { txHash: CONFIG.tokenTxHash, index: CONFIG.tokenIndex }, depType: 'code' })
            );

            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.AlwaysSuccess);
            await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
            await tx.completeInputsByCapacity(this.signer);  // Add inputs to cover outputs
            await tx.completeFeeBy(this.signer, 1000);  // Add fee, create change output

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            // Update Supabase: mark old order as filled
            await supabase
                .from('limit_orders')
                .update({ status: 'filled' })
                .eq('tx_hash', order.outPoint.txHash)
                .eq('output_index', Number(order.outPoint.index));

            // If partial fill, create new order entry for remaining tokens
            if (remainingTokens > 0n) {
                await supabase.from('limit_orders').insert({
                    tx_hash: resultTxHash,
                    output_index: 1,  // Remaining order is at output index 1
                    market_tx_hash: order.cell.cellOutput.type.args.slice(0, 66),  // market type hash
                    market_index: '0x0',
                    token_type: tokenType,
                    seller_address: order.sellerAddress,
                    amount: Number(remainingTokens),
                    price_ckb: order.pricePerToken,
                    status: 'active'
                });
            }

            const totalCost = Number(paymentAmount) / 100000000;
            this.log(`Bought ${buyAmountInt} ${tokenType} for ${totalCost.toFixed(2)} CKB! TX: ${resultTxHash}`, 'success');
            await this.updateBalance();

            // Reload order book if it's open
            if (marketArrayIndex !== null && this.orderBooks[marketArrayIndex]) {
                const { txHash, marketIndex } = this.orderBooks[marketArrayIndex];
                const container = document.getElementById(`orderbook-${marketArrayIndex}`);
                if (container && container.style.display !== 'none') {
                    await this.loadOrderBooks(marketArrayIndex, txHash, marketIndex);
                }
            }

        } catch (error) {
            this.log(`Error: ${error.message}`, 'error');
            console.error(error);
        }
    }

    // ============================================
    // Order Book UI
    // ============================================

    async toggleOrderBook(index, txHash, marketIndex) {
        const container = document.getElementById(`orderbook-${index}`);
        const arrow = document.getElementById(`orderbook-arrow-${index}`);

        if (container.style.display === 'none') {
            // Show and load order books
            container.style.display = 'block';
            arrow.textContent = '▼';
            await this.loadOrderBooks(index, txHash, marketIndex);
        } else {
            // Hide
            container.style.display = 'none';
            arrow.textContent = '▶';
        }
    }

    async loadOrderBooks(index, txHash, marketIndex) {
        try {
            // Load YES orders
            const yesOrders = await this.getOrderBook(txHash, marketIndex, 'YES');

            // Store orders and market info in app state
            if (!this.orderBooks[index]) this.orderBooks[index] = {};
            this.orderBooks[index].YES = yesOrders;
            this.orderBooks[index].txHash = txHash;
            this.orderBooks[index].marketIndex = marketIndex;

            const yesContainer = document.getElementById(`orderbook-yes-${index}`);
            yesContainer.innerHTML = this.renderOrders(yesOrders, index, 'YES');

            // Load NO orders
            const noOrders = await this.getOrderBook(txHash, marketIndex, 'NO');
            this.orderBooks[index].NO = noOrders;

            const noContainer = document.getElementById(`orderbook-no-${index}`);
            noContainer.innerHTML = this.renderOrders(noOrders, index, 'NO');

        } catch (error) {
            console.error('Error loading order books:', error);
            this.log(`Error loading orders: ${error.message}`, 'error');
        }
    }

    renderOrders(orders, marketIndex, tokenType) {
        if (orders.length === 0) {
            return '<div class="empty-orders">No orders yet</div>';
        }

        return orders.map((order, i) => `
            <div class="order-item sell-order">
                <div class="order-price">${order.pricePerToken.toFixed(2)} CKB</div>
                <div class="order-amount">${order.amount} tokens</div>
                <div class="order-total">${order.totalCKB.toFixed(2)} CKB</div>
                <button class="btn btn-xs btn-success" onclick="app.fillOrderByIndex(${marketIndex}, ${i}, '${tokenType}')">
                    Buy
                </button>
            </div>
        `).join('');
    }

    fillOrderByIndex(marketIndex, orderIndex, tokenType) {
        const order = this.orderBooks[marketIndex]?.[tokenType]?.[orderIndex];
        if (!order) {
            this.log('Order not found', 'error');
            return;
        }

        const amount = prompt(`How many ${tokenType} tokens do you want to buy? (Max: ${order.amount})\n\nPrice: ${order.pricePerToken} CKB per token`, order.amount.toString());
        if (amount && parseInt(amount) > 0) {
            this.fillOrder(order, amount, marketIndex);
        }
    }

    // ============================================
    // Logging
    // ============================================

    log(message, type = 'info') {
        const container = document.getElementById('log-container');
        if (!container) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;

        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;

        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Initialize
const app = new VerdictApp();
window.app = app;
app.init();
