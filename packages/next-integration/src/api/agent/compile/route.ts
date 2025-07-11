import { NextRequest, NextResponse } from 'next/server';
import { RuntimeController, Language } from '@rizome/next-rc-core';
import { getRuntimeConfig } from '../../../config';

export const runtime = 'nodejs';

const controller = RuntimeController.getInstance(getRuntimeConfig());

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, language = Language.JavaScript } = body;

    if (!code) {
      return NextResponse.json(
        { error: 'Code is required' },
        { status: 400 }
      );
    }

    // Compile the code
    const moduleId = await controller.compile(code, language);

    return NextResponse.json({
      success: true,
      moduleId: moduleId.id,
    });
  } catch (error: any) {
    console.error('Compilation error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Compilation failed',
      },
      { status: 500 }
    );
  }
}