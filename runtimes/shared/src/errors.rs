use thiserror::Error;

#[derive(Error, Debug)]
pub enum RuntimeError {
    #[error("Compilation failed: {0}")]
    CompilationError(String),
    
    #[error("Instantiation failed: {0}")]
    InstantiationError(String),
    
    #[error("Execution failed: {0}")]
    ExecutionError(String),
    
    #[error("Memory allocation failed: {0}")]
    MemoryError(String),
    
    #[error("Security violation: {0}")]
    SecurityError(String),
    
    #[error("Timeout exceeded")]
    TimeoutError,
    
    #[error("Module not found: {0}")]
    ModuleNotFound(String),
    
    #[error("Instance not found: {0}")]
    InstanceNotFound(String),
    
    #[error("Invalid language: {0}")]
    InvalidLanguage(String),
    
    #[error("Resource limit exceeded: {0}")]
    ResourceLimitExceeded(String),
    
    #[error("Internal error: {0}")]
    InternalError(String),
}