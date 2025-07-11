import { NodeInfo, NodeStatus } from './types';

export class LatticeNode {
  private info: NodeInfo;
  private load: number = 0;

  constructor(info: NodeInfo) {
    this.info = info;
  }

  getId(): string {
    return this.info.id;
  }

  getAddress(): string {
    return this.info.address;
  }

  getCapabilities(): string[] {
    return this.info.capabilities;
  }

  getStatus(): NodeStatus {
    return this.info.status;
  }

  getLastSeen(): number {
    return this.info.lastSeen;
  }

  getLoad(): number {
    return this.load;
  }

  updateLastSeen(): void {
    this.info.lastSeen = Date.now();
  }

  updateStatus(status: NodeStatus): void {
    this.info.status = status;
  }

  updateLoad(load: number): void {
    this.load = load;
  }

  isActive(): boolean {
    return this.info.status === 'active';
  }

  hasCapability(capability: string): boolean {
    return this.info.capabilities.includes(capability);
  }

  toJSON(): NodeInfo {
    return {
      ...this.info,
      load: this.load,
    };
  }
}