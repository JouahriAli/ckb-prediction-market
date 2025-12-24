//! Market Type Script
//!
//! Validates prediction market state transitions.
//! Ensures token minting/burning matches market supply changes.

#![no_std]
#![cfg_attr(not(test), no_main)]

use ckb_std::{
    ckb_constants::Source,
    ckb_types::{
        prelude::*,
        packed::ScriptBuilder,
        core::ScriptHashType,
    },
    debug,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_type, load_cell_type_hash,
        load_input, load_script, load_witness_args, QueryIter,
    },
};
use alloc::vec::Vec;

/// Error codes
#[repr(i8)]
enum Error {
    IndexOutOfBound = 1,
    ItemMissing,
    LengthNotEnough,
    Encoding,
    // Market validation errors
    InvalidMarketData = 10,
    MultipleMarketCells = 11,
    SupplyDecrease = 12,
    UnequalSupplyIncrease = 13,
    InsufficientCollateral = 14,
    LockScriptChanged = 15,
    // Type ID validation errors
    InvalidTypeId = 20,
    TypeIdMismatch = 21,
}

impl From<ckb_std::error::SysError> for Error {
    fn from(err: ckb_std::error::SysError) -> Self {
        match err {
            ckb_std::error::SysError::IndexOutOfBound => Error::IndexOutOfBound,
            ckb_std::error::SysError::ItemMissing => Error::ItemMissing,
            ckb_std::error::SysError::LengthNotEnough(_) => Error::LengthNotEnough,
            ckb_std::error::SysError::Encoding => Error::Encoding,
            _ => Error::IndexOutOfBound,
        }
    }
}

/// Market data structure
/// Format:
/// - bytes 0-31: token_code_hash (32 bytes) - hash of the token contract binary
/// - byte 32: hash_type (1 byte) - ScriptHashType for tokens
/// - byte 33: resolved (0 or 1)
/// - byte 34: outcome (0 or 1, true = YES wins)
#[derive(Debug)]
struct MarketData {
    token_code_hash: [u8; 32],
    hash_type: u8,
    resolved: bool,
    outcome: bool,
}

impl MarketData {
    /// Parse market data from cell data
    fn from_bytes(data: &[u8]) -> Result<Self, Error> {
        if data.len() < 35 {
            return Err(Error::LengthNotEnough);
        }

        let mut token_code_hash = [0u8; 32];
        token_code_hash.copy_from_slice(&data[0..32]);
        let hash_type = data[32];
        let resolved = data[33] != 0;
        let outcome = data[34] != 0;

        Ok(MarketData {
            token_code_hash,
            hash_type,
            resolved,
            outcome,
        })
    }

    /// Serialize market data to bytes
    fn to_bytes(&self) -> [u8; 35] {
        let mut bytes = [0u8; 35];
        bytes[0..32].copy_from_slice(&self.token_code_hash);
        bytes[32] = self.hash_type;
        bytes[33] = if self.resolved { 1 } else { 0 };
        bytes[34] = if self.outcome { 1 } else { 0 };
        bytes
    }
}

/// Count market cells in a source (should only be 0 or 1)
fn count_market_cells(source: Source) -> Result<usize, Error> {
    let script = load_script()?;
    let script_hash = script.calc_script_hash();

    let mut count = 0;
    for cell_type_hash in QueryIter::new(load_cell_type_hash, source) {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == script_hash.as_slice() {
                count += 1;
            }
        }
    }

    Ok(count)
}

/// Load market cell data from a source
fn load_market_data(source: Source) -> Result<MarketData, Error> {
    let script = load_script()?;
    let script_hash = script.calc_script_hash();

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == script_hash.as_slice() {
                let data = load_cell_data(i, source)?;
                return MarketData::from_bytes(&data);
            }
        }
    }
    Err(Error::ItemMissing)
}

/// Load market cell capacity from a source
fn load_market_capacity(source: Source) -> Result<u64, Error> {
    let script = load_script()?;
    let script_hash = script.calc_script_hash();

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == script_hash.as_slice() {
                return Ok(load_cell_capacity(i, source)?);
            }
        }
    }

    Err(Error::ItemMissing)
}

/// Load market cell lock script from a source
fn load_market_lock(source: Source) -> Result<ckb_std::ckb_types::packed::Script, Error> {
    let script = load_script()?;
    let script_hash = script.calc_script_hash();

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == script_hash.as_slice() {
                return Ok(load_cell_lock(i, source)?);
            }
        }
    }

    Err(Error::ItemMissing)
}

/// Check if transaction has a witness (signature provided for resolution)
/// Returns true if witness with lock field exists, false otherwise
fn has_witness() -> bool {
    // Try to load witness args from first input
    match load_witness_args(0, Source::GroupInput) {
        Ok(witness_args) => {
            // Check if lock field exists and is not empty
            match witness_args.lock().to_opt() {
                Some(lock) => {
                    let lock_bytes = lock.raw_data();
                    !lock_bytes.is_empty()
                }
                None => false,
            }
        }
        Err(_) => false,
    }
}

/// Derive expected token type script hash for a given token type
/// token_id: 0x01 for YES, 0x02 for NO
fn derive_token_type_hash(
    token_code_hash: &[u8; 32],
    hash_type: u8,
    market_type_hash: &[u8; 32],
    token_id: u8,
) -> Result<[u8; 32], Error> {
    // Build args: market_type_hash (32 bytes) + token_id (1 byte)
    let mut args = Vec::new();
    args.extend_from_slice(market_type_hash);
    args.push(token_id);

    // Convert hash_type to ScriptHashType
    let script_hash_type = match hash_type {
        0 => ScriptHashType::Data,
        1 => ScriptHashType::Type,
        2 => ScriptHashType::Data1,
        4 => ScriptHashType::Data2,
        _ => return Err(Error::Encoding),
    };

    // Build the type script
    let type_script = ScriptBuilder::default()
        .code_hash(token_code_hash.pack())
        .hash_type(script_hash_type)
        .args(args.pack())
        .build();

    // Calculate and return the script hash
    let hash = type_script.calc_script_hash();
    let mut result = [0u8; 32];
    result.copy_from_slice(hash.as_slice());
    Ok(result)
}

/// Token counts in inputs or outputs
#[derive(Debug, Default)]
struct TokenCounts {
    yes_tokens: u128,
    no_tokens: u128,
}

/// Count YES and NO tokens in a given source
/// Only counts tokens that match the expected type script hashes
fn count_tokens(
    source: Source,
    expected_yes_hash: &[u8; 32],
    expected_no_hash: &[u8; 32],
) -> Result<TokenCounts, Error> {
    let mut counts = TokenCounts::default();

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, source).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            let type_hash_bytes = type_hash.as_slice();

            // Check if this is a YES token
            if type_hash_bytes == expected_yes_hash {
                let data = load_cell_data(i, source)?;
                if data.len() < 16 {
                    return Err(Error::LengthNotEnough);
                }
                let amount = u128::from_le_bytes(
                    data[0..16].try_into().map_err(|_| Error::Encoding)?
                );
                counts.yes_tokens = counts.yes_tokens.checked_add(amount).ok_or(Error::Encoding)?;
                debug!("Found YES token cell at index {} with amount {}", i, amount);
            }
            // Check if this is a NO token
            else if type_hash_bytes == expected_no_hash {
                let data = load_cell_data(i, source)?;
                if data.len() < 16 {
                    return Err(Error::LengthNotEnough);
                }
                let amount = u128::from_le_bytes(
                    data[0..16].try_into().map_err(|_| Error::Encoding)?
                );
                counts.no_tokens = counts.no_tokens.checked_add(amount).ok_or(Error::Encoding)?;
                debug!("Found NO token cell at index {} with amount {}", i, amount);
            }
        }
    }

    debug!("Total counts: YES={}, NO={}", counts.yes_tokens, counts.no_tokens);
    Ok(counts)
}

/// Validate market creation (no input market cell)
fn validate_creation(output_data: &MarketData) -> Result<(), Error> {
    debug!("Validating market creation");

    // Market must not be resolved at creation
    if output_data.resolved {
        debug!("Market cannot be resolved at creation");
        return Err(Error::InvalidMarketData);
    }

    // token_code_hash and hash_type must be set (non-zero)
    if output_data.token_code_hash == [0u8; 32] {
        debug!("token_code_hash must be set at creation");
        return Err(Error::InvalidMarketData);
    }

    debug!("Market creation valid");
    Ok(())
}

/// Validate lock script is preserved (prevents market hijacking)
fn validate_lock_preserved() -> Result<(), Error> {
    debug!("Validating lock script preservation");

    let input_lock = load_market_lock(Source::Input)?;
    let output_lock = load_market_lock(Source::Output)?;

    // Compare lock scripts byte-by-byte
    if input_lock.as_slice() != output_lock.as_slice() {
        debug!("Lock script changed - market hijacking attempt!");
        return Err(Error::LockScriptChanged);
    }

    debug!("Lock script preserved");
    Ok(())
}

/// Validate claim transaction (winning tokens → CKB after resolution)
fn validate_claim(
    market_data: &MarketData,
    input_capacity: u64,
    output_capacity: u64,
    input_counts: &TokenCounts,
    output_counts: &TokenCounts,
) -> Result<(), Error> {
    debug!("Validating claim transaction");

    const SHANNONS_PER_TOKEN: u128 = 10_000_000_000; // 100 CKB per token

    // Determine which token won based on outcome
    let (winning_burned, losing_input, losing_output) = if market_data.outcome {
        // YES won (outcome = true)
        let yes_burned = input_counts.yes_tokens.checked_sub(output_counts.yes_tokens)
            .ok_or(Error::Encoding)?;
        (yes_burned, input_counts.no_tokens, output_counts.no_tokens)
    } else {
        // NO won (outcome = false)
        let no_burned = input_counts.no_tokens.checked_sub(output_counts.no_tokens)
            .ok_or(Error::Encoding)?;
        (no_burned, input_counts.yes_tokens, output_counts.yes_tokens)
    };

    // Losing tokens cannot change
    if losing_output != losing_input {
        debug!("Losing tokens cannot be changed during claim");
        return Err(Error::InvalidMarketData);
    }

    // Must burn at least some winning tokens
    if winning_burned == 0 {
        debug!("No winning tokens burned");
        return Err(Error::SupplyDecrease);
    }

    let capacity_decrease = input_capacity - output_capacity;

    // Validate 1:100 ratio (1 winning token = 100 CKB)
    let expected_capacity_decrease = winning_burned
        .checked_mul(SHANNONS_PER_TOKEN)
        .ok_or(Error::Encoding)?;

    let expected_capacity_u64: u64 = expected_capacity_decrease.try_into()
        .map_err(|_| Error::Encoding)?;

    if capacity_decrease != expected_capacity_u64 {
        debug!("Capacity decrease ({}) must equal tokens claimed ({}) at 100 CKB per token",
               capacity_decrease, expected_capacity_u64);
        return Err(Error::InsufficientCollateral);
    }

    debug!("Claim validation passed: {} winning tokens claimed for {} CKB",
           winning_burned, capacity_decrease / 100_000_000);
    Ok(())
}

/// Validate market state transition (input -> output)
fn validate_transition(input_data: &MarketData, output_data: &MarketData) -> Result<(), Error> {
    debug!("Validating market transition");
    debug!("Input: resolved={}, outcome={}", input_data.resolved, input_data.outcome);
    debug!("Output: resolved={}, outcome={}", output_data.resolved, output_data.outcome);

    // CRITICAL: Ensure lock script doesn't change (prevent hijacking)
    validate_lock_preserved()?;

    // Validate token_code_hash and hash_type don't change
    if input_data.token_code_hash != output_data.token_code_hash {
        debug!("token_code_hash cannot change");
        return Err(Error::InvalidMarketData);
    }
    if input_data.hash_type != output_data.hash_type {
        debug!("hash_type cannot change");
        return Err(Error::InvalidMarketData);
    }

    // Load capacities to determine operation type
    let input_capacity = load_market_capacity(Source::Input)?;
    let output_capacity = load_market_capacity(Source::Output)?;

    // Derive expected token type script hashes
    let market_script = load_script()?;
    let market_type_hash_full = market_script.calc_script_hash();
    let mut market_type_hash = [0u8; 32];
    market_type_hash.copy_from_slice(market_type_hash_full.as_slice());

    let expected_yes_hash = derive_token_type_hash(
        &input_data.token_code_hash,
        input_data.hash_type,
        &market_type_hash,
        0x01,
    )?;

    let expected_no_hash = derive_token_type_hash(
        &input_data.token_code_hash,
        input_data.hash_type,
        &market_type_hash,
        0x02,
    )?;

    debug!("Expected YES token hash: {:?}", expected_yes_hash);
    debug!("Expected NO token hash: {:?}", expected_no_hash);

    // Count tokens in inputs and outputs
    let input_counts = count_tokens(Source::Input, &expected_yes_hash, &expected_no_hash)?;
    let output_counts = count_tokens(Source::Output, &expected_yes_hash, &expected_no_hash)?;

    debug!("Input tokens: YES={}, NO={}", input_counts.yes_tokens, input_counts.no_tokens);
    debug!("Output tokens: YES={}, NO={}", output_counts.yes_tokens, output_counts.no_tokens);

    // 1 token = 100 CKB = 10_000_000_000 shannons
    const SHANNONS_PER_TOKEN: u128 = 10_000_000_000;

    // Check if market is resolved - this determines how we validate
    if input_data.resolved {
        // RESOLVED MARKET: Only allow claims (winning tokens → CKB)
        debug!("Market is resolved with outcome: {}", if input_data.outcome { "YES" } else { "NO" });

        if output_capacity < input_capacity {
            // CLAIM: User is burning winning tokens to withdraw CKB
            validate_claim(input_data, input_capacity, output_capacity, &input_counts, &output_counts)?;
        } else if output_capacity == input_capacity {
            // NO OPERATION: Token counts must not change
            if output_counts.yes_tokens != input_counts.yes_tokens || output_counts.no_tokens != input_counts.no_tokens {
                debug!("Token counts cannot change on resolved market without capacity change");
                return Err(Error::InvalidMarketData);
            }
        } else {
            // Cannot add capacity to resolved market
            debug!("Cannot add capacity to resolved market");
            return Err(Error::InvalidMarketData);
        }

        // Market must stay resolved
        if !output_data.resolved {
            debug!("Cannot unresolve market");
            return Err(Error::InvalidMarketData);
        }

        // Outcome cannot change
        if output_data.outcome != input_data.outcome {
            debug!("Outcome cannot change after resolution");
            return Err(Error::InvalidMarketData);
        }

    } else {
        // UNRESOLVED MARKET: Allow minting and burning of complete sets

        if output_capacity < input_capacity {
            // BURNING: Market capacity decreased
            debug!("Burning operation detected: capacity {} -> {}", input_capacity, output_capacity);

            // Calculate token changes
            let yes_burned = input_counts.yes_tokens.checked_sub(output_counts.yes_tokens)
                .ok_or(Error::Encoding)?;
            let no_burned = input_counts.no_tokens.checked_sub(output_counts.no_tokens)
                .ok_or(Error::Encoding)?;

            if yes_burned == 0 && no_burned == 0 {
                debug!("No tokens burned but capacity decreased");
                return Err(Error::SupplyDecrease);
            }

            // Validate equal YES/NO burning
            if yes_burned != no_burned {
                debug!("Unequal burning: YES -{}, NO -{}", yes_burned, no_burned);
                return Err(Error::UnequalSupplyIncrease);
            }

            let capacity_decrease = input_capacity - output_capacity;

            // Validate capacity decrease matches supply decrease
            // 100 CKB = 1 YES + 1 NO (complete set)
            // So burning N YES + N NO should return N × 100 CKB
            let expected_capacity_decrease = yes_burned
                .checked_mul(SHANNONS_PER_TOKEN)
                .ok_or(Error::Encoding)?;

            let expected_capacity_u64: u64 = expected_capacity_decrease.try_into()
                .map_err(|_| Error::Encoding)?;

            if capacity_decrease != expected_capacity_u64 {
                debug!("Capacity decrease ({}) must equal burned complete sets ({}) at 100 CKB per set",
                       capacity_decrease, expected_capacity_u64);
                debug!("Burned {} YES + {} NO complete sets",
                       yes_burned, no_burned);
                return Err(Error::InsufficientCollateral);
            }

            debug!("Burning validation passed: -{} CKB capacity for {} complete sets",
                   capacity_decrease / 100_000_000, yes_burned);

    } else if output_capacity > input_capacity {
        // MINTING: Market capacity increased
        debug!("Minting operation detected: capacity {} -> {}", input_capacity, output_capacity);

        // Calculate token changes
        let yes_minted = output_counts.yes_tokens.checked_sub(input_counts.yes_tokens)
            .ok_or(Error::Encoding)?;
        let no_minted = output_counts.no_tokens.checked_sub(input_counts.no_tokens)
            .ok_or(Error::Encoding)?;

        if yes_minted == 0 && no_minted == 0 {
            debug!("No tokens minted but capacity increased");
            return Err(Error::SupplyDecrease);
        }

        // Validate equal YES/NO minting
        if yes_minted != no_minted {
            debug!("Unequal minting: YES +{}, NO +{}", yes_minted, no_minted);
            return Err(Error::UnequalSupplyIncrease);
        }

        let capacity_increase = output_capacity - input_capacity;

        // Validate capacity increase matches supply increase
        let supply_increase_shannons = yes_minted
            .checked_mul(SHANNONS_PER_TOKEN)
            .ok_or(Error::Encoding)?;

        let supply_increase_u64: u64 = supply_increase_shannons.try_into()
            .map_err(|_| Error::Encoding)?;

        if capacity_increase != supply_increase_u64 {
            debug!("Capacity increase ({}) must equal supply increase in shannons ({})",
                   capacity_increase, supply_increase_u64);
            debug!("Token supply increased by {}, which is {} shannons (100 CKB per token)",
                   yes_minted, supply_increase_u64);
            return Err(Error::InsufficientCollateral);
        }

        debug!("Minting validation passed: +{} CKB capacity matches +{} tokens at 100 CKB/token",
               capacity_increase / 100_000_000, yes_minted);
        } else {
            // NO OPERATION: Capacity unchanged, token counts must also be unchanged
            debug!("No capacity change, validating token counts unchanged");

            if output_counts.yes_tokens != input_counts.yes_tokens {
                debug!("YES token count changed without capacity change");
                return Err(Error::InsufficientCollateral);
            }

            if output_counts.no_tokens != input_counts.no_tokens {
                debug!("NO token count changed without capacity change");
                return Err(Error::InsufficientCollateral);
            }
        }

        // For unresolved markets, check if this is a resolution transaction
        if output_data.resolved {
            // RESOLUTION TRANSACTION: resolved field changed from false to true
            debug!("Resolution transaction detected");

            // Token counts must not change during resolution
            if input_counts.yes_tokens != output_counts.yes_tokens {
                debug!("YES token count cannot change during resolution");
                return Err(Error::InvalidMarketData);
            }

            if input_counts.no_tokens != output_counts.no_tokens {
                debug!("NO token count cannot change during resolution");
                return Err(Error::InvalidMarketData);
            }

            debug!("Resolution validation passed");
        } else {
            // MINTING/BURNING TRANSACTION
            // Outcome must not change when market is unresolved
            if output_data.outcome != input_data.outcome {
                debug!("Outcome cannot change during minting/burning");
                return Err(Error::InvalidMarketData);
            }
        }
    }

    debug!("Market transition validation complete");
    Ok(())
}

/// Find the output index of the market cell
fn find_market_output_index() -> Result<u64, Error> {
    let script = load_script()?;
    let script_hash = script.calc_script_hash();

    for (i, cell_type_hash) in QueryIter::new(load_cell_type_hash, Source::Output).enumerate() {
        if let Some(type_hash) = cell_type_hash {
            if type_hash.as_slice() == script_hash.as_slice() {
                return Ok(i as u64);
            }
        }
    }

    Err(Error::ItemMissing)
}

/// Validate Type ID in type script args
fn validate_type_id(input_count: usize) -> Result<(), Error> {
    let script = load_script()?;
    let args = script.args().raw_data();

    // Type ID must be exactly 32 bytes
    if args.len() != 32 {
        debug!("Type ID args must be 32 bytes, got {}", args.len());
        return Err(Error::InvalidTypeId);
    }

    if input_count == 0 {
        // CREATION: Validate Type ID is correctly derived from first input
        debug!("Validating Type ID creation");

        // Load first input's previous output (outpoint)
        let first_input = load_input(0, Source::Input)?;
        let outpoint = first_input.previous_output();

        // Find the output index of the market cell
        let output_index = find_market_output_index()?;

        // Calculate expected Type ID: blake2b(outpoint || output_index)
        let mut data = Vec::new();
        data.extend_from_slice(outpoint.as_slice());
        data.extend_from_slice(&output_index.to_le_bytes());

        // Use CKB's calc_data_hash which uses blake2b internally
        let hash = ckb_std::ckb_types::packed::CellOutput::calc_data_hash(&data);
        let mut expected_type_id = [0u8; 32];
        expected_type_id.copy_from_slice(hash.as_slice());

        // Compare with actual args
        if args.as_ref() != expected_type_id.as_ref() {
            debug!("Type ID mismatch on creation");
            debug!("Expected: {:?}", expected_type_id);
            debug!("Got: {:?}", args.as_ref());
            return Err(Error::InvalidTypeId);
        }

        debug!("Type ID creation validated successfully");
    } else {
        // UPDATE: output args must match input args
        validate_type_id_persistence(&args)?;
    }

    Ok(())
}

/// Validate Type ID persistence: output args == input args
fn validate_type_id_persistence(output_args: &[u8]) -> Result<(), Error> {
    // Load input market cell's type script
    let input_type = load_cell_type(0, Source::GroupInput)?.ok_or(Error::ItemMissing)?;
    let input_args = input_type.args().raw_data();

    // Verify output args == input args (Type ID persists)
    if output_args != input_args.as_ref() {
        debug!("Type ID mismatch: output != input");
        return Err(Error::TypeIdMismatch);
    }

    debug!("Type ID persistence validated");
    Ok(())
}

/// Main entry point
pub fn program_entry() -> i8 {
    match main() {
        Ok(_) => 0,
        Err(err) => err as i8,
    }
}

fn main() -> Result<(), Error> {
    debug!("Market type script running");

    // Count market cells in inputs and outputs
    let input_count = count_market_cells(Source::Input)?;
    let output_count = count_market_cells(Source::Output)?;

    debug!("Market cells: {} inputs, {} outputs", input_count, output_count);

    // There should be exactly one market cell in outputs
    if output_count != 1 {
        debug!("Must have exactly 1 market cell in outputs");
        return Err(Error::MultipleMarketCells);
    }

    // Validate Type ID in type script args
    validate_type_id(input_count)?;

    let output_data = load_market_data(Source::Output)?;

    if input_count == 0 {
        // MARKET CREATION
        validate_creation(&output_data)?;
    } else if input_count == 1 {
        // MARKET STATE TRANSITION
        let input_data = load_market_data(Source::Input)?;
        validate_transition(&input_data, &output_data)?;
    } else {
        // Invalid: multiple market cells in inputs
        debug!("Cannot have multiple market cells in inputs");
        return Err(Error::MultipleMarketCells);
    }

    Ok(())
}

#[cfg(not(test))]
ckb_std::entry!(program_entry);

#[cfg(not(test))]
ckb_std::default_alloc!();
