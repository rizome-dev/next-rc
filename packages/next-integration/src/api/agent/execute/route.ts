import { NextRequest, NextResponse } from 'next/server';
import { RuntimeController, Language, TrustLevel, Capability } from '@rizome/next-rc-core';
import { getRuntimeConfig } from '../../../config';

export const runtime = 'nodejs'; // Use Node.js runtime for full capabilities

const controller = RuntimeController.getInstance(getRuntimeConfig());

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const {
      code,
      language = Language.JavaScript,
      permissions = {},
      timeout = 30000,
      memory = 128 * 1024 * 1024,
      hints = {},
    } = body;

    // Validate input
    if (!code) {
      return NextResponse.json(
        { error: 'Code is required' },
        { status: 400 }
      );
    }

    // Get trust level from headers or use default
    const trustLevel = request.headers.get('X-Trust-Level') as TrustLevel || TrustLevel.Low;

    // Create execution config
    const config = {
      timeout,
      memoryLimit: memory,
      permissions: {
        capabilities: new Set<Capability>(permissions.capabilities || []),
        trustLevel,
      },
    };

    // Get latency requirement from headers
    const latencyRequirement = request.headers.get('X-Latency-SLA') as any;
    if (latencyRequirement) {
      hints.latencyRequirement = latencyRequirement;
    }

    // Execute with scheduler
    const result = await controller.executeWithScheduler(
      code,
      language,
      config,
      hints
    );

    // Add execution metadata to response headers
    const response = NextResponse.json({
      success: result.success,
      output: result.output,
      error: result.error,
      executionTime: result.executionTime,
      memoryUsed: result.memoryUsed,
    });

    response.headers.set('X-Runtime-Used', result.runtime);
    response.headers.set('X-Execution-Time', result.executionTime.toString());
    response.headers.set('X-Memory-Used', result.memoryUsed.toString());

    return response;
  } catch (error: any) {
    console.error('Execution error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Trust-Level, X-Latency-SLA',
    },
  });
}