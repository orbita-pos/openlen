#[cfg(feature = "napi-bindings")]
extern crate napi_build;

fn main() {
    #[cfg(feature = "napi-bindings")]
    napi_build::setup();
}
