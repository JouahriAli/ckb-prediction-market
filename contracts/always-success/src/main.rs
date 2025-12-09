//! Always Success Lock Script
//!
//! This lock script always returns success, allowing anyone to unlock the cell.
//! Use this for cells that should be accessible by anyone (like shared market cells).

#![no_std]
#![cfg_attr(not(test), no_main)]

/// Main entry point - always returns 0 (success)
pub fn program_entry() -> i8 {
    0
}

#[cfg(not(test))]
ckb_std::entry!(program_entry);

#[cfg(not(test))]
ckb_std::default_alloc!();
