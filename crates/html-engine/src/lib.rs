#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

pub mod error;
pub mod parser;

use napi::Result;

#[napi]
pub fn round_trip(html: String) -> Result<String> {
    parser::round_trip(&html).map_err(Into::into)
}
