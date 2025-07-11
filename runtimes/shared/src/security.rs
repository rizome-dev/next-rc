use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permissions {
    pub capabilities: HashSet<Capability>,
    pub trust_level: TrustLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Capability {
    NetworkAccess,
    FileSystemRead,
    FileSystemWrite,
    ProcessSpawn,
    SystemTime,
    EnvironmentVariables,
    SharedMemory,
    CpuIntensive,
    GpuAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TrustLevel {
    Low,      // Free tier - maximum isolation
    Medium,   // Standard tier
    High,     // Enterprise tier - trusted workloads
}

impl Default for TrustLevel {
    fn default() -> Self {
        TrustLevel::Low
    }
}

impl Permissions {
    pub fn new(trust_level: TrustLevel) -> Self {
        let capabilities = match trust_level {
            TrustLevel::Low => HashSet::new(),
            TrustLevel::Medium => {
                let mut caps = HashSet::new();
                caps.insert(Capability::SystemTime);
                caps.insert(Capability::FileSystemRead);
                caps
            }
            TrustLevel::High => {
                let mut caps = HashSet::new();
                caps.insert(Capability::NetworkAccess);
                caps.insert(Capability::FileSystemRead);
                caps.insert(Capability::FileSystemWrite);
                caps.insert(Capability::SystemTime);
                caps.insert(Capability::EnvironmentVariables);
                caps.insert(Capability::SharedMemory);
                caps
            }
        };
        
        Self {
            capabilities,
            trust_level,
        }
    }
    
    pub fn has_capability(&self, capability: Capability) -> bool {
        self.capabilities.contains(&capability)
    }
}