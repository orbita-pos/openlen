/// Convert a counter to the same base36 string `Number.prototype.toString(36)`
/// produces. JS-parity is the contract — Kimi's prompts and existing fixtures
/// both assume 0→"0", 9→"9", 10→"a", 35→"z", 36→"10", ... .
pub fn base36(mut n: u32) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let mut bytes = Vec::with_capacity(7);
    while n > 0 {
        let d = (n % 36) as u8;
        let c = if d < 10 { b'0' + d } else { b'a' + (d - 10) };
        bytes.push(c);
        n /= 36;
    }
    bytes.reverse();
    String::from_utf8(bytes).expect("base36 emits ASCII only")
}

#[cfg(test)]
mod tests {
    use super::base36;

    #[test]
    fn matches_js_to_string_36() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(9), "9");
        assert_eq!(base36(10), "a");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(base36(37), "11");
        assert_eq!(base36(1295), "zz");
        assert_eq!(base36(1296), "100");
    }
}
