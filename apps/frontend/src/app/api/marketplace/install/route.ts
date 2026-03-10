import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { skillName, componentName, namespace = 'kortix' } = await request.json();

    // Accept either skillName or componentName
    const name = skillName || componentName;

    if (!name) {
      return NextResponse.json(
        { error: 'skillName or componentName is required' },
        { status: 400 }
      );
    }

    // TODO: Execute `ocx add ${name}` on the sandbox
    // For now, we'll simulate a successful install
    // In production, this should:
    // 1. Call the sandbox/shell to execute `ocx add ${namespace}/${name}`
    // 2. Or download the component files and write them to .opencode/skills/

    console.log(`[Marketplace] Installing component: ${namespace}/${name}`);

    // Simulate successful install
    return NextResponse.json({
      success: true,
      componentName: name,
      namespace,
      message: `Component ${name} installed successfully`,
    });
  } catch (error) {
    console.error('[Marketplace] Install error:', error);
    return NextResponse.json(
      { error: 'Failed to install component' },
      { status: 500 }
    );
  }
}
