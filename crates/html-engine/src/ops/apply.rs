use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

use kuchikiki::traits::TendrilSink;
use kuchikiki::NodeRef;
use lol_html::html_content::ContentType;
use lol_html::{element, rewrite_str, RewriteStrSettings};

use super::OP_ID_ATTR;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpType {
    Replace,
    InsertBefore,
    InsertAfter,
    Delete,
    /// Reescribe la ETIQUETA DE APERTURA y nada más: ni saca el subárbol ni lo
    /// vuelve a meter. Es lo que permite que una tanda entera de re-tinta
    /// —cientos de elementos, algunos anidados unos dentro de otros— viaje en
    /// una sola pasada sin que unos se pisen a otros: como no cambia la
    /// estructura, ningún op-id se desplaza.
    Attrs,
    /// Cambia el TEXTO de un nodo y nada mas: ni la etiqueta de apertura, ni
    /// los atributos, ni la estructura.
    ///
    /// POR QUE EXISTE. Sin esto, cambiar una palabra dentro de un elemento
    /// obliga a `Replace` sobre el, y `Replace` sustituye el SUBARBOL entero:
    /// el modelo tiene que volver a teclear las clases, los atributos y los
    /// hijos, y dejarse algo por el camino es como se rompen las paginas. Es la
    /// hermana de `Attrs` — aquella cubre «como se ve», esta «que dice» — y
    /// entre las dos quitan los dos motivos por los que hoy se toca `Replace`
    /// sobre un contenedor.
    ///
    /// Kiro (AWS) lo llama `replace_in_node` y lo mide sobre PolyBench50:
    /// -34,3% de llamadas al modelo, -20,5% de tokens de entrada y CERO errores
    /// de herramienta frente a dos. CODESTRUCT (arXiv 2604.05407) mide la misma
    /// familia sobre SWE-Bench Verified con seis modelos: los fallos de «parche
    /// vacio» caen del 46,6% al 7,2%.
    Text,
}

impl OpType {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "replace" => Self::Replace,
            "insert_before" => Self::InsertBefore,
            "insert_after" => Self::InsertAfter,
            "delete" => Self::Delete,
            "attrs" => Self::Attrs,
            "text" => Self::Text,
            _ => return None,
        })
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::InsertBefore => "insert_before",
            Self::InsertAfter => "insert_after",
            Self::Delete => "delete",
            Self::Attrs => "attrs",
            Self::Text => "text",
        }
    }

    /// ¿Esta op trae un fragmento de HTML que se empalma en el documento?
    fn carries_html(&self) -> bool {
        matches!(self, Self::Replace | Self::InsertBefore | Self::InsertAfter)
    }
}

/// Un atributo a escribir (`Some`) o a quitar (`None`).
///
/// La cadena vacía se ESCRIBE: `data-ol-reink=""` es como la re-tinta anota
/// «este elemento no tenía color propio», y perderlo deja el color puesto sin
/// forma de volver atrás. Por eso quitar es `None` y no `Some("")`.
#[derive(Debug, Clone)]
pub struct Attr {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Op {
    pub op_type: OpType,
    pub target: String,
    pub new_html: Option<String>,
    /// Sólo para `OpType::Attrs`; vacío en las demás.
    pub attrs: Vec<Attr>,
    /// Solo para `OpType::Text`. La cadena vacia es legitima («deja este nodo
    /// sin texto»); `None` en una op de texto es un error de quien llama.
    pub text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ApplyError {
    pub op_index: u32,
    pub op_type: OpType,
    pub target: String,
    pub reason: String,
}

#[derive(Debug)]
pub struct ApplyResult {
    pub html: Option<String>,
    pub errors: Vec<ApplyError>,
    pub applied_count: u32,
}

/// Apply ops in emission order against a tagged HTML document. Phase 1
/// validates the whole batch before any mutation; any validation error bails
/// the batch (no partial-apply). It checks four things:
///   1. every target exists exactly once in the ORIGINAL document,
///   2. non-delete ops carry non-empty `<new>` content,
///   3. that content EMPALMA sin cambiar el anidamiento de lo que le sigue
///      (`fragment_preserves_nesting`),
///   4. ningún `delete` de la tanda es ancestro del objetivo de otra op
///      (`deleted_ancestor_conflicts`).
///
/// Returns the spliced doc with `data-op-id` attributes stripped.
pub fn apply_ops(tagged_html: &str, ops: &[Op]) -> ApplyResult {
    if ops.is_empty() {
        return ApplyResult {
            html: None,
            errors: vec![],
            applied_count: 0,
        };
    }

    let present = match collect_op_id_counts(tagged_html) {
        Ok(m) => m,
        Err(e) => {
            return ApplyResult {
                html: None,
                errors: vec![ApplyError {
                    op_index: 0,
                    op_type: OpType::Replace,
                    target: String::new(),
                    reason: format!("scan failed: {}", e),
                }],
                applied_count: 0,
            };
        }
    };

    let mut errors: Vec<ApplyError> = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let count = present.get(&op.target).copied().unwrap_or(0);
        if count == 0 {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: format!(
                    "No element with {}=\"{}\" — model addressed an ID that doesn't exist in the document.",
                    OP_ID_ATTR, op.target
                ),
            });
        } else if count > 1 {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: format!(
                    "Multiple elements with {}=\"{}\" — tagging invariant violated.",
                    OP_ID_ATTR, op.target
                ),
            });
        }
        if op.op_type == OpType::Attrs {
            if op.attrs.is_empty() {
                errors.push(ApplyError {
                    op_index: i as u32,
                    op_type: op.op_type,
                    target: op.target.clone(),
                    reason: "Op needs at least one attribute".to_string(),
                });
            }
            for a in &op.attrs {
                if !is_valid_attribute_name(&a.name) {
                    errors.push(ApplyError {
                        op_index: i as u32,
                        op_type: op.op_type,
                        target: op.target.clone(),
                        reason: format!("Invalid attribute name \"{}\"", a.name),
                    });
                }
            }
        } else if op.op_type.carries_html()
            && op.new_html.as_ref().is_none_or(|s| s.trim().is_empty())
        {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: op.op_type,
                target: op.target.clone(),
                reason: "Op needs non-empty <new> content".to_string(),
            });
        } else if op.op_type == OpType::Text {
            if op.text.is_none() {
                errors.push(ApplyError {
                    op_index: i as u32,
                    op_type: op.op_type,
                    target: op.target.clone(),
                    reason: "Una op de texto necesita el campo `text` (la cadena vacia vale; ausente no)."
                        .to_string(),
                });
            }
        } else if op.op_type.carries_html() {
            // EL FRAGMENTO NO PUEDE REESTRUCTURAR LO QUE LE SIGUE. Un
            // `new_html` que abre y no cierra se traga el resto de la página,
            // y hasta hoy salía con cero errores.
            let fragmento = op.new_html.as_deref().unwrap_or("");
            if !fragment_preserves_nesting(fragmento) {
                errors.push(ApplyError {
                    op_index: i as u32,
                    op_type: op.op_type,
                    target: op.target.clone(),
                    reason: "El <new> no cierra lo que abre (o cierra lo que no abrió): empalmarlo cambiaría el anidamiento del resto de la página.".to_string(),
                });
            }
        }
    }

    // UNA OP DE TEXTO SOBRE UN CONTENEDOR SERIA UN BORRADO ENCUBIERTO. Poner
    // texto en un nodo que tiene hijos elemento se los llevaria por delante —
    // exactamente el destrozo que este verbo viene a evitar—, asi que se
    // rechaza y se le dice a QUE id apuntar en su lugar.
    if errors.is_empty() {
        for (i, objetivo, motivo) in text_targets_invalidos(tagged_html, ops) {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: ops[i].op_type,
                target: objetivo,
                reason: motivo,
            });
        }
    }

    // Una tanda que borra una sección Y edita algo de dentro se contradice a sí
    // misma. Antes se aplicaba a medias con un aviso que nadie leía.
    if errors.is_empty() && ops.len() > 1 {
        for (i, objetivo, ancestro) in deleted_ancestor_conflicts(tagged_html, ops) {
            errors.push(ApplyError {
                op_index: i as u32,
                op_type: ops[i].op_type,
                target: objetivo.clone(),
                reason: format!(
                    "La op apunta a \"{}\", que cuelga de \"{}\" — y esta misma tanda borra \"{}\". La tanda se contradice: no se aplica ninguna.",
                    objetivo, ancestro, ancestro
                ),
            });
        }
    }

    if !errors.is_empty() {
        return ApplyResult {
            html: None,
            errors,
            applied_count: 0,
        };
    }

    // Phase 2 — bucket ops by target so multiple ops on the same id can be
    // processed in emission order during the single element-handler call.
    let mut by_target: HashMap<String, Vec<(u32, Op)>> = HashMap::new();
    for (i, op) in ops.iter().enumerate() {
        by_target
            .entry(op.target.clone())
            .or_default()
            .push((i as u32, op.clone()));
    }

    let applied = Cell::new(0u32);
    let cascade: RefCell<Vec<ApplyError>> = RefCell::new(Vec::new());

    let rewrite = rewrite_str(
        tagged_html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                let id = el.get_attribute(OP_ID_ATTR).unwrap_or_default();
                if let Some(op_list) = by_target.get(id.as_str()) {
                    let mut killed = false;
                    for (idx, op) in op_list {
                        if killed {
                            cascade.borrow_mut().push(ApplyError {
                                op_index: *idx,
                                op_type: op.op_type,
                                target: op.target.clone(),
                                reason: "Target became unreachable after earlier ops (likely an ancestor was deleted).".to_string(),
                            });
                            continue;
                        }
                        let content = op.new_html.as_deref().unwrap_or("");
                        match op.op_type {
                            OpType::Replace => {
                                el.replace(content, ContentType::Html);
                                killed = true;
                            }
                            OpType::InsertBefore => {
                                el.before(content, ContentType::Html);
                            }
                            OpType::InsertAfter => {
                                el.after(content, ContentType::Html);
                            }
                            OpType::Delete => {
                                el.remove();
                                killed = true;
                            }
                            OpType::Attrs => {
                                // NO pone `killed`: la estructura no cambia, así
                                // que una op posterior sobre el mismo id sigue
                                // siendo legítima.
                                for a in &op.attrs {
                                    match &a.value {
                                        Some(v) => {
                                            if el.set_attribute(&a.name, v).is_err() {
                                                cascade.borrow_mut().push(ApplyError {
                                                    op_index: *idx,
                                                    op_type: op.op_type,
                                                    target: op.target.clone(),
                                                    reason: format!(
                                                        "El motor rechazó el atributo \"{}\"",
                                                        a.name
                                                    ),
                                                });
                                            }
                                        }
                                        None => el.remove_attribute(&a.name),
                                    }
                                }
                            }
                            OpType::Text => {
                                // Como `Attrs`, NO pone `killed`: el nodo sigue
                                // ahi y ningun op-id se desplaza — la fase 1 ya
                                // garantizo que no tiene hijos elemento.
                                el.set_inner_content(
                                    op.text.as_deref().unwrap_or(""),
                                    ContentType::Text,
                                );
                            }
                        }
                        applied.set(applied.get() + 1);
                    }
                }
                el.remove_attribute(OP_ID_ATTR);
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    );

    let html = match rewrite {
        Ok(s) => s,
        Err(e) => {
            return ApplyResult {
                html: None,
                errors: vec![ApplyError {
                    op_index: 0,
                    op_type: OpType::Replace,
                    target: String::new(),
                    reason: format!("rewrite failed: {}", e),
                }],
                applied_count: 0,
            };
        }
    };

    ApplyResult {
        html: Some(html),
        errors: cascade.into_inner(),
        applied_count: applied.get(),
    }
}

fn collect_op_id_counts(html: &str) -> Result<HashMap<String, u32>, String> {
    let counts: RefCell<HashMap<String, u32>> = RefCell::new(HashMap::new());
    rewrite_str(
        html,
        RewriteStrSettings {
            element_content_handlers: vec![element!("[data-op-id]", |el| {
                let id = el.get_attribute(OP_ID_ATTR).unwrap_or_default();
                *counts.borrow_mut().entry(id).or_insert(0) += 1;
                Ok(())
            })],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(counts.into_inner())
}

// ─── Guardas estructurales ──────────────────────────────────────────────────
//
// Las tres viven aquí, y no en TypeScript, por la misma razón: todas preguntan
// algo sobre la ESTRUCTURA del documento («¿este id es la raíz?», «¿este
// fragmento cierra lo que abre?», «¿este id cuelga de aquél?»), y esa pregunta
// sólo la contesta bien un parser. En TS se contestaban con expresiones
// regulares sobre la cadena, que es donde se rompían.

/// Los op-id que llevan `<html>` y `<body>` — la raíz del documento.
///
/// Se buscan con el SELECTOR del motor, no con un patrón sobre el texto. El
/// patrón que había antes en `lib/html-ops.ts` era
/// `<(?:html|body)\b[^>]*\sdata-op-id="([^"]+)"`, y ese `[^>]*` no puede cruzar
/// un `>` — así que un `<body class="[&>*]:mt-4" data-op-id="0">` no casaba y
/// el `replace` contra el documento entero pasaba de largo.
pub fn document_root_op_ids(tagged_html: &str) -> Result<HashSet<String>, String> {
    let ids: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    rewrite_str(
        tagged_html,
        RewriteStrSettings {
            element_content_handlers: vec![
                element!("html[data-op-id]", |el| {
                    if let Some(id) = el.get_attribute(OP_ID_ATTR) {
                        ids.borrow_mut().insert(id);
                    }
                    Ok(())
                }),
                element!("body[data-op-id]", |el| {
                    if let Some(id) = el.get_attribute(OP_ID_ATTR) {
                        ids.borrow_mut().insert(id);
                    }
                    Ok(())
                }),
            ],
            ..RewriteStrSettings::default()
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(ids.into_inner())
}

/// El reparto: las ops que se pueden aplicar y las que se llevarían la página
/// entera por delante.
///
/// Reescribir el documento entero es el Modo B, no una op. Las demás ops de la
/// misma tanda SÍ se aplican — el usuario pidió dos cosas y perder una es mucho
/// menos malo que perder su página. Quien llama tiene que avisar de lo
/// descartado; perderlo en silencio es la degradación que este repo prohíbe.
/// El reparto va POR ÍNDICES, no por ops clonadas: así quien llama reparte sus
/// propias ops sin que éstas tengan que dar la vuelta por el tipo nativo. En el
/// puente napi eso importa —una op con un tipo desconocido tiene que llegar
/// intacta a `apply_ops`, que es quien sabe decir «Unknown op type»— y aquí
/// dentro no cuesta nada.
#[derive(Debug, Default)]
pub struct RejectResult {
    pub kept: Vec<usize>,
    pub rejected: Vec<usize>,
}

pub fn reject_document_wide_ops(tagged_html: &str, targets: &[&str]) -> RejectResult {
    // Un documento sin raíz etiquetada no tiene nada que rechazar. Se conserva
    // el comportamiento de antes: si no hay raíces, pasan todas.
    let roots = document_root_op_ids(tagged_html).unwrap_or_default();
    let mut r = RejectResult::default();
    if roots.is_empty() {
        r.kept = (0..targets.len()).collect();
        return r;
    }
    for (i, target) in targets.iter().enumerate() {
        if roots.contains(*target) {
            r.rejected.push(i);
        } else {
            r.kept.push(i);
        }
    }
    r
}

/// Un nombre de atributo que el motor pueda escribir sin romper el documento.
///
/// `data-op-id` queda fuera a propósito: es el marcador con el que esta misma
/// tanda direcciona los elementos, y dejar que una op lo reescriba rompería la
/// invariante de etiquetado a mitad de pasada.
fn is_valid_attribute_name(name: &str) -> bool {
    if name.is_empty() || name.eq_ignore_ascii_case(OP_ID_ATTR) {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
        && name.starts_with(|c: char| c.is_ascii_alphabetic() || matches!(c, '_' | ':'))
}

const GUARD_ATTR: &str = "data-ol-splice-guard";

/// ¿Este fragmento se puede empalmar sin cambiar el anidamiento de lo que viene
/// detrás?
///
/// MEDIDO el 2026-09-01. `apply_ops` aceptaba un `new_html` sin cerrar y se
/// tragaba el resto de la página, sin un solo error y con `applied_count: 1`:
///
/// ```text
/// replace(h1, "<div class=\"hero\"><h1>Nuevo</h1>")
/// → <div class="hero"><h1>Nuevo</h1><p>…</p><footer>…</footer></body>
/// ```
///
/// El `<p>` y el `<footer>` quedan DENTRO del hero. El usuario pidió cambiar un
/// titular y se le reestructuró la página entera, en silencio.
///
/// Se comprueba EMPALMANDO DE VERDAD, no contando etiquetas: el fragmento se
/// mete entre dos centinelas dentro de un anfitrión y se parsea con el árbol
/// (`kuchikiki`, html5ever). Si al salir los dos centinelas siguen siendo hijos
/// DIRECTOS del anfitrión, el fragmento ni abrió de más ni cerró de más. Si el
/// segundo cae más adentro, el fragmento dejó algo abierto; si cae fuera, cerró
/// algo que no era suyo.
///
/// Con el parser de árbol y NO contando aperturas y cierres a mano, porque HTML
/// cierra solo: `<p>hola` sin cerrar no reestructura nada cuando le sigue un
/// bloque, y un contador lo rechazaría. El árbol aplica las mismas reglas que
/// aplicará el navegador, así que rechaza lo que de verdad rompe.
pub fn fragment_preserves_nesting(fragment: &str) -> bool {
    let probe = format!(
        "<div {a}=\"host\"><div {a}=\"a\"></div>{f}<div {a}=\"b\"></div></div>",
        a = GUARD_ATTR,
        f = fragment
    );
    let doc = kuchikiki::parse_html().one(probe.as_str());

    // Exactamente un anfitrión y un centinela de cada. Si el fragmento trae sus
    // propios `data-ol-splice-guard`, la cuenta se va y se rechaza — que es lo
    // correcto: nadie escribe ese atributo por accidente.
    let mut host: Option<NodeRef> = None;
    let mut n_host = 0usize;
    let mut n_a = 0usize;
    let mut n_b = 0usize;
    for node in doc.inclusive_descendants() {
        let marca = {
            let Some(el) = node.as_element() else {
                continue;
            };
            let attrs = el.attributes.borrow();
            attrs.get(GUARD_ATTR).map(|s| s.to_string())
        };
        match marca.as_deref() {
            Some("host") => {
                n_host += 1;
                host = Some(node.clone());
            }
            Some("a") => n_a += 1,
            Some("b") => n_b += 1,
            _ => {}
        }
    }
    if n_host != 1 || n_a != 1 || n_b != 1 {
        return false;
    }
    let Some(host) = host else { return false };

    let mut hijo_a = false;
    let mut hijo_b = false;
    for child in host.children() {
        let Some(el) = child.as_element() else {
            continue;
        };
        match el.attributes.borrow().get(GUARD_ATTR) {
            Some("a") => hijo_a = true,
            Some("b") => hijo_b = true,
            _ => {}
        }
    }
    hijo_a && hijo_b
}

/// Un `delete` que se lleva por delante el objetivo de OTRA op de la misma
/// tanda.
///
/// Devuelve `(índice de la op huérfana, su objetivo, el ancestro borrado)`.
///
/// Antes esto era un aviso de la fase 2 —«cascade»— que no abortaba nada: la op
/// huérfana se perdía, el HTML salía a medias y `applied_count` mentía. Pero una
/// tanda así no es una tanda válida: el modelo pidió borrar una sección Y editar
/// algo de dentro, es decir, se contradijo. Aplicar la mitad deja al usuario con
/// un resultado que no pidió nadie.
/// Elementos que no tienen contenido: pedirles texto no significa nada.
const VACIOS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// Los objetivos de op de texto que NO pueden recibirla, con el motivo que se
/// le devuelve al modelo. Una sola pasada por el DOM, y solo si hay ops de
/// texto en la tanda.
fn text_targets_invalidos(tagged_html: &str, ops: &[Op]) -> Vec<(usize, String, String)> {
    let objetivos: HashSet<&str> = ops
        .iter()
        .filter(|o| o.op_type == OpType::Text)
        .map(|o| o.target.as_str())
        .collect();
    if objetivos.is_empty() {
        return Vec::new();
    }

    let doc = kuchikiki::parse_html().one(tagged_html);
    let mut por_id: HashMap<String, NodeRef> = HashMap::new();
    for node in doc.inclusive_descendants() {
        let id = {
            let Some(el) = node.as_element() else {
                continue;
            };
            let attrs = el.attributes.borrow();
            attrs.get(OP_ID_ATTR).map(|s| s.to_string())
        };
        if let Some(id) = id {
            if objetivos.contains(id.as_str()) {
                por_id.entry(id).or_insert_with(|| node.clone());
            }
        }
    }

    let mut malos = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        if op.op_type != OpType::Text {
            continue;
        }
        let Some(node) = por_id.get(&op.target) else {
            continue;
        };
        let nombre = node
            .as_element()
            .map(|e| e.name.local.to_string())
            .unwrap_or_default();
        if VACIOS.contains(&nombre.as_str()) {
            malos.push((
                i,
                op.target.clone(),
                format!(
                    "<{}> no tiene contenido: no hay texto que cambiar. Si querias cambiar una imagen o un enlace, eso es op=\"attrs\" sobre src o href.",
                    nombre
                ),
            ));
            continue;
        }
        let hijos: Vec<String> = node
            .children()
            .filter_map(|h| {
                let el = h.as_element()?;
                let attrs = el.attributes.borrow();
                attrs.get(OP_ID_ATTR).map(|s| s.to_string())
            })
            .collect();
        if !hijos.is_empty() {
            malos.push((
                i,
                op.target.clone(),
                format!(
                    "<{}> tiene {} hijo(s) elemento: poner texto aqui los borraria. Apunta al hijo que de verdad lleva el texto — sus ids son: {}.",
                    nombre,
                    hijos.len(),
                    hijos.join(", ")
                ),
            ));
        }
    }
    malos
}

fn deleted_ancestor_conflicts(tagged_html: &str, ops: &[Op]) -> Vec<(usize, String, String)> {
    let borrados: HashSet<&str> = ops
        .iter()
        .filter(|o| o.op_type == OpType::Delete)
        .map(|o| o.target.as_str())
        .collect();
    if borrados.is_empty() {
        return Vec::new();
    }

    let doc = kuchikiki::parse_html().one(tagged_html);
    let mut por_id: HashMap<String, NodeRef> = HashMap::new();
    for node in doc.inclusive_descendants() {
        let id = {
            let Some(el) = node.as_element() else {
                continue;
            };
            let attrs = el.attributes.borrow();
            attrs.get(OP_ID_ATTR).map(|s| s.to_string())
        };
        if let Some(id) = id {
            por_id.entry(id).or_insert_with(|| node.clone());
        }
    }

    let mut conflictos = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let Some(node) = por_id.get(&op.target) else {
            continue;
        };
        for ancestro in node.ancestors() {
            let id = {
                let Some(el) = ancestro.as_element() else {
                    continue;
                };
                let attrs = el.attributes.borrow();
                attrs.get(OP_ID_ATTR).map(|s| s.to_string())
            };
            let Some(id) = id else { continue };
            if borrados.contains(id.as_str()) {
                conflictos.push((i, op.target.clone(), id));
                break;
            }
        }
    }
    conflictos
}
