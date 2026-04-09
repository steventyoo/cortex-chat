import { Sandbox } from '@vercel/sandbox';

const EXEC_TIMEOUT = 30_000;
const MAX_HTML_SIZE = 100_000;
const MAX_STDOUT_SIZE = 50_000;
const REQUIRED_PACKAGES = ['pandas', 'plotly', 'numpy'];

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  htmlArtifact: string | null;
}

/**
 * Session-scoped sandbox that persists across multiple tool calls within a single
 * chat request. This enables REPL-style reasoning: Claude can run code, inspect
 * output, fix errors, and iterate — all within the same VM.
 *
 * Lifecycle: created lazily on first run(), destroyed in the route's finally block.
 */
export class SandboxSession {
  private sandbox: (Sandbox & AsyncDisposable) | null = null;
  private creating: Promise<Sandbox & AsyncDisposable> | null = null;

  private async ensureSandbox(): Promise<Sandbox & AsyncDisposable> {
    if (this.sandbox) return this.sandbox;

    if (!this.creating) {
      this.creating = this.boot();
    }
    this.sandbox = await this.creating;
    return this.sandbox;
  }

  private async boot(): Promise<Sandbox & AsyncDisposable> {
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;

    if (snapshotId) {
      return Sandbox.create({
        source: { type: 'snapshot', snapshotId },
        timeout: EXEC_TIMEOUT + 30_000,
        networkPolicy: 'deny-all',
        env: { MPLBACKEND: 'Agg' },
      });
    }

    const sb = await Sandbox.create({
      runtime: 'python3.13',
      timeout: EXEC_TIMEOUT + 90_000,
      env: { MPLBACKEND: 'Agg' },
    });

    const pipResult = await sb.runCommand('pip', [
      'install', '-q', ...REQUIRED_PACKAGES,
    ]);
    if (pipResult.exitCode !== 0) {
      const stderr = await pipResult.stderr();
      await sb.stop({ blocking: true }).catch(() => {});
      throw new Error(`Failed to install packages: ${stderr.slice(0, 2000)}`);
    }

    await sb.updateNetworkPolicy('deny-all');
    return sb;
  }

  /**
   * Write JSON data to /tmp/data.json inside the sandbox.
   * Called as a side effect of execute_sql_analytics so Claude
   * doesn't need a dedicated "upload data" tool call.
   */
  async writeData(data: unknown): Promise<void> {
    const sb = await this.ensureSandbox();
    await sb.writeFiles([
      { path: '/tmp/data.json', content: Buffer.from(JSON.stringify(data)) },
    ]);
  }

  /**
   * Execute Python code in the sandbox and collect results.
   * Automatically reads /tmp/output.html if the code produces one.
   */
  async run(code: string): Promise<RunResult> {
    const sb = await this.ensureSandbox();

    await sb.writeFiles([
      { path: '/tmp/analysis.py', content: Buffer.from(code) },
    ]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT);

    let result;
    try {
      result = await sb.runCommand('python3', ['/tmp/analysis.py'], {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const stdoutRaw = await result.stdout();
    const stdout = stdoutRaw.slice(0, MAX_STDOUT_SIZE);
    const stderr = result.exitCode !== 0
      ? (await result.stderr()).slice(0, 5000)
      : '';

    let htmlArtifact: string | null = null;
    try {
      const buf = await sb.readFileToBuffer({ path: '/tmp/output.html' });
      if (buf) {
        const html = buf.toString('utf-8');
        if (html.length > 0 && html.length <= MAX_HTML_SIZE) {
          htmlArtifact = html;
        }
      }
    } catch {
      // No HTML output — that's fine
    }

    // Clean up the output file so next run starts fresh
    if (htmlArtifact) {
      await sb.runCommand('rm', ['-f', '/tmp/output.html']).catch(() => {});
    }

    return { stdout, stderr, exitCode: result.exitCode, htmlArtifact };
  }

  /** Tear down the sandbox VM. Safe to call multiple times. */
  async destroy(): Promise<void> {
    if (this.sandbox) {
      try {
        await this.sandbox.stop({ blocking: true });
      } catch {
        // Best effort cleanup
      }
      this.sandbox = null;
    }
    this.creating = null;
  }
}

/**
 * Creates a sandbox snapshot with pre-installed packages (pandas, plotly, numpy).
 * Run once, then set SANDBOX_SNAPSHOT_ID env var to skip pip install on every run.
 * Snapshots expire after 30 days by default.
 */
export async function createAnalysisSnapshot(): Promise<string> {
  const sandbox = await Sandbox.create({
    runtime: 'python3.13',
    timeout: 120_000,
    env: { MPLBACKEND: 'Agg' },
  });

  const pipResult = await sandbox.runCommand('pip', [
    'install', '-q', ...REQUIRED_PACKAGES,
  ]);

  if (pipResult.exitCode !== 0) {
    const stderr = await pipResult.stderr();
    await sandbox.stop({ blocking: true });
    throw new Error(`Failed to install packages: ${stderr.slice(0, 2000)}`);
  }

  const snapshot = await sandbox.snapshot();
  console.log(`[sandbox] Snapshot created: ${snapshot.snapshotId}`);
  return snapshot.snapshotId;
}
