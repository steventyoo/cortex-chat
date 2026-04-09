import { Sandbox } from '@vercel/sandbox';

const EXEC_TIMEOUT = 30_000;
const MAX_HTML_SIZE = 100_000;
const MAX_STDOUT_SIZE = 50_000;

export interface AnalysisResult {
  analysis: string;
  htmlArtifact: string | null;
  error?: string;
}

export async function runAnalysis(
  code: string,
  dataContext: unknown
): Promise<AnalysisResult> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { analysis: '', htmlArtifact: null, error: 'VERCEL_TOKEN not configured' };
  }

  let sandbox: (Sandbox & AsyncDisposable) | null = null;

  try {
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;

    if (snapshotId) {
      sandbox = await Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        timeout: EXEC_TIMEOUT + 10_000,
        env: { MPLBACKEND: 'Agg' },
      });
    } else {
      sandbox = await Sandbox.create({
        runtime: 'python3.13',
        timeout: EXEC_TIMEOUT + 60_000,
        env: { MPLBACKEND: 'Agg' },
      });

      const pipResult = await sandbox.runCommand('pip', ['install', '-q', 'pandas', 'plotly', 'numpy']);
      if (pipResult.exitCode !== 0) {
        const pipStderr = await pipResult.stderr();
        return {
          analysis: '',
          htmlArtifact: null,
          error: `Failed to install packages: ${pipStderr.slice(0, 2000)}`,
        };
      }
    }

    await sandbox.writeFiles([
      { path: '/tmp/data.json', content: JSON.stringify(dataContext) },
      { path: '/tmp/analysis.py', content: code },
    ]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT);

    let result;
    try {
      result = await sandbox.runCommand('python3', ['/tmp/analysis.py'], {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const stdoutStr = await result.stdout();
    const analysis = stdoutStr.slice(0, MAX_STDOUT_SIZE);
    let htmlArtifact: string | null = null;

    try {
      const buf = await sandbox.readFileToBuffer({ path: '/tmp/output.html' });
      if (buf) {
        const html = buf.toString('utf-8');
        if (html.length > 0 && html.length <= MAX_HTML_SIZE) {
          htmlArtifact = html;
        }
      }
    } catch {
      // No HTML output is fine
    }

    if (result.exitCode !== 0) {
      const stderrStr = await result.stderr();
      return {
        analysis,
        htmlArtifact,
        error: stderrStr.slice(0, 5000),
      };
    }

    return { analysis, htmlArtifact };
  } catch (err) {
    return {
      analysis: '',
      htmlArtifact: null,
      error: `Sandbox error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        // Best effort cleanup
      }
    }
  }
}
