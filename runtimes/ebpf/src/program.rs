use anyhow::{anyhow, Result};
use goblin::elf::Elf;
use next_rc_shared::ModuleId;
use parking_lot::RwLock;
// use rbpf::ebpf; // Unused
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone)]
pub struct EbpfProgram {
    pub id: ModuleId,
    pub bytecode: Vec<u8>,
    pub prog_type: ProgramType,
    pub metadata: ProgramMetadata,
}

#[derive(Clone, Debug)]
pub struct ProgramMetadata {
    pub name: String,
    pub section: String,
    pub license: Option<String>,
    pub maps: Vec<MapDefinition>,
}

#[derive(Clone, Debug)]
pub struct MapDefinition {
    pub name: String,
    pub map_type: MapType,
    pub key_size: u32,
    pub value_size: u32,
    pub max_entries: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramType {
    Filter,
    XdpAction,
    SocketFilter,
    TracePoint,
    KProbe,
    UProbe,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapType {
    Hash,
    Array,
    ProgArray,
    PercpuHash,
    PercpuArray,
    LruHash,
    LpmTrie,
}

impl EbpfProgram {
    pub fn from_elf(elf_bytes: &[u8], section: &str) -> Result<Self> {
        let elf = Elf::parse(elf_bytes)?;
        
        // Find the requested section
        let section_header = elf.section_headers
            .iter()
            .find(|sh| {
                elf.shdr_strtab.get_at(sh.sh_name)
                    .map(|name| name == section)
                    .unwrap_or(false)
            })
            .ok_or_else(|| anyhow!("Section {} not found", section))?;
        
        let start = section_header.sh_offset as usize;
        let end = start + section_header.sh_size as usize;
        
        if end > elf_bytes.len() {
            return Err(anyhow!("Invalid section bounds"));
        }
        
        let bytecode = elf_bytes[start..end].to_vec();
        
        // Determine program type from section name
        let prog_type = Self::determine_program_type(section);
        
        // Extract metadata
        let metadata = Self::extract_metadata(&elf, section)?;
        
        Ok(Self {
            id: ModuleId(uuid::Uuid::new_v4()),
            bytecode,
            prog_type,
            metadata,
        })
    }
    
    pub fn from_bytecode(bytecode: Vec<u8>, prog_type: ProgramType) -> Self {
        Self {
            id: ModuleId(uuid::Uuid::new_v4()),
            bytecode,
            prog_type,
            metadata: ProgramMetadata {
                name: "inline".to_string(),
                section: "inline".to_string(),
                license: None,
                maps: vec![],
            },
        }
    }
    
    fn determine_program_type(section: &str) -> ProgramType {
        match section {
            s if s.starts_with("filter/") => ProgramType::Filter,
            s if s.starts_with("xdp/") => ProgramType::XdpAction,
            s if s.starts_with("socket/") => ProgramType::SocketFilter,
            s if s.starts_with("tracepoint/") => ProgramType::TracePoint,
            s if s.starts_with("kprobe/") => ProgramType::KProbe,
            s if s.starts_with("uprobe/") => ProgramType::UProbe,
            _ => ProgramType::Filter,
        }
    }
    
    fn extract_metadata(elf: &Elf, section: &str) -> Result<ProgramMetadata> {
        // Extract license from .license section
        let license = elf.section_headers
            .iter()
            .find(|sh| {
                elf.shdr_strtab.get_at(sh.sh_name)
                    .map(|name| name == ".license")
                    .unwrap_or(false)
            })
            .and_then(|sh| {
                // TODO: Fix section data access with correct goblin API
                let _ = sh;
                None as Option<&str>
            })
            .map(|s| s.trim_end_matches('\0').to_string());
        
        // TODO: Extract map definitions from .maps section
        let maps = vec![];
        
        Ok(ProgramMetadata {
            name: section.split('/').last().unwrap_or("unknown").to_string(),
            section: section.to_string(),
            license,
            maps,
        })
    }
}

pub struct ProgramCache {
    programs: RwLock<HashMap<ModuleId, Arc<EbpfProgram>>>,
}

impl ProgramCache {
    pub fn new() -> Self {
        Self {
            programs: RwLock::new(HashMap::new()),
        }
    }
    
    pub fn insert(&self, program: EbpfProgram) -> ModuleId {
        let id = program.id.clone();
        let mut cache = self.programs.write();
        cache.insert(id.clone(), Arc::new(program));
        id
    }
    
    pub fn get(&self, id: &ModuleId) -> Option<Arc<EbpfProgram>> {
        let cache = self.programs.read();
        cache.get(id).cloned()
    }
    
    pub fn remove(&self, id: &ModuleId) -> Option<Arc<EbpfProgram>> {
        let mut cache = self.programs.write();
        cache.remove(id)
    }
}

// Helper to create simple filter programs
pub fn create_simple_filter(_filter_fn: impl Fn(&[u8]) -> bool) -> Vec<u8> {
    // This would generate actual eBPF bytecode in a real implementation
    // For now, we'll use a placeholder
    vec![
        // BPF_MOV64_REG(BPF_REG_6, BPF_REG_1)
        0xbf, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // BPF_MOV64_IMM(BPF_REG_0, 1) - Accept packet
        0xb7, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        // BPF_EXIT_INSN()
        0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]
}