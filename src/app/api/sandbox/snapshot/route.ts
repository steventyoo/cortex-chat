import { NextResponse } from 'next/server';
import { createAnalysisSnapshot } from '@/lib/sandbox';

export async function POST() {
  try {
    const snapshotId = await createAnalysisSnapshot();
    return NextResponse.json({
      success: true,
      snapshotId,
      instruction: 'Set SANDBOX_SNAPSHOT_ID=' + snapshotId + ' in your environment variables.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
