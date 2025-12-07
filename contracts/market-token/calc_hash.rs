use ckb_hash::blake2b_256;

fn main() {
    // Market type script from mock transaction:
    // code_hash: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    // hash_type: data2 (which is 2 in the enum)
    // args: 0x (empty)
    
    let code_hash = hex::decode("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    let hash_type: u8 = 2; // data2
    let args: Vec<u8> = vec![];
    
    // Molecule encoding of Script
    // This is simplified - real encoding is more complex
    let mut data = Vec::new();
    data.extend_from_slice(&code_hash);
    data.push(hash_type);
    data.extend_from_slice(&args);
    
    let hash = blake2b_256(&data);
    println!("Type script hash: 0x{}", hex::encode(hash));
}
