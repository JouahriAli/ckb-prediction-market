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

    // Token contract
    tokenCodeHash: '0x4cb52d7042988b6db9045383bd709adf043eb37f1988b48b05187f61cb7a17da',
    tokenTxHash: '0xc85097fc1367d51ba639bda59df53ad94d274d26aa176953a7aff287bcc37652',
    tokenIndex: '0x0',

    // Token IDs
    TOKEN_YES: '0x01',
    TOKEN_NO: '0x02',

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

        document.getElementById('wallet-address').textContent = shortAddr;
        document.getElementById('wallet-info').style.display = 'block';
        document.getElementById('btn-connect').style.display = 'none';
        document.getElementById('btn-disconnect').style.display = 'block';

        await this.updateBalance();
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
            }

            // Fetch metadata from Supabase
            const metadataMap = {};
            if (markets.length > 0) {
                const { data: rows } = await supabase
                    .from('markets')
                    .select('type_hash, question, description')
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
            // User: show mint button
            actionsHtml = `
                <div class="market-actions">
                    <input type="number" class="input input-sm" id="mint-${index}" value="10" min="1" placeholder="Amount">
                    <button class="btn btn-primary" onclick="app.mintForMarket('${market.outpoint.txHash}', '${market.outpoint.index}', document.getElementById('mint-${index}').value)">
                        Mint Tokens
                    </button>
                </div>
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
                        capacity: ccc.fixedPointFrom(200),
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
            await tx.completeInputsByCapacity(this.signer);
            await tx.completeFeeBy(this.signer, 1000);

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
                        capacity: ccc.fixedPointFrom(150),
                        lock: userLock,
                        type: ccc.Script.from({ codeHash: CONFIG.tokenCodeHash, hashType: 'data1', args: yesTokenArgs })
                    }),
                    ccc.CellOutput.from({
                        capacity: ccc.fixedPointFrom(150),
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
            await tx.completeInputsByCapacity(this.signer);
            await tx.completeFeeBy(this.signer, 1000);

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
            await tx.completeInputsByCapacity(this.signer);
            await tx.completeFeeBy(this.signer, 1000);

            const signedTx = await this.signer.signTransaction(tx);
            const resultTxHash = await this.client.sendTransaction(signedTx);

            this.log(`Market resolved! Winner: ${outcome ? 'YES' : 'NO'} TX: ${resultTxHash}`, 'success');
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

            const marketTypeHash = marketCell.cellOutput.type.hash();
            const tokenCodeHash = '0x' + Array.from(marketData.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');

            const winningTokenId = outcomeBool ? CONFIG.TOKEN_YES : CONFIG.TOKEN_NO;
            const winningTokenArgs = marketTypeHash + winningTokenId.slice(2);

            const tokenTypeScript = ccc.Script.from({
                codeHash: tokenCodeHash,
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
                    capacity: ccc.fixedPointFrom(150),
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
            await tx.completeInputsByCapacity(this.signer);
            await tx.completeFeeBy(this.signer, 1000);

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
