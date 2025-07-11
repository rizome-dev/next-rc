# Multi-stage build for next-rc runtime controller

# Stage 1: Rust builder
FROM rust:1.75-slim as rust-builder

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    libbpf-dev \
    libclang-dev \
    llvm-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy Rust workspace files
COPY Cargo.toml Cargo.lock ./
COPY runtimes/ ./runtimes/

# Build Rust components
RUN cd runtimes/wasm && cargo build --release
RUN cd runtimes/ebpf && cargo build --release
RUN cd runtimes/python && cargo build --release
RUN cd runtimes/napi-bridge && cargo build --release

# Stage 2: Node.js builder
FROM node:18-slim as node-builder

RUN npm install -g pnpm@8

WORKDIR /build

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY tsconfig.json ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy built Rust artifacts
COPY --from=rust-builder /build/runtimes/napi-bridge/target/release/*.node ./runtimes/napi-bridge/
COPY --from=rust-builder /build/runtimes/wasm/target/release/libwasm_runtime.so ./runtimes/wasm/
COPY --from=rust-builder /build/runtimes/ebpf/target/release/libebpf_runtime.so ./runtimes/ebpf/
COPY --from=rust-builder /build/runtimes/python/target/release/libpython_runtime.so ./runtimes/python/

# Build TypeScript packages
RUN pnpm build

# Stage 3: Runtime image
FROM node:18-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libbpf0 \
    python3 \
    python3-pip \
    python3-numpy \
    python3-sklearn \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash runtime

WORKDIR /app

# Copy built artifacts
COPY --from=node-builder /build/packages/*/dist ./packages/
COPY --from=node-builder /build/node_modules ./node_modules
COPY --from=rust-builder /build/runtimes/*/target/release/*.so /usr/local/lib/
COPY --from=rust-builder /build/runtimes/napi-bridge/target/release/*.node ./runtimes/

# Set up environment
ENV NODE_ENV=production
ENV RUNTIME_CONTROLLER_TYPE=hybrid
ENV LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH

# Switch to non-root user
USER runtime

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('@rizome/next-rc-core').RuntimeController.getInstance().getMetrics()"

# Default command
CMD ["node", "-e", "require('@rizome/next-rc-core').startServer()"]