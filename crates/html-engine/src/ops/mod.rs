pub mod apply;
pub mod id;
pub mod parse;
pub mod resolver;
pub mod scoped_view;
pub mod stripper;
pub mod tagger;

pub use apply::{apply_ops, ApplyError, ApplyResult, Op, OpType};
pub use parse::{parse_ops, ParseResult};
pub use resolver::resolve_op_id_by_path;
pub use scoped_view::{build_scoped_view, ScopedView};
pub use stripper::strip_op_ids;
pub use tagger::{tag_with_op_ids, TaggedHtmlResult};

/// The attribute we inject on every addressable element. Hard-coded across
/// the engine — the JS-side contract depends on this exact spelling.
pub const OP_ID_ATTR: &str = "data-op-id";
