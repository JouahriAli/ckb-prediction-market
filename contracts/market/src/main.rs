//! Market Type Script
//!
//! Validates prediction market state transitions.
//! Ensures token minting/burning matches market supply changes.

#![no_std]
#![cfg_attr(not(test), no_main)]

use ckb_std::{
    ckb_constants::Source,
    ckb_types::prelude::*,
    debug,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_type_hash, load_script, QueryIter,
    },
};

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
/// - bytes 0-15: yes_supply (u128 LE)
/// - bytes 16-31: no_supply (u128 LE)
/// - byte 32: resolved (0 or 1)
/// - byte 33: outcome (0 or 1, true = YES wins)
#[derive(Debug)]
struct MarketData {
    yes_supply: u128,
    no_supply: u128,
    resolved: bool,
    outcome: bool,
}

impl MarketData {
    /// Parse market data from cell data
    fn from_bytes(data: &[u8]) -> Result<Self, Error> {
        if data.len() < 34 {
            return Err(Error::LengthNotEnough);
        }

        let yes_supply = u128::from_le_bytes(
            data[0..16].try_into().map_err(|_| Error::Encoding)?
        );
        let no_supply = u128::from_le_bytes(
            data[16..32].try_into().map_err(|_| Error::Encoding)?
        );
        let resolved = data[32] != 0;
        let outcome = data[33] != 0;

        Ok(MarketData {
            yes_supply,
            no_supply,
            resolved,
            outcome,
        })
    }

    /// Serialize market data to bytes
    fn to_bytes(&self) -> [u8; 34] {
        let mut bytes = [0u8; 34];
        bytes[0..16].copy_from_slice(&self.yes_supply.to_le_bytes());
        bytes[16..32].copy_from_slice(&self.no_supply.to_le_bytes());
        bytes[32] = if self.resolved { 1 } else { 0 };
        bytes[33] = if self.outcome { 1 } else { 0 };
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

/// Validate market creation (no input market cell)
fn validate_creation(output_data: &MarketData) -> Result<(), Error> {
    debug!("Validating market creation");

    // New market must start with zero supply
    if output_data.yes_supply != 0 || output_data.no_supply != 0 {
        debug!("Market must start with zero supply");
        return Err(Error::InvalidMarketData);
    }

    // Market must not be resolved at creation
    if output_data.resolved {
        debug!("Market cannot be resolved at creation");
        return Err(Error::InvalidMarketData);
    }

    debug!("Market creation valid");
    Ok(())
}

/// Validate market state transition (input -> output)
fn validate_transition(input_data: &MarketData, output_data: &MarketData) -> Result<(), Error> {
    debug!("Validating market transition");
    debug!("Input: yes={}, no={}, resolved={}", input_data.yes_supply, input_data.no_supply, input_data.resolved);
    debug!("Output: yes={}, no={}, resolved={}", output_data.yes_supply, output_data.no_supply, output_data.resolved);

    // For now, we only support minting (not resolution)
    // Supplies can only increase or stay the same
    if output_data.yes_supply < input_data.yes_supply {
        debug!("YES supply cannot decrease");
        return Err(Error::SupplyDecrease);
    }

    if output_data.no_supply < input_data.no_supply {
        debug!("NO supply cannot decrease");
        return Err(Error::SupplyDecrease);
    }

    // If there's a supply change, it must be equal for both YES and NO
    let yes_increase = output_data.yes_supply - input_data.yes_supply;
    let no_increase = output_data.no_supply - input_data.no_supply;

    if yes_increase != no_increase {
        debug!("Unequal supply increase: YES +{}, NO +{}", yes_increase, no_increase);
        return Err(Error::UnequalSupplyIncrease);
    }

    // Validate market capacity increase matches supply increase
    // This ensures proper collateralization: 1 token = 1 CKB backing
    let input_capacity = load_market_capacity(Source::Input)?;
    let output_capacity = load_market_capacity(Source::Output)?;

    if output_capacity < input_capacity {
        debug!("Market capacity cannot decrease");
        return Err(Error::InsufficientCollateral);
    }

    let capacity_increase = output_capacity - input_capacity;

    // Supply is stored as token count, capacity is in shannons
    // 1 token = 1 CKB = 100_000_000 shannons
    const SHANNONS_PER_CKB: u128 = 100_000_000;

    let supply_increase_shannons = yes_increase
        .checked_mul(SHANNONS_PER_CKB)
        .ok_or(Error::Encoding)?;

    let supply_increase_u64: u64 = supply_increase_shannons.try_into()
        .map_err(|_| Error::Encoding)?;

    if capacity_increase != supply_increase_u64 {
        debug!("Capacity increase ({}) must equal supply increase in shannons ({})",
               capacity_increase, supply_increase_u64);
        debug!("Token supply increased by {}, which is {} shannons",
               yes_increase, supply_increase_u64);
        return Err(Error::InsufficientCollateral);
    }

    debug!("Collateral validation passed: +{} CKB capacity matches +{} tokens",
           capacity_increase / SHANNONS_PER_CKB as u64, yes_increase);

    // Resolution status cannot change yet (we're only handling minting for now)
    if input_data.resolved != output_data.resolved {
        debug!("Resolution status cannot change (not implemented yet)");
        return Err(Error::InvalidMarketData);
    }

    debug!("Market transition valid: +{} to both YES and NO supply", yes_increase);
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
