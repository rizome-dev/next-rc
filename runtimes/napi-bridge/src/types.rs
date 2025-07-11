use napi_derive::napi;
use serde::{Deserialize, Serialize};

/// Language enum for runtime selection
#[napi]
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

impl From<Language> for next_rc_shared::Language {
    fn from(lang: Language) -> Self {
        match lang {
            Language::Rust => next_rc_shared::Language::Rust,
            Language::JavaScript => next_rc_shared::Language::JavaScript,
            Language::TypeScript => next_rc_shared::Language::TypeScript,
            Language::Python => next_rc_shared::Language::Python,
            Language::Go => next_rc_shared::Language::Go,
            Language::C => next_rc_shared::Language::C,
            Language::Cpp => next_rc_shared::Language::Cpp,
            Language::Wasm => next_rc_shared::Language::Wasm,
        }
    }
}

/// Trust level for security
#[napi]
pub enum TrustLevel {
    Low,
    Medium,
    High,
}

impl From<TrustLevel> for next_rc_shared::TrustLevel {
    fn from(trust: TrustLevel) -> Self {
        match trust {
            TrustLevel::Low => next_rc_shared::TrustLevel::Low,
            TrustLevel::Medium => next_rc_shared::TrustLevel::Medium,
            TrustLevel::High => next_rc_shared::TrustLevel::High,
        }
    }
}

/// Module identifier
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleId {
    pub id: String,
}

/// Instance identifier
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceId {
    pub id: String,
}

/// Execution configuration
#[napi(object)]
pub struct ExecutionConfig {
    pub timeout_ms: i64,
    pub memory_limit_bytes: i64,
    pub trust_level: TrustLevel,
    pub network_access: bool,
    pub filesystem_access: bool,
}

/// Execution result
#[napi(object)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub execution_time_ms: i64,
    pub memory_used_bytes: i64,
    pub exit_code: Option<i32>,
}

/// Runtime status
#[napi(object)]
pub struct RuntimeStatus {
    pub runtime_type: String,
    pub initialized: bool,
    pub active_instances: i32,
    pub total_executions: i64,
    pub successful_executions: i64,
    pub failed_executions: i64,
    pub avg_execution_time_ms: f64,
}

/// Workload hint for intelligent scheduling
#[napi(object)]
pub struct WorkloadHint {
    pub expected_duration_ms: Option<i64>,
    pub latency_requirement: String, // "ultra-low", "low", "normal", "relaxed"
    pub complexity: String, // "simple", "moderate", "complex"
    pub cpu_intensive: bool,
    pub memory_intensive: bool,
}

/// Scheduling decision
#[napi(object)]
pub struct SchedulingDecision {
    pub runtime_type: String,
    pub reasoning: String,
    pub confidence: f64, // 0.0 to 1.0
}

/// Runtime performance metrics
#[napi(object)]
pub struct RuntimeMetrics {
    pub runtime_type: String,
    pub cold_start_latency_ns: i64,
    pub memory_overhead_bytes: i64,
    pub execution_overhead_percent: f64,
    pub active_instances: i32,
}