import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import PQueue from 'p-queue';
import { ActorMessage, ActorDefinition } from './types';
import { Lattice } from './lattice';

interface ActorInstance {
  id: string;
  definition: ActorDefinition;
  state: 'idle' | 'busy' | 'error';
  lastActivity: number;
  executionCount: number;
  nodeId: string;
}

export class ActorScheduler extends EventEmitter {
  private actors: Map<string, ActorInstance> = new Map();
  private messageQueue: PQueue;
  private lattice: Lattice;
  private nodeId: string;

  constructor(lattice: Lattice, concurrency: number = 10) {
    super();
    this.lattice = lattice;
    this.nodeId = lattice.getNodeId();
    this.messageQueue = new PQueue({ concurrency });

    // Listen for actor messages from the lattice
    this.lattice.on('actor-message', this.handleIncomingMessage.bind(this));
  }

  async registerActor(definition: ActorDefinition): Promise<string> {
    const actorId = definition.id || uuidv4();
    
    const instance: ActorInstance = {
      id: actorId,
      definition,
      state: 'idle',
      lastActivity: Date.now(),
      executionCount: 0,
      nodeId: this.nodeId,
    };

    this.actors.set(actorId, instance);
    
    console.log(`Actor ${actorId} registered on node ${this.nodeId}`);
    this.emit('actor-registered', { actorId, nodeId: this.nodeId });

    return actorId;
  }

  async unregisterActor(actorId: string): Promise<void> {
    const actor = this.actors.get(actorId);
    if (!actor) {
      throw new Error(`Actor ${actorId} not found`);
    }

    // Wait for actor to finish current work
    while (actor.state === 'busy') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.actors.delete(actorId);
    console.log(`Actor ${actorId} unregistered from node ${this.nodeId}`);
    this.emit('actor-unregistered', { actorId, nodeId: this.nodeId });
  }

  async sendMessage(
    actorId: string,
    type: string,
    payload: any,
    options?: {
      targetNode?: string;
      replyTo?: string;
      correlationId?: string;
    }
  ): Promise<string> {
    const message: ActorMessage = {
      id: uuidv4(),
      actorId,
      type,
      payload,
      sourceNode: this.nodeId,
      targetNode: options?.targetNode,
      timestamp: Date.now(),
      replyTo: options?.replyTo,
      correlationId: options?.correlationId,
    };

    // Check if actor is local
    if (this.actors.has(actorId) && !options?.targetNode) {
      await this.processMessage(message);
    } else {
      // Route through lattice
      await this.lattice.routeMessage(message);
    }

    return message.id;
  }

  async broadcast(
    type: string,
    payload: any,
    filter?: (actor: ActorInstance) => boolean
  ): Promise<void> {
    // Broadcast to local actors
    const localActors = Array.from(this.actors.values());
    const targetActors = filter ? localActors.filter(filter) : localActors;

    const promises = targetActors.map(actor =>
      this.sendMessage(actor.id, type, payload)
    );

    // Also broadcast to other nodes
    await this.lattice.broadcast('actor-broadcast', {
      type,
      payload,
      sourceNode: this.nodeId,
      timestamp: Date.now(),
    });

    await Promise.all(promises);
  }

  private async handleIncomingMessage(message: ActorMessage): Promise<void> {
    // Check if we have the target actor
    const actor = this.actors.get(message.actorId);
    if (!actor) {
      console.warn(`Actor ${message.actorId} not found on node ${this.nodeId}`);
      
      // Send error reply if replyTo is specified
      if (message.replyTo) {
        await this.sendMessage(
          message.replyTo,
          'error',
          {
            error: 'Actor not found',
            originalMessage: message,
          },
          {
            correlationId: message.correlationId,
          }
        );
      }
      return;
    }

    // Process the message
    await this.processMessage(message);
  }

  private async processMessage(message: ActorMessage): Promise<void> {
    const actor = this.actors.get(message.actorId);
    if (!actor) return;

    // Queue the message for processing
    await this.messageQueue.add(async () => {
      actor.state = 'busy';
      actor.lastActivity = Date.now();
      
      const startTime = Date.now();
      
      try {
        console.log(
          `Processing message ${message.id} for actor ${message.actorId} (type: ${message.type})`
        );

        const result = await actor.definition.handler(message);
        
        actor.executionCount++;
        actor.state = 'idle';

        const executionTime = Date.now() - startTime;
        
        this.emit('message-processed', {
          messageId: message.id,
          actorId: message.actorId,
          executionTime,
          success: true,
        });

        // Send reply if requested
        if (message.replyTo) {
          await this.sendMessage(
            message.replyTo,
            'reply',
            result,
            {
              correlationId: message.correlationId,
            }
          );
        }
      } catch (error) {
        actor.state = 'error';
        
        console.error(
          `Error processing message ${message.id} for actor ${message.actorId}:`,
          error
        );

        this.emit('message-error', {
          messageId: message.id,
          actorId: message.actorId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Send error reply if requested
        if (message.replyTo) {
          await this.sendMessage(
            message.replyTo,
            'error',
            {
              error: error instanceof Error ? error.message : String(error),
              originalMessage: message,
            },
            {
              correlationId: message.correlationId,
            }
          );
        }
        
        // Reset actor state after a delay
        setTimeout(() => {
          if (actor.state === 'error') {
            actor.state = 'idle';
          }
        }, 5000);
      }
    });
  }

  async waitForReply(
    correlationId: string,
    timeout: number = 30000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(`reply-${correlationId}`, handleReply);
        reject(new Error('Reply timeout'));
      }, timeout);

      const handleReply = (reply: any) => {
        clearTimeout(timer);
        resolve(reply);
      };

      this.once(`reply-${correlationId}`, handleReply);
    });
  }

  getActors(): ActorInstance[] {
    return Array.from(this.actors.values());
  }

  getActor(actorId: string): ActorInstance | undefined {
    return this.actors.get(actorId);
  }

  getMetrics() {
    const actors = Array.from(this.actors.values());
    
    return {
      totalActors: actors.length,
      idleActors: actors.filter(a => a.state === 'idle').length,
      busyActors: actors.filter(a => a.state === 'busy').length,
      errorActors: actors.filter(a => a.state === 'error').length,
      totalExecutions: actors.reduce((sum, a) => sum + a.executionCount, 0),
      queueSize: this.messageQueue.size,
      queuePending: this.messageQueue.pending,
    };
  }

  async shutdown(): Promise<void> {
    // Stop accepting new messages
    this.messageQueue.pause();

    // Wait for queue to empty
    await this.messageQueue.onEmpty();

    // Clear actors
    this.actors.clear();

    console.log(`Actor scheduler on node ${this.nodeId} shut down`);
  }
}