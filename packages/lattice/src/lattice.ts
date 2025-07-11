import { NatsConnection, connect, StringCodec, Subscription } from 'nats';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { LatticeNode } from './lattice-node';
import { ActorMessage, NodeStatus, LatticeConfig } from './types';

export class Lattice extends EventEmitter {
  private natsClient?: NatsConnection;
  private nodes: Map<string, LatticeNode> = new Map();
  private nodeId: string;
  private config: LatticeConfig;
  private subscriptions: Subscription[] = [];
  private codec = StringCodec();
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private discoveryInterval?: ReturnType<typeof setInterval>;

  constructor(config: LatticeConfig) {
    super();
    this.nodeId = config.nodeId || uuidv4();
    this.config = {
      ...config,
      nodeId: this.nodeId,
    };
  }

  async connect(): Promise<void> {
    console.log(`Connecting lattice node ${this.nodeId} to NATS...`);
    
    try {
      this.natsClient = await connect({
        servers: this.config.natsUrl,
        name: `next-rc-lattice-${this.nodeId}`,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 1000,
      });

      console.log(`Lattice node ${this.nodeId} connected to NATS`);

      // Set up subscriptions
      await this.setupSubscriptions();

      // Start heartbeat
      this.startHeartbeat();

      // Start node discovery
      this.startNodeDiscovery();

      // Announce our presence
      await this.announceNode();

      this.emit('connected', { nodeId: this.nodeId });
    } catch (error) {
      console.error('Failed to connect to NATS:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    console.log(`Disconnecting lattice node ${this.nodeId}...`);

    // Stop intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

    // Announce departure
    if (this.natsClient && !this.natsClient.isClosed()) {
      await this.publish('lattice.node.departed', {
        nodeId: this.nodeId,
        timestamp: Date.now(),
      });
    }

    // Unsubscribe from all
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }

    // Close NATS connection
    if (this.natsClient) {
      await this.natsClient.drain();
      await this.natsClient.close();
    }

    this.nodes.clear();
    this.emit('disconnected', { nodeId: this.nodeId });
  }

  private async setupSubscriptions(): Promise<void> {
    if (!this.natsClient) throw new Error('NATS client not connected');

    // Subscribe to node announcements
    const nodeAnnounceSub = this.natsClient.subscribe('lattice.node.announce');
    this.handleSubscription(nodeAnnounceSub, this.handleNodeAnnouncement.bind(this));

    // Subscribe to node departures
    const nodeDepartSub = this.natsClient.subscribe('lattice.node.departed');
    this.handleSubscription(nodeDepartSub, this.handleNodeDeparture.bind(this));

    // Subscribe to heartbeats
    const heartbeatSub = this.natsClient.subscribe('lattice.node.heartbeat.*');
    this.handleSubscription(heartbeatSub, this.handleHeartbeat.bind(this));

    // Subscribe to actor messages for this node
    const actorSub = this.natsClient.subscribe(`lattice.actor.${this.nodeId}.*`);
    this.handleSubscription(actorSub, this.handleActorMessage.bind(this));

    // Subscribe to broadcast messages
    const broadcastSub = this.natsClient.subscribe('lattice.broadcast.*');
    this.handleSubscription(broadcastSub, this.handleBroadcast.bind(this));

    this.subscriptions.push(nodeAnnounceSub, nodeDepartSub, heartbeatSub, actorSub, broadcastSub);
  }

  private async handleSubscription(
    subscription: Subscription,
    handler: (subject: string, data: any) => void
  ): Promise<void> {
    for await (const msg of subscription) {
      try {
        const data = JSON.parse(this.codec.decode(msg.data));
        handler(msg.subject, data);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    }
  }

  private async handleNodeAnnouncement(_subject: string, data: any): Promise<void> {
    if (data.nodeId === this.nodeId) return; // Ignore our own announcements

    const node = new LatticeNode({
      id: data.nodeId,
      address: data.address,
      capabilities: data.capabilities,
      status: 'active' as NodeStatus,
      lastSeen: Date.now(),
    });

    this.nodes.set(data.nodeId, node);
    this.emit('node-joined', { nodeId: data.nodeId, node });

    console.log(`Node ${data.nodeId} joined the lattice`);
  }

  private async handleNodeDeparture(_subject: string, data: any): Promise<void> {
    if (data.nodeId === this.nodeId) return;

    this.nodes.delete(data.nodeId);
    this.emit('node-left', { nodeId: data.nodeId });

    console.log(`Node ${data.nodeId} left the lattice`);
  }

  private async handleHeartbeat(subject: string, data: any): Promise<void> {
    const nodeId = subject.split('.').pop();
    if (!nodeId || nodeId === this.nodeId) return;

    const node = this.nodes.get(nodeId);
    if (node) {
      node.updateLastSeen();
      node.updateLoad(data.load);
    }
  }

  private async handleActorMessage(_subject: string, data: ActorMessage): Promise<void> {
    this.emit('actor-message', data);
  }

  private async handleBroadcast(subject: string, data: any): Promise<void> {
    const type = subject.split('.').pop();
    this.emit(`broadcast-${type}`, data);
  }

  async routeMessage(msg: ActorMessage): Promise<void> {
    if (!this.natsClient || this.natsClient.isClosed()) {
      throw new Error('NATS client not connected');
    }

    // Check if target is local
    if (msg.targetNode === this.nodeId) {
      // Handle locally
      this.emit('actor-message', msg);
      return;
    }

    // Check if target node exists
    if (msg.targetNode && !this.nodes.has(msg.targetNode)) {
      throw new Error(`Target node ${msg.targetNode} not found in lattice`);
    }

    // Route to specific node or find best node
    const targetNode = msg.targetNode || this.findBestNode(msg);
    
    await this.publish(`lattice.actor.${targetNode}.${msg.actorId}`, msg);
  }

  private findBestNode(_msg: ActorMessage): string {
    // Simple load balancing - find node with lowest load
    let bestNode = this.nodeId;
    let lowestLoad = Infinity;

    for (const [nodeId, node] of this.nodes) {
      const load = node.getLoad();
      if (load < lowestLoad) {
        lowestLoad = load;
        bestNode = nodeId;
      }
    }

    return bestNode;
  }

  async broadcast(type: string, data: any): Promise<void> {
    await this.publish(`lattice.broadcast.${type}`, data);
  }

  private async publish(subject: string, data: any): Promise<void> {
    if (!this.natsClient || this.natsClient.isClosed()) {
      throw new Error('NATS client not connected');
    }

    const encoded = this.codec.encode(JSON.stringify(data));
    await this.natsClient.publish(subject, encoded);
  }

  private async announceNode(): Promise<void> {
    await this.publish('lattice.node.announce', {
      nodeId: this.nodeId,
      address: this.config.address || 'unknown',
      capabilities: this.config.capabilities || [],
      timestamp: Date.now(),
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const load = this.calculateNodeLoad();
        await this.publish(`lattice.node.heartbeat.${this.nodeId}`, {
          nodeId: this.nodeId,
          load,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error('Failed to send heartbeat:', error);
      }
    }, this.config.heartbeatInterval || 5000);
  }

  private startNodeDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      // Remove stale nodes
      const staleThreshold = Date.now() - (this.config.nodeTimeout || 30000);
      
      for (const [nodeId, node] of this.nodes) {
        if (node.getLastSeen() < staleThreshold) {
          this.nodes.delete(nodeId);
          this.emit('node-timeout', { nodeId });
          console.log(`Node ${nodeId} timed out`);
        }
      }
    }, this.config.discoveryInterval || 10000);
  }

  private calculateNodeLoad(): number {
    // Simple load calculation - can be enhanced
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    // Normalize to 0-1
    const cpuLoad = (cpuUsage.user + cpuUsage.system) / 1000000000; // Convert to seconds
    const memLoad = memUsage.heapUsed / memUsage.heapTotal;
    
    return (cpuLoad + memLoad) / 2;
  }

  getNodes(): Map<string, LatticeNode> {
    return new Map(this.nodes);
  }

  getNodeId(): string {
    return this.nodeId;
  }

  isConnected(): boolean {
    return this.natsClient ? !this.natsClient.isClosed() : false;
  }

  getMetrics() {
    return {
      nodeId: this.nodeId,
      connected: this.isConnected(),
      totalNodes: this.nodes.size + 1, // Include self
      activeNodes: Array.from(this.nodes.values()).filter(n => n.isActive()).length + 1,
      subscriptions: this.subscriptions.length,
    };
  }
}