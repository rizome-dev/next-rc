export interface LatticeConfig {
  nodeId?: string;
  natsUrl: string;
  address?: string;
  capabilities?: string[];
  heartbeatInterval?: number;
  nodeTimeout?: number;
  discoveryInterval?: number;
}

export interface NodeInfo {
  id: string;
  address: string;
  capabilities: string[];
  status: NodeStatus;
  lastSeen: number;
  load?: number;
}

export type NodeStatus = 'active' | 'inactive' | 'draining' | 'unknown';

export interface ActorMessage {
  id: string;
  actorId: string;
  type: string;
  payload: any;
  sourceNode?: string;
  targetNode?: string;
  timestamp: number;
  replyTo?: string;
  correlationId?: string;
}

export interface ActorDefinition {
  id: string;
  type: string;
  handler: (message: ActorMessage) => Promise<any>;
  capabilities?: string[];
}

export interface LatticeEvent {
  type: string;
  nodeId: string;
  timestamp: number;
  data?: any;
}