pub mod runtime;
#[cfg(feature = "pyo3")]
pub mod pyo3_runtime;
#[cfg(feature = "wasm")]
pub mod wasm_runtime;
pub mod scheduler;
pub mod security;
pub mod agent_integration;

pub use runtime::PythonRuntimeController;
#[cfg(feature = "pyo3")]
pub use pyo3_runtime::PyO3Runtime;
#[cfg(feature = "wasm")]
pub use wasm_runtime::WasmPythonRuntime;
pub use scheduler::PythonScheduler;
pub use agent_integration::SmolAgentsRunner;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonExecutionRequest {
    pub id: Uuid,
    pub code: String,
    pub runtime_hint: Option<PythonRuntimeType>,
    pub trust_level: TrustLevel,
    pub timeout_ms: u64,
    pub memory_limit_mb: u64,
    pub environment: HashMap<String, String>,
    pub requirements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PythonRuntimeType {
    PyO3,        // High-performance native execution
    Wasm,        // Sandboxed WASM execution
    Hybrid,      // Intelligent scheduling
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TrustLevel {
    Low,         // Full sandbox, WASM only
    Medium,      // Restricted PyO3 with seccomp
    High,        // Full PyO3 performance
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonExecutionResult {
    pub id: Uuid,
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub runtime_used: PythonRuntimeType,
    pub execution_time_ms: u64,
    pub memory_used_mb: u64,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkflowRequest {
    pub id: Uuid,
    pub agent_code: String,
    pub input_data: serde_json::Value,
    pub model_config: ModelConfig,
    pub tools: Vec<String>,
    pub max_iterations: u32,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub model_name: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWorkflowResult {
    pub id: Uuid,
    pub success: bool,
    pub final_output: serde_json::Value,
    pub intermediate_steps: Vec<AgentStep>,
    pub execution_time_ms: u64,
    pub tokens_used: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub step_id: u32,
    pub tool_used: String,
    pub input: serde_json::Value,
    pub output: serde_json::Value,
    pub timestamp: u64,
}

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;