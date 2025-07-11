use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

pub mod errors;
pub mod memory;
pub mod security;

pub use errors::*;
pub use memory::*;
pub use security::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ModuleId(pub Uuid);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct InstanceId(pub Uuid);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    pub timeout: Duration,
    pub memory_limit: usize,
    pub permissions: Permissions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: Option<Vec<u8>>,
    pub error: Option<String>,
    pub execution_time: Duration,
    pub memory_used: usize,
}

#[async_trait]
pub trait Runtime: Send + Sync {
    async fn compile(&self, code: &[u8], language: Language) -> Result<ModuleId>;
    async fn instantiate(&self, module_id: ModuleId) -> Result<InstanceId>;
    async fn execute(&self, instance_id: InstanceId, config: ExecutionConfig) -> Result<ExecutionResult>;
    async fn destroy(&self, instance_id: InstanceId) -> Result<()>;
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Language {
    Rust,
    JavaScript,
    TypeScript,
    Python,
    Go,
    C,
    Cpp,
    Wasm,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuntimeType {
    Wasm,
    Ebpf,
    V8Isolate,
    Firecracker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeMetrics {
    pub cold_start_latency: Duration,
    pub memory_overhead: usize,
    pub execution_overhead_percent: f32,
}