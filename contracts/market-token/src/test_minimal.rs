#![no_std]
#![cfg_attr(not(test), no_main)]

use ckb_std::default_alloc;

ckb_std::entry!(program_entry);
default_alloc!();

pub fn program_entry() -> i8 {
    0  // Always succeed
}
