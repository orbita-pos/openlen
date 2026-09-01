use openlen_html_engine::ops::resolver::outer_html_by_op_id;
use openlen_html_engine::ops::tagger::tag_with_op_ids;

fn tag(s: &str) -> String {
    tag_with_op_ids(s).unwrap().tagged_html
}

#[test]
fn returns_the_exact_bytes_of_the_element() {
    let tagged = tag("<div><section><h1>Hola</h1><p>Texto</p></section></div>");
    let out = outer_html_by_op_id(&tagged, "1").unwrap();
    assert!(out.starts_with("<section"), "{out}");
    assert!(out.ends_with("</section>"), "{out}");
    assert!(out.contains("<h1"), "{out}");
    assert!(out.contains("Texto"), "{out}");
}

#[test]
fn survives_a_gt_inside_an_attribute_value() {
    // EL BUG QUE MATA ESTO. `elementoDe` en TypeScript buscaba la apertura con
    // `[^>]*`, que no cruza el `>` de `alt="Antes > Despues"` — devolvia None y
    // el taller tumbaba la tanda entera con `ruta_no_resuelve`.
    let tagged = tag("<div><img alt=\"Antes > Despues\" src=\"a.png\"><p>x</p></div>");
    let out = outer_html_by_op_id(&tagged, "1").unwrap();
    assert!(out.starts_with("<img"), "{out}");
    assert!(out.contains("alt=\"Antes > Despues\""), "{out}");
    assert!(!out.contains("<p>"), "no se lleva al hermano: {out}");
}

#[test]
fn does_not_normalise_the_users_markup() {
    // Comillas simples, atributo sin comillas y mayusculas: todo tiene que
    // volver tal cual. Serializar el arbol lo reescribiria de arriba abajo, y
    // este recorte se vuelve a meter en la pagina cuando se mueve una seccion.
    let raro = "<div><SPAN class='a' data-x=1 title=\"a > b\">Y</SPAN></div>";
    let tagged = tag(raro);
    let out = outer_html_by_op_id(&tagged, "1").unwrap();
    assert!(out.contains("class='a'"), "comillas simples intactas: {out}");
    assert!(out.contains("data-x=1"), "sin comillas intacto: {out}");
    assert!(out.contains("title=\"a > b\""), "{out}");
}

#[test]
fn nested_same_tag_does_not_close_early() {
    let tagged = tag("<div><div><div>hondo</div></div></div>");
    let out = outer_html_by_op_id(&tagged, "1").unwrap();
    assert!(out.contains("hondo"), "{out}");
    assert_eq!(out.matches("</div>").count(), 2, "{out}");
}

#[test]
fn missing_id_returns_none() {
    let tagged = tag("<div><p>x</p></div>");
    assert!(outer_html_by_op_id(&tagged, "99").is_none());
}

#[test]
fn a_document_carrying_the_sentinel_returns_none() {
    let tagged = tag("<div><p>x</p></div>");
    let adversario = format!("<!--ol-cut-a-->{tagged}");
    assert!(outer_html_by_op_id(&adversario, "1").is_none());
}
