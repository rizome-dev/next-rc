import { NextResponse } from 'next/server';
import { RuntimeController } from '@rizome/next-rc-core';
import { getRuntimeConfig } from '../../../config';

export const runtime = 'nodejs';

const controller = RuntimeController.getInstance(getRuntimeConfig());

export async function GET() {
  try {
    const metrics = controller.getMetrics();

    return NextResponse.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Metrics error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve metrics',
      },
      { status: 500 }
    );
  }
}