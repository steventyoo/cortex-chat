import { Sandbox } from '@vercel/sandbox';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const EXEC_TIMEOUT = 30_000;
const SANDBOX_LIFETIME = 5 * 60_000;
const MAX_HTML_SIZE = 100_000;
const MAX_STDOUT_SIZE = 50_000;
const REQUIRED_PACKAGES = ['pandas', 'plotly', 'numpy'];

// Embed calc library at build time so files survive deployment
const CALC_LIB_DIR = join(__dirname, 'calc-library');
const CALC_LIB_FILES: Record<string, string> = {};
try {
  for (const f of readdirSync(CALC_LIB_DIR).filter(f => f.endsWith('.py'))) {
    CALC_LIB_FILES[f] = readFileSync(join(CALC_LIB_DIR, f), 'utf-8');
  }
} catch {
  // calc-library dir may not exist in some build environments
}

function getCredentials() {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !teamId || !projectId) {
    throw new Error(
      'Missing sandbox credentials. Set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID in .env'
    );
  }
  return { token, teamId, projectId };
}

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
  private lastData: unknown = null;

  private async ensureSandbox(): Promise<Sandbox & AsyncDisposable> {
    if (this.sandbox) return this.sandbox;

    if (!this.creating) {
      this.creating = this.boot();
    }
    this.sandbox = await this.creating;
    return this.sandbox;
  }

  private async boot(): Promise<Sandbox & AsyncDisposable> {
    const creds = getCredentials();
    const snapshotId = process.env.SANDBOX_SNAPSHOT_ID;

    if (snapshotId) {
      const snapshotSb = await Sandbox.create({
        ...creds,
        source: { type: 'snapshot', snapshotId },
        timeout: SANDBOX_LIFETIME,
        networkPolicy: 'deny-all',
        env: { MPLBACKEND: 'Agg' },
      });
      await this.injectCalcLibrary(snapshotSb);
      return snapshotSb;
    }

    const sb = await Sandbox.create({
      ...creds,
      runtime: 'python3.13',
      timeout: SANDBOX_LIFETIME,
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
    await this.injectCalcLibrary(sb);
    return sb;
  }

  /**
   * Write the embedded calc library Python files into the sandbox at /tmp/cortex_calcs/.
   */
  private async injectCalcLibrary(sb: Sandbox): Promise<void> {
    const files = Object.entries(CALC_LIB_FILES).map(([name, content]) => ({
      path: `/tmp/cortex_calcs/${name}`,
      content: Buffer.from(content),
    }));
    if (files.length > 0) {
      await sb.writeFiles(files);
    }
  }

  /**
   * Detect a 410 "sandbox_stopped" and transparently create a fresh sandbox.
   * Re-writes /tmp/data.json from the last cached data so the new VM has context.
   */
  private async handleGone(): Promise<void> {
    console.warn('[sandbox] Sandbox expired (410 Gone). Recreating...');
    this.sandbox = null;
    this.creating = null;
    const sb = await this.ensureSandbox();
    if (this.lastData) {
      await sb.writeFiles([
        { path: '/tmp/data.json', content: Buffer.from(JSON.stringify(this.lastData)) },
      ]);
    }
    await this.injectCalcLibrary(sb);
  }

  private isGoneError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'response' in err) {
      const resp = (err as { response?: { status?: number } }).response;
      if (resp?.status === 410) return true;
    }
    if (err instanceof Error && err.message.includes('410')) return true;
    return false;
  }

  /**
   * Write JSON data to /tmp/data.json inside the sandbox.
   * Called as a side effect of execute_sql_analytics so Claude
   * doesn't need a dedicated "upload data" tool call.
   */
  async writeData(data: unknown): Promise<void> {
    this.lastData = data;
    try {
      const sb = await this.ensureSandbox();
      await sb.writeFiles([
        { path: '/tmp/data.json', content: Buffer.from(JSON.stringify(data)) },
      ]);
    } catch (err) {
      if (this.isGoneError(err)) {
        await this.handleGone();
      } else {
        throw err;
      }
    }
  }

  /**
   * Execute Python code in the sandbox and collect results.
   * Automatically reads /tmp/output.html if the code produces one.
   */
  async run(code: string): Promise<RunResult> {
    return this.runWithRetry(code, false);
  }

  private async runWithRetry(code: string, isRetry: boolean): Promise<RunResult> {
    let sb: Sandbox & AsyncDisposable;
    try {
      sb = await this.ensureSandbox();
      await sb.writeFiles([
        { path: '/tmp/analysis.py', content: Buffer.from(code) },
      ]);
    } catch (err) {
      if (!isRetry && this.isGoneError(err)) {
        await this.handleGone();
        return this.runWithRetry(code, true);
      }
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT);

    let result;
    try {
      result = await sb.runCommand('python3', ['/tmp/analysis.py'], {
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (!isRetry && this.isGoneError(err)) {
        await this.handleGone();
        return this.runWithRetry(code, true);
      }
      throw err;
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
  const creds = getCredentials();
  const sandbox = await Sandbox.create({
    ...creds,
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
