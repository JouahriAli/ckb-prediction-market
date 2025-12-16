//! Market Contract API Server
//!
//! Web API for prediction market contract operations on devnet:
//! 1. Create market cell
//! 2. Mint tokens (complete sets)
//! 3. Resolve market
//! 4. Claim winnings

use anyhow::{anyhow, Result};
use axum::{
    extract::State,
    http::{StatusCode, Method},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use ckb_hash::blake2b_256;
use ckb_sdk::{
    constants::SIGHASH_TYPE_HASH,
    rpc::CkbRpcClient,
    rpc::ckb_indexer::{SearchKey, ScriptType, SearchMode, Order},
};
use ckb_types::{
    bytes::Bytes,
    core::{ScriptHashType, TransactionView},
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
    H256,
};
use serde::{Deserialize, Serialize};
use std::{str::FromStr, sync::{Arc, Mutex}};
use tower_http::cors::{CorsLayer, Any};

// Devnet RPC endpoint
const DEVNET_RPC: &str = "http://127.0.0.1:8114";

// Account #0 from offckb (pre-funded with 420M CKB)
const PRIVKEY: &str = "6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6";

/// Contract deployment info
struct ContractInfo {
    market_code_hash: H256,
    market_tx_hash: H256,
    token_code_hash: H256,
    token_tx_hash: H256,
    always_success_code_hash: H256,
    always_success_tx_hash: H256,
}

/// Market data structure (34 bytes)
#[derive(Debug, Clone, Default)]
struct MarketData {
    yes_supply: u128,
    no_supply: u128,
    resolved: bool,
    outcome: bool,
}

impl MarketData {
    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(34);
        bytes.extend_from_slice(&self.yes_supply.to_le_bytes());
        bytes.extend_from_slice(&self.no_supply.to_le_bytes());
        bytes.push(if self.resolved { 1 } else { 0 });
        bytes.push(if self.outcome { 1 } else { 0 });
        bytes
    }

    fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() < 34 {
            return Err(anyhow!("Invalid market data length: {}", data.len()));
        }
        Ok(MarketData {
            yes_supply: u128::from_le_bytes(data[0..16].try_into()?),
            no_supply: u128::from_le_bytes(data[16..32].try_into()?),
            resolved: data[32] != 0,
            outcome: data[33] != 0,
        })
    }
}

// ============================================================================
// API Types
// ============================================================================

/// Shared application state
struct AppState {
    client: Mutex<CkbRpcClient>,
    privkey: secp256k1::SecretKey,
    contracts: ContractInfo,
    lock_script: Script,
    current_market: Mutex<Option<OutPoint>>,
}

/// API request to mint tokens
#[derive(Debug, Deserialize)]
struct MintRequest {
    amount: u128,
}

/// API request to resolve market
#[derive(Debug, Deserialize)]
struct ResolveRequest {
    outcome: bool,
}

/// API request to claim tokens
#[derive(Debug, Deserialize)]
struct ClaimRequest {
    amount: u128,
}

/// API response
#[derive(Debug, Serialize)]
struct ApiResponse {
    success: bool,
    message: String,
    tx_hash: Option<String>,
}

/// Market status response
#[derive(Debug, Serialize)]
struct StatusResponse {
    connected: bool,
    block_height: Option<u64>,
    market_created: bool,
    market_data: Option<MarketDataJson>,
}

#[derive(Debug, Serialize)]
struct MarketDataJson {
    yes_supply: String,
    no_supply: String,
    resolved: bool,
    outcome: bool,
}

/// API error type
struct ApiError(anyhow::Error);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                message: self.0.to_string(),
                tx_hash: None,
            }),
        )
            .into_response()
    }
}

impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

// ============================================================================
// Main & API Server
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    // Check if we should run in test mode
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "test" {
        return run_tests();
    }

    println!("=== Market Contract API Server ===\n");

    // Initialize state
    let client = CkbRpcClient::new(DEVNET_RPC);
    println!("Connected to devnet at {}", DEVNET_RPC);

    let contracts = get_contract_info()?;
    let privkey_bytes = hex::decode(PRIVKEY)?;
    let privkey = secp256k1::SecretKey::from_slice(&privkey_bytes)?;

    let secp = secp256k1::Secp256k1::new();
    let pubkey = secp256k1::PublicKey::from_secret_key(&secp, &privkey);
    let pubkey_hash = &blake2b_256(&pubkey.serialize())[0..20];

    let lock_script = Script::new_builder()
        .code_hash(SIGHASH_TYPE_HASH.pack())
        .hash_type(ScriptHashType::Type.into())
        .args(Bytes::from(pubkey_hash.to_vec()).pack())
        .build();

    let state = Arc::new(AppState {
        client: Mutex::new(client),
        privkey,
        contracts,
        lock_script,
        current_market: Mutex::new(None),
    });

    // Build API routes
    let app = Router::new()
        .route("/", get(serve_frontend))
        .route("/api/status", get(handle_status))
        .route("/api/create-market", post(handle_create_market))
        .route("/api/mint", post(handle_mint))
        .route("/api/resolve", post(handle_resolve))
        .route("/api/claim", post(handle_claim))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST])
                .allow_headers(Any),
        )
        .with_state(state);

    println!("Server starting on http://localhost:3001");
    println!("API endpoints:");
    println!("  GET  /api/status");
    println!("  POST /api/create-market");
    println!("  POST /api/mint");
    println!("  POST /api/resolve");
    println!("  POST /api/claim");
    println!("\nTo run tests instead: cargo run test\n");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ============================================================================
// API Handlers
// ============================================================================

async fn serve_frontend() -> impl IntoResponse {
    use axum::response::Html;
    Html(include_str!("../frontend.html"))
}

async fn handle_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StatusResponse>, ApiError> {
    let mut client = state.client.lock().unwrap();

    let block_height = client.get_tip_block_number().ok().map(|h| h.value());
    let market_outpoint = state.current_market.lock().unwrap().clone();

    let market_data = if let Some(ref outpoint) = market_outpoint {
        get_cell(&mut client, outpoint)
            .ok()
            .and_then(|cell| MarketData::from_bytes(&cell.data).ok())
            .map(|data| MarketDataJson {
                yes_supply: data.yes_supply.to_string(),
                no_supply: data.no_supply.to_string(),
                resolved: data.resolved,
                outcome: data.outcome,
            })
    } else {
        None
    };

    Ok(Json(StatusResponse {
        connected: block_height.is_some(),
        block_height,
        market_created: market_outpoint.is_some(),
        market_data,
    }))
}

async fn handle_create_market(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse>, ApiError> {
    let mut client = state.client.lock().unwrap();

    let outpoint = create_market(
        &mut client,
        &state.privkey,
        &state.contracts,
        &state.lock_script,
    )?;

    let tx_hash: H256 = outpoint.tx_hash().unpack();
    *state.current_market.lock().unwrap() = Some(outpoint);

    Ok(Json(ApiResponse {
        success: true,
        message: "Market created successfully".to_string(),
        tx_hash: Some(format!("{:#x}", tx_hash)),
    }))
}

async fn handle_mint(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MintRequest>,
) -> Result<Json<ApiResponse>, ApiError> {
    let market_outpoint = state.current_market.lock().unwrap().clone()
        .ok_or_else(|| anyhow!("No market created yet"))?;

    let mut client = state.client.lock().unwrap();

    let new_outpoint = mint_tokens(
        &mut client,
        &state.privkey,
        &state.contracts,
        &state.lock_script,
        market_outpoint,
        req.amount,
    )?;

    let tx_hash: H256 = new_outpoint.tx_hash().unpack();
    *state.current_market.lock().unwrap() = Some(new_outpoint);

    Ok(Json(ApiResponse {
        success: true,
        message: format!("Minted {} YES + {} NO tokens", req.amount, req.amount),
        tx_hash: Some(format!("{:#x}", tx_hash)),
    }))
}

async fn handle_resolve(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ResolveRequest>,
) -> Result<Json<ApiResponse>, ApiError> {
    let market_outpoint = state.current_market.lock().unwrap().clone()
        .ok_or_else(|| anyhow!("No market created yet"))?;

    let mut client = state.client.lock().unwrap();

    let new_outpoint = resolve_market(
        &mut client,
        &state.privkey,
        &state.contracts,
        &state.lock_script,
        market_outpoint,
        req.outcome,
    )?;

    let tx_hash: H256 = new_outpoint.tx_hash().unpack();
    *state.current_market.lock().unwrap() = Some(new_outpoint);

    Ok(Json(ApiResponse {
        success: true,
        message: format!("Market resolved: {} wins", if req.outcome { "YES" } else { "NO" }),
        tx_hash: Some(format!("{:#x}", tx_hash)),
    }))
}

async fn handle_claim(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ClaimRequest>,
) -> Result<Json<ApiResponse>, ApiError> {
    let market_outpoint = state.current_market.lock().unwrap().clone()
        .ok_or_else(|| anyhow!("No market created yet"))?;

    let mut client = state.client.lock().unwrap();

    let new_outpoint = claim_tokens(
        &mut client,
        &state.privkey,
        &state.contracts,
        &state.lock_script,
        market_outpoint,
        req.amount,
    )?;

    let tx_hash: H256 = new_outpoint.tx_hash().unpack();
    *state.current_market.lock().unwrap() = Some(new_outpoint);

    let collateral = req.amount * 100;
    Ok(Json(ApiResponse {
        success: true,
        message: format!("Claimed {} tokens for {} CKB", req.amount, collateral),
        tx_hash: Some(format!("{:#x}", tx_hash)),
    }))
}

// ============================================================================
// Test Mode
// ============================================================================

fn run_tests() -> Result<()> {
    println!("=== Market Contract Test Suite ===\n");

    // Connect to devnet
    let mut client = CkbRpcClient::new(DEVNET_RPC);
    println!("Connected to devnet at {}", DEVNET_RPC);

    // Check connection
    let tip = client.get_tip_block_number()?;
    println!("Current block height: {}\n", tip);

    // Get contract info
    let contracts = get_contract_info()?;
    println!("Market code hash: {:#x}", contracts.market_code_hash);
    println!("Always-success code hash: {:#x}\n", contracts.always_success_code_hash);

    // Parse private key and get signer
    let privkey_bytes = hex::decode(PRIVKEY)?;
    let privkey = secp256k1::SecretKey::from_slice(&privkey_bytes)?;

    // Get address from private key
    let secp = secp256k1::Secp256k1::new();
    let pubkey = secp256k1::PublicKey::from_secret_key(&secp, &privkey);
    let pubkey_hash = &blake2b_256(&pubkey.serialize())[0..20];

    let lock_script = Script::new_builder()
        .code_hash(SIGHASH_TYPE_HASH.pack())
        .hash_type(ScriptHashType::Type.into())
        .args(Bytes::from(pubkey_hash.to_vec()).pack())
        .build();

    println!("Lock script hash: {:#x}", lock_script.calc_script_hash());

    // Run tests
    println!("\n=== Step 1: Create Market Cell ===");
    let market_outpoint = create_market(&mut client, &privkey, &contracts, &lock_script)?;
    println!("Market created!\n");

    println!("=== Step 2: Mint 10 Tokens ===");
    let market_outpoint = mint_tokens(&mut client, &privkey, &contracts, &lock_script, market_outpoint, 10)?;
    println!("Minted 10 YES + 10 NO tokens!\n");

    println!("=== Step 3: Resolve Market (YES wins) ===");
    let market_outpoint = resolve_market(&mut client, &privkey, &contracts, &lock_script, market_outpoint, true)?;
    println!("Market resolved: YES wins!\n");

    println!("=== Step 4: Claim 5 Winning Tokens ===");
    let _final_outpoint = claim_tokens(&mut client, &privkey, &contracts, &lock_script, market_outpoint, 5)?;
    println!("Claimed 5 YES tokens for 500 CKB!\n");

    println!("=== All Tests Passed! ===");
    Ok(())
}

fn get_contract_info() -> Result<ContractInfo> {
    // From offckb deployment
    Ok(ContractInfo {
        market_code_hash: H256::from_str("fe3a71cfcb556500e7f760b5c853be8fc082d32748aa9e5a98e25d79d4116485")?,
        market_tx_hash: H256::from_str("6c88542e395d308dc6e08b745473dce80e06ae06e50c69221b54508c5b5335d5")?,
        token_code_hash: H256::from_str("54f68c08a051facc261167d0a45383cc5fa8b1ea7d1f9d9be5a7e623e27a1320")?,
        token_tx_hash: H256::from_str("b5580c10ce2545acbf9b05ca8b7e44d62dcc7d837e0557b343222b7dd6c22b0f")?,
        always_success_code_hash: H256::from_str("21854a7b67a2c4a71a8558c6d4023cf787e71db49d09cb4aa8748dbf6a8ef6ec")?,
        always_success_tx_hash: H256::from_str("0cc42f03d73e685843da66a6f049107634986572802eb8d0363e7e662125d077")?,
    })
}

fn build_cell_deps(contracts: &ContractInfo) -> Vec<CellDep> {
    vec![
        // Secp256k1 dep group (for signing fee inputs)
        CellDep::new_builder()
            .out_point(
                OutPoint::new_builder()
                    .tx_hash(H256::from_str("75be96e1871693f030db27ddae47890a28ab180e88e36ebb3575d9f1377d3da7").unwrap().pack())
                    .index(0u32.pack())
                    .build()
            )
            .dep_type(ckb_types::core::DepType::DepGroup.into())
            .build(),
        // Market contract
        CellDep::new_builder()
            .out_point(
                OutPoint::new_builder()
                    .tx_hash(contracts.market_tx_hash.pack())
                    .index(0u32.pack())
                    .build()
            )
            .dep_type(ckb_types::core::DepType::Code.into())
            .build(),
        // Always-success contract
        CellDep::new_builder()
            .out_point(
                OutPoint::new_builder()
                    .tx_hash(contracts.always_success_tx_hash.pack())
                    .index(0u32.pack())
                    .build()
            )
            .dep_type(ckb_types::core::DepType::Code.into())
            .build(),
    ]
}

/// Build cell deps for transactions that use tokens
fn build_cell_deps_with_token(contracts: &ContractInfo) -> Vec<CellDep> {
    let mut deps = build_cell_deps(contracts);

    // Add token contract
    deps.push(CellDep::new_builder()
        .out_point(
            OutPoint::new_builder()
                .tx_hash(contracts.token_tx_hash.pack())
                .index(0u32.pack())
                .build()
        )
        .dep_type(ckb_types::core::DepType::Code.into())
        .build());

    deps
}

fn build_market_lock(contracts: &ContractInfo) -> Script {
    Script::new_builder()
        .code_hash(contracts.always_success_code_hash.pack())
        .hash_type(ScriptHashType::Data1.into())
        .args(Bytes::new().pack())
        .build()
}

fn build_market_type(contracts: &ContractInfo) -> Script {
    Script::new_builder()
        .code_hash(contracts.market_code_hash.pack())
        .hash_type(ScriptHashType::Data1.into())
        .args(Bytes::new().pack())
        .build()
}

/// Build token type script for YES or NO tokens
/// Args format: market_type_hash (32 bytes) + token_id (1 byte)
/// token_id: 0x01 = YES, 0x02 = NO
fn build_token_type(contracts: &ContractInfo, is_yes: bool) -> Script {
    let market_type = build_market_type(contracts);
    let market_type_hash = market_type.calc_script_hash();

    // Build args: market_type_hash (32 bytes) + token_id (1 byte)
    let mut args = Vec::with_capacity(33);
    args.extend_from_slice(market_type_hash.as_slice());
    args.push(if is_yes { 0x01 } else { 0x02 });

    Script::new_builder()
        .code_hash(contracts.token_code_hash.pack())
        .hash_type(ScriptHashType::Data1.into())
        .args(Bytes::from(args).pack())
        .build()
}

fn create_market(
    client: &mut CkbRpcClient,
    privkey: &secp256k1::SecretKey,
    contracts: &ContractInfo,
    fee_lock: &Script,
) -> Result<OutPoint> {
    println!("  Building transaction...");

    // Collect input cells for fee
    let fee_cells = collect_cells(client, fee_lock, 200_00000000)?; // 200 CKB for fees
    println!("  Collected {} fee cells", fee_cells.len());

    // Market cell: 128 CKB minimum
    let market_capacity = 128_00000000u64; // 128 CKB in shannons

    // Calculate total input
    let total_input: u64 = fee_cells.iter().map(|(_, cap)| cap).sum();
    let fee = 1000u64; // 1000 shannons fee
    let change = total_input - market_capacity - fee;

    // Market data (all zeros)
    let market_data = MarketData::default().to_bytes();

    // Build outputs
    let market_output = CellOutput::new_builder()
        .capacity(market_capacity.pack())
        .lock(build_market_lock(contracts))
        .type_(Some(build_market_type(contracts)).pack())
        .build();

    let change_output = CellOutput::new_builder()
        .capacity(change.pack())
        .lock(fee_lock.clone())
        .build();

    // Build inputs
    let inputs: Vec<CellInput> = fee_cells.iter()
        .map(|(outpoint, _)| {
            CellInput::new_builder()
                .previous_output(outpoint.clone())
                .since(0u64.pack())
                .build()
        })
        .collect();

    // Build transaction
    let tx = TransactionView::new_advanced_builder()
        .cell_deps(build_cell_deps(contracts))
        .inputs(inputs)
        .outputs(vec![market_output, change_output])
        .outputs_data(vec![Bytes::from(market_data).pack(), Bytes::new().pack()])
        .build();

    // Sign and send
    let tx = sign_transaction(tx, privkey, fee_cells.len())?;
    let tx_hash = send_transaction(client, &tx)?;

    println!("  TX: {:#x}", tx_hash);
    Ok(OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(0u32.pack())
        .build())
}

fn mint_tokens(
    client: &mut CkbRpcClient,
    privkey: &secp256k1::SecretKey,
    contracts: &ContractInfo,
    fee_lock: &Script,
    market_outpoint: OutPoint,
    amount: u128,
) -> Result<OutPoint> {
    println!("  Building transaction...");

    // Get current market cell
    let market_cell = get_cell(client, &market_outpoint)?;
    let market_data = MarketData::from_bytes(&market_cell.data)?;
    let market_capacity: u64 = market_cell.capacity;

    // Collect fee cells (need amount * 100 CKB for collateral + 286 CKB for token cells + fees)
    let collateral = amount as u64 * 100_00000000; // 100 CKB per token
    let token_cells_capacity = 286_00000000u64; // 143 CKB × 2 for YES and NO token cells
    let fee_cells = collect_cells(client, fee_lock, collateral + token_cells_capacity + 1_00000000)?;

    let total_fee_input: u64 = fee_cells.iter().map(|(_, cap)| cap).sum();
    let fee = 2000u64; // Increased fee for larger transaction with token cells

    // New market capacity = old + collateral
    let new_market_capacity = market_capacity + collateral;
    let change = total_fee_input - collateral - fee;

    // New market data
    let new_market_data = MarketData {
        yes_supply: market_data.yes_supply + amount,
        no_supply: market_data.no_supply + amount,
        resolved: false,
        outcome: false,
    }.to_bytes();

    // Token cells need capacity for lock + type + data
    // Lock (sighash): ~53 bytes, Type (33 bytes args): ~61 bytes, Data: 16 bytes = ~143 CKB
    let token_cell_capacity = 143_00000000u64; // 143 CKB per token cell

    // Build outputs
    let market_output = CellOutput::new_builder()
        .capacity(new_market_capacity.pack())
        .lock(build_market_lock(contracts))
        .type_(Some(build_market_type(contracts)).pack())
        .build();

    // YES token cell
    let yes_token_output = CellOutput::new_builder()
        .capacity(token_cell_capacity.pack())
        .lock(fee_lock.clone()) // User owns the tokens
        .type_(Some(build_token_type(contracts, true)).pack())
        .build();

    // NO token cell
    let no_token_output = CellOutput::new_builder()
        .capacity(token_cell_capacity.pack())
        .lock(fee_lock.clone()) // User owns the tokens
        .type_(Some(build_token_type(contracts, false)).pack())
        .build();

    // Calculate change (need to account for token cell capacities)
    let change_adjusted = total_fee_input - collateral - (token_cell_capacity * 2) - fee;
    let change_output = CellOutput::new_builder()
        .capacity(change_adjusted.pack())
        .lock(fee_lock.clone())
        .build();

    // Token cell data: u128 amount (16 bytes)
    let token_amount_bytes = amount.to_le_bytes().to_vec();

    // Build inputs: market cell first, then fee cells
    let mut inputs = vec![
        CellInput::new_builder()
            .previous_output(market_outpoint)
            .since(0u64.pack())
            .build()
    ];
    for (outpoint, _) in &fee_cells {
        inputs.push(CellInput::new_builder()
            .previous_output(outpoint.clone())
            .since(0u64.pack())
            .build());
    }

    // Build transaction
    let tx = TransactionView::new_advanced_builder()
        .cell_deps(build_cell_deps_with_token(contracts))
        .inputs(inputs)
        .outputs(vec![market_output, yes_token_output, no_token_output, change_output])
        .outputs_data(vec![
            Bytes::from(new_market_data).pack(),
            Bytes::from(token_amount_bytes.clone()).pack(),
            Bytes::from(token_amount_bytes).pack(),
            Bytes::new().pack()
        ])
        .build();

    // Sign (witness 0 is empty for always-success, witnesses 1+ are for fee cells)
    let tx = sign_transaction_with_market(tx, privkey, fee_cells.len())?;
    let tx_hash = send_transaction(client, &tx)?;

    println!("  TX: {:#x}", tx_hash);
    Ok(OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(0u32.pack())
        .build())
}

fn resolve_market(
    client: &mut CkbRpcClient,
    privkey: &secp256k1::SecretKey,
    contracts: &ContractInfo,
    fee_lock: &Script,
    market_outpoint: OutPoint,
    outcome_yes: bool,
) -> Result<OutPoint> {
    println!("  Building transaction...");

    // Get current market cell
    let market_cell = get_cell(client, &market_outpoint)?;
    let market_data = MarketData::from_bytes(&market_cell.data)?;
    let market_capacity: u64 = market_cell.capacity;

    // Collect fee cells
    let fee_cells = collect_cells(client, fee_lock, 1_00000000)?;
    let total_fee_input: u64 = fee_cells.iter().map(|(_, cap)| cap).sum();
    let fee = 1000u64;
    let change = total_fee_input - fee;

    // New market data (resolved)
    let new_market_data = MarketData {
        yes_supply: market_data.yes_supply,
        no_supply: market_data.no_supply,
        resolved: true,
        outcome: outcome_yes,
    }.to_bytes();

    // Build outputs (market capacity unchanged)
    let market_output = CellOutput::new_builder()
        .capacity(market_capacity.pack())
        .lock(build_market_lock(contracts))
        .type_(Some(build_market_type(contracts)).pack())
        .build();

    let change_output = CellOutput::new_builder()
        .capacity(change.pack())
        .lock(fee_lock.clone())
        .build();

    // Build inputs
    let mut inputs = vec![
        CellInput::new_builder()
            .previous_output(market_outpoint)
            .since(0u64.pack())
            .build()
    ];
    for (outpoint, _) in &fee_cells {
        inputs.push(CellInput::new_builder()
            .previous_output(outpoint.clone())
            .since(0u64.pack())
            .build());
    }

    let tx = TransactionView::new_advanced_builder()
        .cell_deps(build_cell_deps(contracts))
        .inputs(inputs)
        .outputs(vec![market_output, change_output])
        .outputs_data(vec![Bytes::from(new_market_data).pack(), Bytes::new().pack()])
        .build();

    let tx = sign_transaction_with_market(tx, privkey, fee_cells.len())?;
    let tx_hash = send_transaction(client, &tx)?;

    println!("  TX: {:#x}", tx_hash);
    Ok(OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(0u32.pack())
        .build())
}

fn claim_tokens(
    client: &mut CkbRpcClient,
    privkey: &secp256k1::SecretKey,
    contracts: &ContractInfo,
    fee_lock: &Script,
    market_outpoint: OutPoint,
    amount: u128,
) -> Result<OutPoint> {
    println!("  Building transaction...");

    // Get current market cell
    let market_cell = get_cell(client, &market_outpoint)?;
    let market_data = MarketData::from_bytes(&market_cell.data)?;
    let market_capacity: u64 = market_cell.capacity;

    if !market_data.resolved {
        return Err(anyhow!("Market is not resolved"));
    }

    // Determine winning token type (YES = true, NO = false)
    let is_winning_yes = market_data.outcome;
    let winning_token_type = build_token_type(contracts, is_winning_yes);

    // Find user's winning token cell
    let (token_outpoint, token_capacity, token_amount) = find_token_cell(client, fee_lock, &winning_token_type)?;

    if token_amount < amount {
        return Err(anyhow!("Insufficient token balance: have {} need {}", token_amount, amount));
    }

    // Calculate claim amount (100 CKB per winning token)
    let claim_amount = amount as u64 * 100_00000000;
    let new_market_capacity = market_capacity - claim_amount;

    // Calculate new token amount
    let new_token_amount = token_amount - amount;

    // Collect fee cells
    let fee_cells = collect_cells(client, fee_lock, 1_00000000)?;
    let total_fee_input: u64 = fee_cells.iter().map(|(_, cap)| cap).sum();
    let fee = 2000u64;

    // Change calculation: fee inputs + claimed CKB - fee
    // Note: token_capacity cancels out (appears in both inputs and outputs)
    let change = total_fee_input + claim_amount - fee;

    // New market data (reduce winning supply)
    let new_market_data = if is_winning_yes {
        MarketData {
            yes_supply: market_data.yes_supply - amount,
            no_supply: market_data.no_supply,
            resolved: true,
            outcome: true,
        }
    } else {
        MarketData {
            yes_supply: market_data.yes_supply,
            no_supply: market_data.no_supply - amount,
            resolved: true,
            outcome: false,
        }
    }.to_bytes();

    // Build outputs
    let market_output = CellOutput::new_builder()
        .capacity(new_market_capacity.pack())
        .lock(build_market_lock(contracts))
        .type_(Some(build_market_type(contracts)).pack())
        .build();

    let mut outputs = vec![market_output];
    let mut outputs_data = vec![Bytes::from(new_market_data).pack()];

    // If there are remaining tokens, output updated token cell
    if new_token_amount > 0 {
        let token_output = CellOutput::new_builder()
            .capacity(token_capacity.pack())
            .lock(fee_lock.clone())
            .type_(Some(winning_token_type).pack())
            .build();
        outputs.push(token_output);
        outputs_data.push(Bytes::from(new_token_amount.to_le_bytes().to_vec()).pack());
    }

    // Change output
    let change_output = CellOutput::new_builder()
        .capacity(change.pack())
        .lock(fee_lock.clone())
        .build();
    outputs.push(change_output);
    outputs_data.push(Bytes::new().pack());

    // Build inputs: market cell, token cell, fee cells
    let mut inputs = vec![
        CellInput::new_builder()
            .previous_output(market_outpoint)
            .since(0u64.pack())
            .build(),
        CellInput::new_builder()
            .previous_output(token_outpoint)
            .since(0u64.pack())
            .build(),
    ];
    for (outpoint, _) in &fee_cells {
        inputs.push(CellInput::new_builder()
            .previous_output(outpoint.clone())
            .since(0u64.pack())
            .build());
    }

    let tx = TransactionView::new_advanced_builder()
        .cell_deps(build_cell_deps_with_token(contracts))
        .inputs(inputs)
        .outputs(outputs)
        .outputs_data(outputs_data)
        .build();

    // Sign: market (always-success, dummy witness), token (signed), fee inputs (signed)
    let tx = sign_transaction_with_market_and_token(tx, privkey, 1 + fee_cells.len())?;
    let tx_hash = send_transaction(client, &tx)?;

    println!("  TX: {:#x}", tx_hash);
    Ok(OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(0u32.pack())
        .build())
}

// Helper functions

struct CellInfo {
    capacity: u64,
    data: Vec<u8>,
}

fn get_cell(client: &mut CkbRpcClient, outpoint: &OutPoint) -> Result<CellInfo> {
    let tx_hash: H256 = outpoint.tx_hash().unpack();
    let index: u32 = outpoint.index().unpack();

    let tx_with_status = client.get_transaction(tx_hash)?
        .ok_or_else(|| anyhow!("Transaction not found"))?;

    let tx = tx_with_status.transaction
        .ok_or_else(|| anyhow!("Transaction inner not found"))?;

    // Get the inner transaction view
    let inner = match tx.inner {
        ckb_jsonrpc_types::Either::Left(view) => view,
        ckb_jsonrpc_types::Either::Right(_) => return Err(anyhow!("Transaction is in bytes format")),
    };

    let output = inner.inner.outputs.get(index as usize)
        .ok_or_else(|| anyhow!("Output not found"))?;
    let data = inner.inner.outputs_data.get(index as usize)
        .ok_or_else(|| anyhow!("Output data not found"))?;

    Ok(CellInfo {
        capacity: output.capacity.into(),
        data: data.as_bytes().to_vec(),
    })
}

fn collect_cells(client: &mut CkbRpcClient, lock: &Script, min_capacity: u64) -> Result<Vec<(OutPoint, u64)>> {
    use ckb_sdk::rpc::ckb_indexer::SearchKeyFilter;

    // Filter to exclude cells with data (e.g., contract binaries)
    // Only collect empty cells to avoid spending contract deployments
    let filter = SearchKeyFilter {
        script: None,
        script_len_range: None,
        output_data: None,
        output_data_filter_mode: None,
        output_data_len_range: Some([0.into(), 1.into()]), // Data length 0-1 bytes (empty)
        output_capacity_range: None,
        block_range: None,
    };

    let search_key = SearchKey {
        script: lock.clone().into(),
        script_type: ScriptType::Lock,
        script_search_mode: Some(SearchMode::Exact),
        filter: Some(filter),
        with_data: Some(false),
        group_by_transaction: None,
    };

    let cells = client.get_cells(search_key, Order::Asc, 100.into(), None)?;

    let mut collected = Vec::new();
    let mut total = 0u64;

    for cell in cells.objects {
        let capacity: u64 = cell.output.capacity.into();
        let outpoint = OutPoint::new_builder()
            .tx_hash(cell.out_point.tx_hash.pack())
            .index((cell.out_point.index.value() as u32).pack())
            .build();

        collected.push((outpoint, capacity));
        total += capacity;

        if total >= min_capacity {
            break;
        }
    }

    if total < min_capacity {
        return Err(anyhow!("Insufficient balance: need {} have {}", min_capacity, total));
    }

    Ok(collected)
}

/// Find token cells by lock and type script
/// Returns (outpoint, capacity, amount) for the first matching cell
fn find_token_cell(client: &mut CkbRpcClient, lock: &Script, token_type: &Script) -> Result<(OutPoint, u64, u128)> {
    let search_key = SearchKey {
        script: lock.clone().into(),
        script_type: ScriptType::Lock,
        script_search_mode: Some(SearchMode::Exact),
        filter: None,
        with_data: Some(true), // Need data to get token amount
        group_by_transaction: None,
    };

    let cells = client.get_cells(search_key, Order::Asc, 100.into(), None)?;

    for cell in cells.objects {
        // Check if this cell has the matching type script
        if let Some(cell_type) = &cell.output.type_ {
            let cell_type_script: Script = cell_type.clone().into();
            if cell_type_script == *token_type {
                let capacity: u64 = cell.output.capacity.into();
                let outpoint = OutPoint::new_builder()
                    .tx_hash(cell.out_point.tx_hash.pack())
                    .index((cell.out_point.index.value() as u32).pack())
                    .build();

                // Parse token amount from data (u128, 16 bytes, little endian)
                let data = cell.output_data.ok_or_else(|| anyhow!("Token cell missing data"))?;
                let amount_bytes: [u8; 16] = data.as_bytes()
                    .try_into()
                    .map_err(|_| anyhow!("Invalid token amount data"))?;
                let amount = u128::from_le_bytes(amount_bytes);

                return Ok((outpoint, capacity, amount));
            }
        }
    }

    Err(anyhow!("Token cell not found"))
}

fn sign_transaction(tx: TransactionView, privkey: &secp256k1::SecretKey, num_inputs: usize) -> Result<TransactionView> {
    // All inputs use secp256k1 signature
    let mut witnesses: Vec<Bytes> = Vec::new();

    for i in 0..num_inputs {
        if i == 0 {
            // First witness contains the signature
            let witness = sign_witness(tx.hash(), privkey)?;
            witnesses.push(witness);
        } else {
            witnesses.push(Bytes::new());
        }
    }

    Ok(tx.as_advanced_builder()
        .set_witnesses(witnesses.into_iter().map(|w| w.pack()).collect())
        .build())
}

fn sign_transaction_with_market(tx: TransactionView, privkey: &secp256k1::SecretKey, num_fee_inputs: usize) -> Result<TransactionView> {
    // First input is market cell (always-success, needs non-empty witness)
    // Remaining inputs use secp256k1 signature
    let mut witnesses: Vec<Bytes> = Vec::new();

    // Market cell witness (dummy, non-empty)
    let dummy_witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    witnesses.push(dummy_witness.as_bytes());

    // Sign fee inputs
    for i in 0..num_fee_inputs {
        if i == 0 {
            let witness = sign_witness(tx.hash(), privkey)?;
            witnesses.push(witness);
        } else {
            witnesses.push(Bytes::new());
        }
    }

    Ok(tx.as_advanced_builder()
        .set_witnesses(witnesses.into_iter().map(|w| w.pack()).collect())
        .build())
}

fn sign_transaction_with_market_and_token(tx: TransactionView, privkey: &secp256k1::SecretKey, num_signed_inputs: usize) -> Result<TransactionView> {
    use ckb_hash::new_blake2b;

    // Input 0: Market cell (always-success, needs non-empty witness)
    // Input 1+: Token cell and fee inputs (secp256k1 signature)
    let mut witnesses: Vec<Bytes> = Vec::new();

    // Market cell witness (dummy, non-empty)
    let dummy_witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    witnesses.push(dummy_witness.as_bytes());

    // Token cell witness (placeholder with 65-byte lock)
    let placeholder_witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    witnesses.push(placeholder_witness.as_bytes());

    // Fee cell witnesses (empty) - only first input in group gets placeholder
    for _ in 1..num_signed_inputs {
        witnesses.push(Bytes::new());
    }

    // Build transaction with placeholder witnesses to get proper tx hash
    let tx_with_witnesses = tx.as_advanced_builder()
        .set_witnesses(witnesses.iter().map(|w| w.pack()).collect())
        .build();

    // Sign the witness group (token + fee cells)
    // Signature message includes tx_hash + first witness + other witnesses in group
    let tx_hash = tx_with_witnesses.hash();
    let mut hasher = new_blake2b();
    hasher.update(tx_hash.as_slice());

    // First witness in the secp256k1 group (token cell) - placeholder WitnessArgs
    let first_witness_len = witnesses[1].len() as u64;
    hasher.update(&first_witness_len.to_le_bytes());
    hasher.update(&witnesses[1]);

    // Remaining witnesses in the group (fee cells) - empty bytes
    for i in 2..(1 + num_signed_inputs) {
        let witness_len = witnesses[i].len() as u64;
        hasher.update(&witness_len.to_le_bytes());
        hasher.update(&witnesses[i]);
    }

    let mut message = [0u8; 32];
    hasher.finalize(&mut message);

    // Sign
    let secp = secp256k1::Secp256k1::new();
    let message = secp256k1::Message::from_digest(message);
    let sig = secp.sign_ecdsa_recoverable(&message, privkey);
    let (rec_id, sig_bytes) = sig.serialize_compact();

    let mut signature = [0u8; 65];
    signature[0..64].copy_from_slice(&sig_bytes);
    signature[64] = i32::from(rec_id) as u8;

    // Replace first witness in group with signature
    let signed_witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(signature.to_vec())).pack())
        .build();
    witnesses[1] = signed_witness.as_bytes();

    // Rest remain as empty witnesses (they already are)

    Ok(tx.as_advanced_builder()
        .set_witnesses(witnesses.into_iter().map(|w| w.pack()).collect())
        .build())
}

fn sign_witness(tx_hash: ckb_types::packed::Byte32, privkey: &secp256k1::SecretKey) -> Result<Bytes> {
    use ckb_hash::new_blake2b;

    let secp = secp256k1::Secp256k1::new();

    // Build witness args with placeholder
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(vec![0u8; 65])).pack())
        .build();
    let witness_len = witness_args.as_bytes().len() as u64;

    // Hash: tx_hash || witness_len || witness
    let mut hasher = new_blake2b();
    hasher.update(tx_hash.as_slice());
    hasher.update(&witness_len.to_le_bytes());
    hasher.update(&witness_args.as_bytes());

    let mut message = [0u8; 32];
    hasher.finalize(&mut message);

    // Sign
    let message = secp256k1::Message::from_digest(message);
    let sig = secp.sign_ecdsa_recoverable(&message, privkey);
    let (rec_id, sig_bytes) = sig.serialize_compact();

    let mut signature = [0u8; 65];
    signature[0..64].copy_from_slice(&sig_bytes);
    signature[64] = i32::from(rec_id) as u8;

    // Build final witness
    let witness = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(signature.to_vec())).pack())
        .build();

    Ok(witness.as_bytes())
}

fn send_transaction(client: &mut CkbRpcClient, tx: &TransactionView) -> Result<H256> {
    let tx_json: ckb_jsonrpc_types::Transaction = tx.data().into();
    let tx_hash = client.send_transaction(tx_json, None)?;

    // Wait for confirmation
    println!("  Waiting for confirmation...");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if let Some(status) = client.get_transaction(tx_hash.clone())? {
            if status.tx_status.status == ckb_jsonrpc_types::Status::Committed {
                break;
            }
        }
    }

    Ok(tx_hash)
}
