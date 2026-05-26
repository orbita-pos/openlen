use std::env;
use std::fs;
use std::path::PathBuf;

use rcgen::{generate_simple_self_signed, CertifiedKey};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out = env::args().nth(1).unwrap_or_else(|| "dev-certs".into());
    let out = PathBuf::from(out);
    fs::create_dir_all(&out)?;

    let subject_alt_names = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "openlen.local".to_string(),
        "*.openlen.local".to_string(),
    ];
    let CertifiedKey { cert, key_pair } = generate_simple_self_signed(subject_alt_names)?;

    let cert_path = out.join("cert.pem");
    let key_path = out.join("key.pem");
    fs::write(&cert_path, cert.pem())?;
    fs::write(&key_path, key_pair.serialize_pem())?;

    println!("wrote {}", cert_path.display());
    println!("wrote {}", key_path.display());
    println!();
    println!("Run the edge against these certs:");
    println!("  OPENLEN_EDGE_CERT={} \\", cert_path.display());
    println!("  OPENLEN_EDGE_KEY={} \\", key_path.display());
    println!("  OPENLEN_EDGE_BIND=127.0.0.1:3443 \\");
    println!("  cargo run -p openlen-edge --release");
    Ok(())
}
