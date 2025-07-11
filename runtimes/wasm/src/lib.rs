pub mod compiler;
pub mod context;
pub mod instance;
pub mod memory_pool;
pub mod module_cache;
pub mod runtime;

pub use runtime::WasmRuntime;
pub use runtime::WasmConfig;

#[cfg(test)]
mod tests;