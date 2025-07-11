# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is Next.js Runtime Controller (next-rc) - a multi-runtime execution controller that safely executes untrusted code in different sandboxed environments (V8 Isolates, WebAssembly, eBPF, Python) within Next.js applications.

## Key Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev             # Run in development mode
pnpm build           # Build all packages
pnpm clean           # Clean build artifacts

# Testing
pnpm test            # Run all tests
pnpm test:coverage   # Run tests with coverage (80% threshold required)
pnpm test:watch      # Run tests in watch mode
pnpm test:e2e        # Run end-to-end tests

# Code Quality
pnpm lint            # Run ESLint
pnpm typecheck       # TypeScript type checking

# Benchmarking
pnpm benchmark       # Run all benchmarks
pnpm benchmark:smolagents  # Run smolagents comparison benchmark

# Building Rust components
cd runtimes/[component] && cargo build    # Build specific runtime
cd runtimes/[component] && cargo test     # Test specific runtime

# Testing individual runtimes (from scripts/)
./scripts/test_v8_runtime.js     # Test V8 runtime
./scripts/test_wasm_runtime.js   # Test WASM runtime
./scripts/test_ebpf_runtime.js   # Test eBPF runtime
./scripts/test_python_runtime.js # Test Python runtime

# Publishing (see NPM-PUBLISHING.md for details)
pnpm changeset       # Create a changeset for version bump
pnpm version-packages # Version packages based on changesets
pnpm release         # Build and publish to npm
```

## Architecture

This monorepo uses Turborepo and pnpm workspaces, organized into:

- **packages/** - TypeScript packages (core controller, runtime wrappers, Next.js integration)
- **runtimes/** - Rust implementations (WASM, eBPF, Python runtimes)
- **examples/** - Example Next.js applications

### Runtime Types

1. **V8 Isolates** (`packages/v8-runtime/`) - JavaScript/TypeScript execution
2. **WebAssembly** (`runtimes/wasm/`, `packages/wasm-runtime/`) - Compiled languages
3. **eBPF** (`runtimes/ebpf/`, `packages/ebpf-runtime/`) - Ultra-low latency filters
4. **Python** (`runtimes/python/`) - PyO3/WASM hybrid for ML workloads

### Core Components

- **Runtime Controller** (`packages/core/`) - Schedules and manages runtime execution
- **Lattice** (`packages/lattice/`) - Distributed computing via NATS
- **NAPI Bridge** (`runtimes/napi-bridge/`) - Node.js native bindings for Rust components
- **Types** (`packages/types/`) - Shared TypeScript type definitions
- **Next Integration** (`packages/next-integration/`) - React hooks, API routes, middleware

### Key Architectural Decisions

1. **Automatic Runtime Selection**: The scheduler picks the optimal runtime based on:
   - Language detection
   - Latency requirements
   - Resource constraints
   - Security level needed

2. **Security Model**: Capability-based permissions with multiple trust levels
   - Each runtime has different isolation guarantees
   - eBPF provides the strongest isolation
   - V8 Isolates provide JavaScript-specific sandboxing

3. **Performance Targets**:
   - eBPF: ~100ns cold start
   - WASM: <1ms cold start
   - V8: ~1-5ms cold start
   - Python: ~10-50ms cold start

## Development Patterns

When modifying the codebase:

1. **Adding Runtime Features**: Implement in Rust first (`runtimes/`), then create TypeScript wrapper (`packages/`)
2. **Testing**: Write tests for both Rust and TypeScript components. Integration tests go in `packages/tests/`
3. **Type Safety**: Use shared types from `packages/types/` across all TypeScript packages
4. **Error Handling**: Runtime errors should be caught and wrapped in standardized error types
5. **Workspace Dependencies**: Use workspace protocol for internal dependencies (e.g., `"@rizome/core": "workspace:*"`)

## Environment Variables

- `NATS_URL` - NATS server URL for lattice network (optional)
- `HF_TOKEN` - Hugging Face token for AI agent integrations (optional)

## Next.js Integration

The main integration point is `@rizome/next-rc` from `packages/next-integration/`. It provides:
- React hooks for runtime execution
- API route handlers
- Next.js configuration helpers
- Middleware for request interception

## Testing Strategy

- **Unit Tests**: Located in `__tests__/` directories within each package
- **Integration Tests**: In `packages/tests/src/integration/`
- **E2E Tests**: In `packages/tests/src/e2e/`
- **Performance Tests**: In `packages/tests/src/performance/`
- **Security Tests**: In `packages/tests/src/security/`
- **Coverage**: 80% threshold required across all packages

## Publishing Process

This project uses changesets for version management. See NPM-PUBLISHING.md for detailed instructions:

1. Create a changeset: `pnpm changeset`
2. Version packages: `pnpm version-packages`
3. Build and publish: `pnpm release`