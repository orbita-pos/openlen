//! `openlen-edge --ab-sidecar`: the process Caddy delegates an experiment's pages and files to.
//! It is run as the real binary, because what matters is what an operator sees: it binds ONLY the
//! loopback A/B listener (no TLS, no :80/:443, no database, no certificates), and when it cannot,
//! it says so at startup and exits non-zero, so systemd shows a failed unit and Caddy's fail-open
//! carries the traffic meanwhile.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tempfile::TempDir;

fn sidecar(publish_root: &Path, bind: &str) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_openlen-edge"));
    cmd.arg("--ab-sidecar")
        .env_clear()
        .env("OPENLEN_EDGE_PUBLISH_ROOT", publish_root)
        .env("OPENLEN_EDGE_AB_LOOPBACK_BIND", bind)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows needs its system variables to start a process at all.
    for key in ["SystemRoot", "PATH", "TEMP", "TMP"] {
        if let Some(v) = std::env::var_os(key) {
            cmd.env(key, v);
        }
    }
    cmd
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn wait_for(port: u16, child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("the sidecar exited early: {status}");
        }
        assert!(Instant::now() < deadline, "the sidecar never listened on {port}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn get(port: u16, host: &str, path: &str) -> String {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: Mozilla/5.0 Chrome/131.0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    out
}

#[test]
fn it_exits_non_zero_and_says_why_when_its_port_is_taken() {
    let root = TempDir::new().unwrap();
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let bind = taken.local_addr().unwrap().to_string();
    let out = sidecar(root.path(), &bind).output().expect("spawn");
    assert!(!out.status.success(), "a sidecar that cannot bind must not look healthy");
    let said = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(said.contains("failed to bind A/B sidecar"), "stderr/stdout: {said}");
    assert!(said.contains(&bind), "it names the address: {said}");
}

#[test]
fn it_refuses_an_address_that_is_not_loopback() {
    let root = TempDir::new().unwrap();
    let out = sidecar(root.path(), "0.0.0.0:18099").output().expect("spawn");
    assert!(!out.status.success());
    let said = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(said.contains("loopback"), "{said}");
}

#[test]
fn it_needs_no_certificates_database_or_tls_to_serve() {
    let root = TempDir::new().unwrap();
    let rel = root.path().join("demo").join("releases").join("aaaa11112222");
    fs::create_dir_all(rel.join("openlen")).unwrap();
    fs::write(rel.join("index.html"), "<h1>A</h1>").unwrap();
    fs::write(
        rel.join("openlen").join("ab.json"),
        r#"{"version":1,"experiments":[{"id":"ab_9f3c2a1b","cookieName":"ol_ab_9f3c2a1b","targetPath":"/","splitBps":0,"salt":"abcd","prefixB":"openlen/ab/ab_9f3c2a1b/b"}]}"#,
    )
    .unwrap();
    fs::write(root.path().join("demo").join("current"), "aaaa11112222").unwrap();

    let port = free_port();
    let mut child = sidecar(root.path(), &format!("127.0.0.1:{port}"))
        .spawn()
        .expect("spawn");
    wait_for(port, &mut child);
    // `.openlen.app` is a publish host: the site is found from the Host alone.
    let resp = get(port, "demo.openlen.app", "/");
    let _ = child.kill();
    let _ = child.wait();
    assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
    assert!(resp.contains("<h1>A</h1>"), "{resp}");
    assert!(resp.to_ascii_lowercase().contains("cache-control: private, no-store"), "{resp}");
}
