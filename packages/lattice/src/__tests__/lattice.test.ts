import { Lattice } from '../lattice';
import { ActorScheduler } from '../actor-scheduler';
import { ActorDefinition, ActorMessage } from '../types';

// Mock NATS for testing
jest.mock('nats', () => ({
  connect: jest.fn().mockResolvedValue({
    subscribe: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        // Mock subscription
      },
      unsubscribe: jest.fn(),
    }),
    publish: jest.fn(),
    drain: jest.fn(),
    close: jest.fn(),
    isClosed: jest.fn().mockReturnValue(false),
  }),
  StringCodec: jest.fn().mockReturnValue({
    encode: (str: string) => Buffer.from(str),
    decode: (buf: Uint8Array) => Buffer.from(buf).toString(),
  }),
}));

describe('Lattice', () => {
  let lattice: Lattice;

  beforeEach(() => {
    lattice = new Lattice({
      natsUrl: 'nats://localhost:4222',
      heartbeatInterval: 1000,
      nodeTimeout: 5000,
    });
  });

  afterEach(async () => {
    if (lattice.isConnected()) {
      await lattice.disconnect();
    }
  });

  it('should connect to NATS', async () => {
    await lattice.connect();
    expect(lattice.isConnected()).toBe(true);
  });

  it('should generate unique node ID', () => {
    const nodeId = lattice.getNodeId();
    expect(nodeId).toBeTruthy();
    expect(typeof nodeId).toBe('string');
  });

  it('should route messages', async () => {
    await lattice.connect();

    const message = {
      id: 'msg-1',
      actorId: 'actor-1',
      type: 'test',
      payload: { data: 'test' },
      timestamp: Date.now(),
    };

    await expect(lattice.routeMessage(message)).resolves.not.toThrow();
  });

  it('should broadcast messages', async () => {
    await lattice.connect();

    await expect(
      lattice.broadcast('test-event', { data: 'broadcast' })
    ).resolves.not.toThrow();
  });

  it('should track metrics', async () => {
    await lattice.connect();

    const metrics = lattice.getMetrics();
    expect(metrics.nodeId).toBeTruthy();
    expect(metrics.connected).toBe(true);
    expect(metrics.totalNodes).toBeGreaterThanOrEqual(1);
  });
});

describe('ActorScheduler', () => {
  let lattice: Lattice;
  let scheduler: ActorScheduler;

  beforeEach(async () => {
    lattice = new Lattice({
      natsUrl: 'nats://localhost:4222',
    });
    await lattice.connect();
    
    scheduler = new ActorScheduler(lattice);
  });

  afterEach(async () => {
    await scheduler.shutdown();
    await lattice.disconnect();
  });

  it('should register actors', async () => {
    const actor: ActorDefinition = {
      id: 'test-actor',
      type: 'worker',
      handler: async (message: ActorMessage) => {
        return { processed: message.payload };
      },
    };

    const actorId = await scheduler.registerActor(actor);
    expect(actorId).toBe('test-actor');

    const registeredActor = scheduler.getActor(actorId);
    expect(registeredActor).toBeDefined();
    expect(registeredActor?.state).toBe('idle');
  });

  it('should send messages to actors', async () => {
    let receivedMessage: ActorMessage | null = null;

    const actor: ActorDefinition = {
      id: 'test-actor',
      type: 'worker',
      handler: async (message: ActorMessage) => {
        receivedMessage = message;
        return { success: true };
      },
    };

    await scheduler.registerActor(actor);

    const messageId = await scheduler.sendMessage(
      'test-actor',
      'process',
      { data: 'test' }
    );

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(messageId).toBeTruthy();
    expect(receivedMessage).toBeDefined();
    expect(receivedMessage?.type).toBe('process');
    expect(receivedMessage?.payload).toEqual({ data: 'test' });
  });

  it('should handle actor errors', async () => {
    const errorActor: ActorDefinition = {
      id: 'error-actor',
      type: 'worker',
      handler: async () => {
        throw new Error('Test error');
      },
    };

    await scheduler.registerActor(errorActor);

    const errorPromise = new Promise((resolve) => {
      scheduler.once('message-error', resolve);
    });

    await scheduler.sendMessage('error-actor', 'fail', {});

    const errorEvent = await errorPromise;
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).error).toBe('Test error');
  });

  it('should broadcast to multiple actors', async () => {
    const results: string[] = [];

    const createActor = (id: string): ActorDefinition => ({
      id,
      type: 'worker',
      handler: async (message: ActorMessage) => {
        results.push(`${id}-${message.type}`);
        return { processed: true };
      },
    });

    await scheduler.registerActor(createActor('actor-1'));
    await scheduler.registerActor(createActor('actor-2'));
    await scheduler.registerActor(createActor('actor-3'));

    await scheduler.broadcast('test-broadcast', { data: 'broadcast' });

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(results).toHaveLength(3);
    expect(results).toContain('actor-1-test-broadcast');
    expect(results).toContain('actor-2-test-broadcast');
    expect(results).toContain('actor-3-test-broadcast');
  });

  it('should provide actor metrics', async () => {
    await scheduler.registerActor({
      id: 'metric-actor',
      type: 'worker',
      handler: async () => ({ success: true }),
    });

    const metrics = scheduler.getMetrics();
    expect(metrics.totalActors).toBe(1);
    expect(metrics.idleActors).toBe(1);
    expect(metrics.busyActors).toBe(0);
  });

  it('should handle request-reply pattern', async () => {
    const echoActor: ActorDefinition = {
      id: 'echo-actor',
      type: 'echo',
      handler: async (message: ActorMessage) => {
        return { echo: message.payload };
      },
    };

    const replyActor: ActorDefinition = {
      id: 'reply-actor',
      type: 'receiver',
      handler: async (message: ActorMessage) => {
        if (message.type === 'reply') {
          scheduler.emit(`reply-${message.correlationId}`, message.payload);
        }
        return { received: true };
      },
    };

    await scheduler.registerActor(echoActor);
    await scheduler.registerActor(replyActor);

    const correlationId = 'corr-123';
    
    const replyPromise = scheduler.waitForReply(correlationId, 1000);
    
    await scheduler.sendMessage(
      'echo-actor',
      'ping',
      { message: 'hello' },
      {
        replyTo: 'reply-actor',
        correlationId,
      }
    );

    const reply = await replyPromise;
    expect(reply).toEqual({ echo: { message: 'hello' } });
  });
});