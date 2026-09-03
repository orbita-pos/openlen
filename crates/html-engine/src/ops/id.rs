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

/// El inverso de `base36`, para saber por donde continuar la numeracion.
///
/// `None` cuando la cadena no es un id nuestro (un pipeline de arriba pudo
/// poner cualquier cosa). Quien llama lo trata como «ocupado pero no cuenta
/// para el maximo»: no se puede reutilizar y no debe mover el contador.
pub fn de_base36(s: &str) -> Option<u32> {
    if s.is_empty() || s.len() > 7 {
        return None;
    }
    let mut n: u32 = 0;
    for b in s.bytes() {
        let d = match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'z' => b - b'a' + 10,
            _ => return None,
        };
        n = n.checked_mul(36)?.checked_add(d as u32)?;
    }
    Some(n)
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

    #[test]
    fn de_base36_es_el_inverso() {
        use super::de_base36;
        for n in [0u32, 9, 10, 35, 36, 37, 1295, 1296, 99_999] {
            assert_eq!(de_base36(&base36(n)), Some(n), "no round-trip para {}", n);
        }
        // Lo que no es un id nuestro no cuenta para el maximo.
        assert_eq!(de_base36("A"), None);
        assert_eq!(de_base36("sec-hero"), None);
        assert_eq!(de_base36(""), None);
    }
}
