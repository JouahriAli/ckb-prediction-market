use ckb_gen_types::packed::Script;
use ckb_gen_types::prelude::*;

fn main() {
    // Build the market type script
    let code_hash_bytes = [0xaa; 32];
    let code_hash = code_hash_bytes.pack();
    
    let script = Script::new_builder()
        .code_hash(code_hash)
        .hash_type(2u8.into()) // data2
        .args(vec![].pack())
        .build();
    
    let script_hash = script.calc_script_hash();
    println!("Market type script hash: 0x{}", hex::encode(script_hash.as_slice()));
}
