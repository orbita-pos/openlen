use openlen_html_engine::ops::apply::OpType;
use openlen_html_engine::ops::parse::parse_ops;

#[test]
fn empty_returns_error() {
    let r = parse_ops("");
    assert!(r.ops.is_empty());
    assert!(!r.errors.is_empty());
}

#[test]
fn no_edits_block_falls_back() {
    let r = parse_ops("<div>random html</div>");
    assert!(r.ops.is_empty());
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].contains("No <edits>"));
}

#[test]
fn self_closing_delete() {
    let r = parse_ops(r#"<edits><edit op="delete" target="a"/></edits>"#);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].op_type, OpType::Delete);
    assert_eq!(r.ops[0].target, "a");
    assert!(r.ops[0].new_html.is_none());
}

#[test]
fn open_close_replace_with_new_wrapper() {
    let r = parse_ops(
        r#"<edits><edit op="replace" target="b"><new><h1>Title</h1></new></edit></edits>"#,
    );
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].op_type, OpType::Replace);
    assert_eq!(r.ops[0].new_html.as_deref(), Some("<h1>Title</h1>"));
}

#[test]
fn open_close_replace_natural_form() {
    // Kimi's preferred natural form (no <new> wrapper).
    let r = parse_ops(r#"<edits><edit op="replace" target="b"><h1>Title</h1></edit></edits>"#);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 1);
    assert_eq!(r.ops[0].new_html.as_deref(), Some("<h1>Title</h1>"));
}

#[test]
fn insert_before_and_after() {
    let r = parse_ops(
        r#"<edits>
          <edit op="insert_before" target="a"><div>top</div></edit>
          <edit op="insert_after" target="b"><div>bot</div></edit>
        </edits>"#,
    );
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.ops.len(), 2);
    assert_eq!(r.ops[0].op_type, OpType::InsertBefore);
    assert_eq!(r.ops[1].op_type, OpType::InsertAfter);
}

#[test]
fn empty_new_content_errors() {
    let r = parse_ops(r#"<edits><edit op="replace" target="a"></edit></edits>"#);
    assert_eq!(r.ops.len(), 0);
    assert!(r.errors.iter().any(|e| e.contains("empty content")));
}

#[test]
fn missing_target_errors() {
    let r = parse_ops(r#"<edits><edit op="replace"><div>x</div></edit></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("missing op or target")));
}

#[test]
fn self_closing_with_non_delete_op_errors() {
    let r = parse_ops(r#"<edits><edit op="replace" target="a"/></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("self-closing")));
}

#[test]
fn unknown_op_type_errors() {
    let r = parse_ops(r#"<edits><edit op="rotate" target="a"><div>x</div></edit></edits>"#);
    assert!(r.errors.iter().any(|e| e.contains("Unknown op type")));
}

// ── La raíz del defecto del 2026-08-25 ──────────────────────────────────────
//
// Había DOS pasadas y se solapaban: la de la forma abierta era
// `<edit\b([^>]*)>(.*?)</edit>`, y `[^>]*` casa también la `/` de una etiqueta
// auto-cerrada porque `/` no es `>`. Así que un `<edit/>` seguido de otro edit
// salía DUPLICADO y se comía al siguiente, con `errors` vacío.
//
// Se descubrió desde TypeScript, donde se tapó normalizando antes del parser
// (lib/html-ops.ts). Esto es el arreglo en la raíz.

#[test]
fn self_closing_no_se_traga_el_siguiente_edit() {
    let r = parse_ops(
        r#"<edits><edit op="delete" target="a"/><edit op="replace" target="b"><new><p>x</p></new></edit></edits>"#,
    );
    assert_eq!(r.errors.len(), 0, "errores inesperados: {:?}", r.errors);
    assert_eq!(r.ops.len(), 2, "ops: {:?}", r.ops);
    assert_eq!(r.ops[0].op_type, OpType::Delete);
    assert_eq!(r.ops[0].target, "a");
    assert_eq!(r.ops[1].op_type, OpType::Replace);
    assert_eq!(r.ops[1].target, "b");
    assert_eq!(r.ops[1].new_html.as_deref(), Some("<p>x</p>"));
}

// El ORDEN DE EMISIÓN, que el prompt promete y las dos pasadas rompían: todas
// las auto-cerradas salían antes que cualquier abierta, pasara lo que pasara.
#[test]
fn el_orden_es_el_de_emision_no_el_de_la_forma() {
    let r = parse_ops(
        r#"<edits><edit op="replace" target="uno"><new>1</new></edit><edit op="delete" target="dos"/><edit op="replace" target="tres"><new>3</new></edit></edits>"#,
    );
    assert_eq!(r.errors.len(), 0, "errores inesperados: {:?}", r.errors);
    let targets: Vec<&str> = r.ops.iter().map(|o| o.target.as_str()).collect();
    assert_eq!(targets, vec!["uno", "dos", "tres"]);
}

// CONTRA-PRUEBA: la alternancia lleva la auto-cerrada delante, así que una
// `<edit/>` NO puede caer en la rama abierta y colarse como un op con contenido.
#[test]
fn una_auto_cerrada_que_no_es_delete_sigue_siendo_error() {
    let r = parse_ops(r#"<edits><edit op="replace" target="a"/></edits>"#);
    assert_eq!(r.ops.len(), 0, "ops: {:?}", r.ops);
    assert_eq!(r.errors.len(), 1);
    assert!(
        r.errors[0].contains("can't be self-closing"),
        "{:?}",
        r.errors
    );
}

// Y con espacio antes de la barra, que es como lo escriben la mitad de los
// modelos.
#[test]
fn self_closing_con_espacio_antes_de_la_barra() {
    let r = parse_ops(
        r#"<edits><edit op="delete" target="a" /><edit op="delete" target="b" /></edits>"#,
    );
    assert_eq!(r.errors.len(), 0, "errores inesperados: {:?}", r.errors);
    let targets: Vec<&str> = r.ops.iter().map(|o| o.target.as_str()).collect();
    assert_eq!(targets, vec!["a", "b"]);
}
