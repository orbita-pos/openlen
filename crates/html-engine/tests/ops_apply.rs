use openlen_html_engine::ops::apply::{
    apply_ops, document_root_op_ids, fragment_preserves_nesting, reject_document_wide_ops, Attr,
    Op, OpType,
};
use openlen_html_engine::ops::tagger::tag_with_op_ids;

fn tag(s: &str) -> String {
    tag_with_op_ids(s).unwrap().tagged_html
}

#[test]
fn empty_ops_returns_null_html() {
    let tagged = tag("<div>hi</div>");
    let r = apply_ops(&tagged, &[]);
    assert!(r.html.is_none());
    assert_eq!(r.applied_count, 0);
    assert!(r.errors.is_empty());
}

#[test]
fn replace_substitutes_outer_html() {
    let tagged = tag("<div><p>old</p></div>");
    // p has id "1" (div is "0").
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "1".to_string(),
        new_html: Some("<h1>new</h1>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("<h1>new</h1>"));
    assert!(!html.contains("<p>old</p>"));
    assert!(!html.contains("data-op-id"));
}

#[test]
fn delete_removes_element() {
    let tagged = tag("<div><p>keep</p><span>drop</span></div>");
    // div=0, p=1, span=2
    let ops = vec![Op {
        op_type: OpType::Delete,
        target: "2".to_string(),
        new_html: None,
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("<p>keep</p>"));
    assert!(!html.contains("<span>drop</span>"));
}

#[test]
fn insert_before_prepends_sibling() {
    let tagged = tag("<div><p>x</p></div>");
    // div=0, p=1
    let ops = vec![Op {
        op_type: OpType::InsertBefore,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    let html = r.html.unwrap();
    // <hr> appears before <p>
    let hr_idx = html.find("<hr>").expect("hr present");
    let p_idx = html.find("<p>x</p>").expect("p present");
    assert!(hr_idx < p_idx);
}

#[test]
fn insert_after_appends_sibling() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![Op {
        op_type: OpType::InsertAfter,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    let html = r.html.unwrap();
    let hr_idx = html.find("<hr>").unwrap();
    let p_idx = html.find("<p>x</p>").unwrap();
    assert!(p_idx < hr_idx);
}

#[test]
fn validation_fails_on_missing_target() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "zzz".to_string(),
        new_html: Some("y".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none());
    assert_eq!(r.applied_count, 0);
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].reason.contains("doesn't exist"));
}

#[test]
fn validation_fails_on_empty_new_html() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "0".to_string(),
        new_html: Some("   ".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none());
    assert!(r.errors[0].reason.contains("non-empty <new>"));
}

#[test]
fn validation_passes_for_delete_without_new_html() {
    let tagged = tag("<div>x</div>");
    let ops = vec![Op {
        op_type: OpType::Delete,
        target: "0".to_string(),
        new_html: None,
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 1);
}

#[test]
fn multiple_ops_apply_in_order() {
    let tagged = tag("<div><p>a</p><p>b</p><p>c</p></div>");
    // div=0, p=1,2,3
    let ops = vec![
        Op {
            op_type: OpType::Replace,
            target: "1".to_string(),
            new_html: Some("<h1>A</h1>".to_string()),
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::Delete,
            target: "3".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert_eq!(r.errors.len(), 0);
    assert_eq!(r.applied_count, 2);
    let html = r.html.unwrap();
    assert!(html.contains("<h1>A</h1>"));
    assert!(html.contains("<p>b</p>"));
    assert!(!html.contains("<p>c</p>"));
}

#[test]
fn cascade_on_same_target_records_warning() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![
        Op {
            op_type: OpType::Replace,
            target: "1".to_string(),
            new_html: Some("<h1>new</h1>".to_string()),
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    // Pre-validation passed (target exists once). Phase 2 applies first,
    // second cascades.
    assert_eq!(r.applied_count, 1);
    assert_eq!(r.errors.len(), 1);
    assert!(r.errors[0].reason.contains("unreachable"));
}

#[test]
fn op_id_stripped_after_apply() {
    let tagged = tag("<div><p>x</p></div>");
    let ops = vec![Op {
        op_type: OpType::InsertAfter,
        target: "1".to_string(),
        new_html: Some("<hr>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    let html = r.html.unwrap();
    assert!(!html.contains("data-op-id"));
}

// ─── Guardas estructurales (2026-09-01) ─────────────────────────────────────

#[test]
fn root_op_ids_finds_html_and_body() {
    let tagged = tag("<html><body><p>x</p></body></html>");
    let roots = document_root_op_ids(&tagged).unwrap();
    // El etiquetador salta <html>, así que la única raíz con id es <body>.
    assert_eq!(roots.len(), 1, "roots: {:?} en {}", roots, tagged);
}

#[test]
fn root_op_ids_survives_a_gt_inside_an_attribute_value() {
    // LA RAZÓN DE MOVER ESTO AL CRATE. El patrón que había en TypeScript era
    // `<(?:html|body)\b[^>]*\sdata-op-id="([^"]+)"`, y su `[^>]*` no puede
    // cruzar el `>` de `[&>*]:mt-4` — así que no veía la raíz, no rechazaba
    // nada, y un `replace` contra el <body> se llevaba la página entera.
    let tagged = tag(r#"<body class="[&>*]:mt-4"><p>x</p></body>"#);
    let roots = document_root_op_ids(&tagged).unwrap();
    assert_eq!(
        roots.len(),
        1,
        "el <body> con un > en el class sigue siendo raíz"
    );

    let targets: Vec<&str> = vec!["0", "1"];
    let r = reject_document_wide_ops(&tagged, &targets);
    assert_eq!(r.rejected, vec![0], "la op contra el <body> se rechaza");
    assert_eq!(r.kept, vec![1], "la op contra el <p> se conserva");
}

#[test]
fn reject_document_wide_keeps_everything_when_there_is_no_root() {
    let tagged = tag("<div><p>x</p></div>");
    let targets: Vec<&str> = vec!["0", "1"];
    let r = reject_document_wide_ops(&tagged, &targets);
    assert_eq!(r.kept, vec![0, 1]);
    assert!(r.rejected.is_empty());
}

#[test]
fn nesting_guard_accepts_well_formed_fragments() {
    for f in [
        "<h1>hola</h1>",
        "<div class=\"a\"><p>x</p></div>",
        "<img src=\"a.png\">",
        "<br>",
        "<section><div><p>hondo</p></div></section>",
        // HTML cierra solo: un <p> sin cerrar seguido de un bloque no
        // reestructura nada. Un contador de etiquetas lo rechazaría.
        "<p>hola",
        "<li>suelto</li>",
        "<td>celda</td>",
        "<style>.a{color:red}</style>",
    ] {
        assert!(
            fragment_preserves_nesting(f),
            "falso rechazo sobre un fragmento sano: {f:?}"
        );
    }
}

#[test]
fn nesting_guard_rejects_fragments_that_restructure_what_follows() {
    for f in [
        // Abre y no cierra: se traga lo que venga detrás.
        "<div class=\"hero\"><h1>Nuevo</h1>",
        "<section>",
        "<div><div><p>x</p></div>",
        // Cierra lo que no abrió: se lleva por delante a su propio contenedor.
        "<p>x</p></div>",
        "</div><p>x</p>",
    ] {
        assert!(
            !fragment_preserves_nesting(f),
            "guarda ciega ante un fragmento que reestructura: {f:?}"
        );
    }
}

#[test]
fn apply_rejects_the_batch_when_new_html_swallows_the_page() {
    // MEDIDO antes del arreglo: esto salía con `errors: []`, `applied_count: 1`
    // y el <p> y el <footer> metidos dentro del div.hero.
    let tagged = tag("<body><h1>Titulo</h1><p>parrafo</p><footer>pie</footer></body>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "1".to_string(),
        new_html: Some("<div class=\"hero\"><h1>Nuevo</h1>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none(), "la tanda tiene que morir entera");
    assert_eq!(r.applied_count, 0);
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert!(
        r.errors[0].reason.contains("anidamiento"),
        "motivo: {}",
        r.errors[0].reason
    );
}

#[test]
fn apply_still_accepts_a_balanced_replacement() {
    let tagged = tag("<body><h1>Titulo</h1><p>parrafo</p></body>");
    let ops = vec![Op {
        op_type: OpType::Replace,
        target: "1".to_string(),
        new_html: Some("<div class=\"hero\"><h1>Nuevo</h1></div>".to_string()),
        attrs: Vec::new(),
        text: None,
    }];
    let r = apply_ops(&tagged, &ops);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("<div class=\"hero\"><h1>Nuevo</h1></div>"));
    assert!(
        html.contains("<p>parrafo</p>"),
        "el resto sigue fuera: {html}"
    );
}

#[test]
fn apply_rejects_a_batch_that_deletes_an_ancestor_of_another_op() {
    // <section id 1> envuelve al <h1 id 2>. Borrar la sección Y editar el
    // titular de dentro es una tanda que se contradice.
    let tagged = tag("<body><section><h1>Titulo</h1></section><p>x</p></body>");
    let ops = vec![
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::Replace,
            target: "2".to_string(),
            new_html: Some("<h1>Otro</h1>".to_string()),
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none(), "no se aplica ninguna");
    assert_eq!(r.applied_count, 0);
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert_eq!(r.errors[0].op_index, 1, "señala a la op huérfana");
    assert!(
        r.errors[0].reason.contains("se contradice"),
        "motivo: {}",
        r.errors[0].reason
    );
}

#[test]
fn apply_rejects_it_in_either_emission_order() {
    // El mismo conflicto con las ops al revés: primero la edición, luego el
    // borrado del ancestro. Sigue siendo la misma contradicción.
    let tagged = tag("<body><section><h1>Titulo</h1></section><p>x</p></body>");
    let ops = vec![
        Op {
            op_type: OpType::Replace,
            target: "2".to_string(),
            new_html: Some("<h1>Otro</h1>".to_string()),
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none());
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert_eq!(r.errors[0].op_index, 0);
}

#[test]
fn deleting_siblings_is_still_fine() {
    // Dos borrados que no cuelgan uno de otro no son ninguna contradicción.
    let tagged = tag("<body><section>a</section><aside>b</aside><p>c</p></body>");
    let ops = vec![
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::Delete,
            target: "2".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 2);
    let html = r.html.unwrap();
    assert!(!html.contains("<section>"));
    assert!(!html.contains("<aside>"));
    assert!(html.contains("<p>c</p>"));
}

#[test]
fn inserting_inside_a_section_being_deleted_is_also_a_contradiction() {
    let tagged = tag("<body><section><h1>t</h1></section></body>");
    let ops = vec![
        Op {
            op_type: OpType::Delete,
            target: "1".to_string(),
            new_html: None,
            attrs: Vec::new(),
            text: None,
        },
        Op {
            op_type: OpType::InsertAfter,
            target: "2".to_string(),
            new_html: Some("<p>nuevo</p>".to_string()),
            attrs: Vec::new(),
            text: None,
        },
    ];
    let r = apply_ops(&tagged, &ops);
    assert!(r.html.is_none(), "errors: {:?}", r.errors);
    assert_eq!(r.errors.len(), 1);
}

// ─── La op `attrs` (2026-09-01) ─────────────────────────────────────────────
//
// Sustituye a `reescribirAperturaPorOpId`, que reescribía la etiqueta de
// apertura con una expresión regular desde TypeScript.

fn attrs_op(target: &str, pares: &[(&str, Option<&str>)]) -> Op {
    Op {
        op_type: OpType::Attrs,
        target: target.to_string(),
        new_html: None,
        attrs: pares
            .iter()
            .map(|(n, v)| Attr {
                name: (*n).to_string(),
                value: v.map(|s| s.to_string()),
            })
            .collect(),
        text: None,
    }
}

#[test]
fn attrs_writes_removes_and_keeps_the_subtree() {
    let tagged = tag("<div><p class=\"vieja\" hidden>texto <b>fuerte</b></p></div>");
    let r = apply_ops(
        &tagged,
        &[attrs_op(
            "1",
            &[
                ("style", Some("color:red")),
                ("class", Some("nueva")),
                ("hidden", None),
            ],
        )],
    );
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("style=\"color:red\""), "{html}");
    assert!(html.contains("class=\"nueva\""), "{html}");
    assert!(!html.contains("hidden"), "el booleano se va: {html}");
    assert!(
        html.contains("texto <b>fuerte</b>"),
        "el subárbol no se toca: {html}"
    );
}

#[test]
fn attrs_writes_the_empty_string_instead_of_removing() {
    // `data-ol-reink=""` es como la re-tinta anota «no tenía color propio».
    // Perderlo deja el color puesto sin forma de volver atrás.
    let tagged = tag("<div><p>x</p></div>");
    let r = apply_ops(&tagged, &[attrs_op("1", &[("data-ol-reink", Some(""))])]);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert!(r.html.unwrap().contains("data-ol-reink=\"\""));
}

#[test]
fn attrs_survives_a_gt_inside_another_attribute_value() {
    // EL BUG QUE MATA ESTO. El regex de `reescribirAperturaPorOpId` era
    // `<[a-zA-Z][\w-]*\b[^>]*\sdata-op-id="…"[^>]*>`, y su `[^>]*` no cruza el
    // `>` de `alt="Antes > Despues"`: devolvía null y la tanda entera del
    // taller moría con «no se pudo leer la etiqueta de apertura».
    let tagged = tag("<div><img alt=\"Antes > Despues\" src=\"a.png\"></div>");
    let r = apply_ops(&tagged, &[attrs_op("1", &[("style", Some("border:0"))])]);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("style=\"border:0\""), "{html}");
    assert!(
        html.contains("alt=\"Antes > Despues\""),
        "no se pierde: {html}"
    );
}

#[test]
fn a_whole_batch_of_attrs_travels_in_one_pass_without_stepping_on_itself() {
    // Anidados unos dentro de otros. Como la op no cambia la estructura,
    // ningún op-id se desplaza y las tres se resuelven contra el mismo
    // documento estampado — que es lo que hace viable una re-tinta de cientos
    // de elementos.
    let tagged = tag("<section><div><p>x</p></div></section>");
    let r = apply_ops(
        &tagged,
        &[
            attrs_op("0", &[("style", Some("a:1"))]),
            attrs_op("1", &[("style", Some("b:2"))]),
            attrs_op("2", &[("style", Some("c:3"))]),
        ],
    );
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 3);
    let html = r.html.unwrap();
    assert!(
        html.contains("a:1") && html.contains("b:2") && html.contains("c:3"),
        "{html}"
    );
}

#[test]
fn attrs_cannot_rewrite_the_op_id_marker() {
    let tagged = tag("<div><p>x</p></div>");
    let r = apply_ops(&tagged, &[attrs_op("1", &[("data-op-id", Some("99"))])]);
    assert!(r.html.is_none());
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert!(r.errors[0].reason.contains("Invalid attribute name"));
}

#[test]
fn attrs_needs_at_least_one_attribute() {
    let tagged = tag("<div><p>x</p></div>");
    let r = apply_ops(&tagged, &[attrs_op("1", &[])]);
    assert!(r.html.is_none());
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert!(r.errors[0].reason.contains("at least one attribute"));
}

#[test]
fn attrs_does_not_block_a_later_op_on_the_same_target() {
    // La op no destruye el elemento, así que lo que venga detrás sobre el mismo
    // id sigue siendo legítimo — al revés que un `replace` o un `delete`.
    let tagged = tag("<div><p>x</p></div>");
    let r = apply_ops(
        &tagged,
        &[
            attrs_op("1", &[("style", Some("a:1"))]),
            Op {
                op_type: OpType::InsertAfter,
                target: "1".to_string(),
                new_html: Some("<p>y</p>".to_string()),
                attrs: Vec::new(),
                text: None,
            },
        ],
    );
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 2);
    let html = r.html.unwrap();
    assert!(html.contains("a:1") && html.contains("<p>y</p>"), "{html}");
}

// ─── La op `text` (2026-09-03) ──────────────────────────────────────────────
//
// La hermana de `attrs`: aquella cubre «como se ve», esta «que dice». Existe
// para que cambiar una palabra deje de obligar a `Replace` sobre el nodo, que
// sustituye el SUBARBOL y es por donde se han perdido secciones enteras.
//
// DOS BRAZOS EN CADA CASO: que haga lo suyo, y que se NIEGUE cuando poner texto
// seria un borrado encubierto. Sin el segundo, este verbo seria una forma nueva
// y mas comoda de romper una pagina.

fn text_op(target: &str, texto: Option<&str>) -> Op {
    Op {
        op_type: OpType::Text,
        target: target.to_string(),
        new_html: None,
        attrs: Vec::new(),
        text: texto.map(|s| s.to_string()),
    }
}

#[test]
fn text_cambia_el_texto_y_conserva_clases_y_atributos() {
    let tagged = tag("<div><h1 class=\"titulo grande\" data-ol-x=\"1\">Viejo</h1></div>");
    let r = apply_ops(&tagged, &[text_op("1", Some("Nuevo"))]);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 1);
    let html = r.html.unwrap();
    assert!(html.contains("Nuevo"), "{}", html);
    assert!(!html.contains("Viejo"), "{}", html);
    // LO QUE `replace` HABRIA OBLIGADO A RETECLEAR, y por tanto a perder:
    assert!(html.contains("class=\"titulo grande\""), "{}", html);
    assert!(html.contains("data-ol-x=\"1\""), "{}", html);
}

#[test]
fn text_se_niega_sobre_un_nodo_con_hijos_y_dice_a_que_id_apuntar() {
    // BRAZO DE CONTROL. Este es el caso que convierte el verbo en un peligro:
    // poner texto en un contenedor se llevaria por delante a sus hijos.
    let tagged = tag("<div><section><h1>Titulo</h1><img src=\"foto.webp\"></section></div>");
    let r = apply_ops(&tagged, &[text_op("1", Some("Hola"))]);
    assert_eq!(r.applied_count, 0);
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    let motivo = &r.errors[0].reason;
    assert!(motivo.contains("hijo"), "{}", motivo);
    // Y le dice a QUE apuntar, que es la diferencia entre un no y una ayuda.
    assert!(motivo.contains("ids son"), "{}", motivo);
    // Nada se aplico: la tanda entera se para, como el resto de validaciones.
    assert!(r.html.is_none());
}

#[test]
fn text_se_niega_sobre_un_elemento_vacio() {
    let tagged = tag("<div><img src=\"foto.webp\"></div>");
    let r = apply_ops(&tagged, &[text_op("1", Some("Hola"))]);
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert!(r.errors[0].reason.contains("no tiene contenido"), "{:?}", r.errors);
    // Y le empuja al verbo correcto para una imagen.
    assert!(r.errors[0].reason.contains("attrs"), "{:?}", r.errors);
}

#[test]
fn text_sin_el_campo_es_un_error_de_quien_llama() {
    let tagged = tag("<div><h1>Viejo</h1></div>");
    let r = apply_ops(&tagged, &[text_op("1", None)]);
    assert_eq!(r.errors.len(), 1, "errors: {:?}", r.errors);
    assert!(r.errors[0].reason.contains("`text`"), "{:?}", r.errors);
}

#[test]
fn text_con_cadena_vacia_es_legitimo() {
    // «Deja este nodo sin texto» es una peticion real y distinta de «falta el
    // campo». Por eso el campo es Option y no se valida por vacio.
    let tagged = tag("<div><h1 class=\"t\">Viejo</h1></div>");
    let r = apply_ops(&tagged, &[text_op("1", Some(""))]);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    let html = r.html.unwrap();
    assert!(html.contains("class=\"t\""), "{}", html);
    assert!(!html.contains("Viejo"), "{}", html);
}

#[test]
fn text_escribe_TEXTO_no_html() {
    // Si esto se empalmara como HTML, el verbo seria una via de inyeccion: el
    // modelo escribe lo que le dicte el contenido de la pagina del usuario.
    let tagged = tag("<div><p>viejo</p></div>");
    let r = apply_ops(&tagged, &[text_op("1", Some("<script>alert(1)</script>"))]);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    let html = r.html.unwrap();
    assert!(!html.contains("<script>"), "se empalmo como HTML: {}", html);
    assert!(html.contains("&lt;script&gt;"), "{}", html);
}

#[test]
fn text_no_desplaza_ids_asi_que_encadena_con_otra_op() {
    // Como `attrs`: al no cambiar la estructura, una segunda op sobre el mismo
    // id sigue siendo legitima dentro de la misma tanda.
    let tagged = tag("<div><h1 class=\"vieja\">Viejo</h1></div>");
    let ops = vec![
        text_op("1", Some("Nuevo")),
        attrs_op("1", &[("class", Some("nueva"))]),
    ];
    let r = apply_ops(&tagged, &ops);
    assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
    assert_eq!(r.applied_count, 2);
    let html = r.html.unwrap();
    assert!(html.contains("Nuevo"), "{}", html);
    assert!(html.contains("class=\"nueva\""), "{}", html);
}
