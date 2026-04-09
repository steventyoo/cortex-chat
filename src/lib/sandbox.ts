import { Sandbox } from '@vercel/sandbox';
import Anthropic from '@anthropic-ai/sdk';

const EXEC_TIMEOUT = 30_000;
const MAX_HTML_SIZE = 100_000;
const MAX_STDOUT_SIZE = 50_000;
const MAX_CODE_RETRIES = 2;
const FIX_MODEL = 'claude-sonnet-4-20250514';
const FIX_MAX_TOKENS = 4096;

export interface AnalysisResult {
  analysis: string;
  htmlArtifact: string | null;
  error?: string;
  retries?: number;
}

async function askClaudeToFix(code: string, stderr: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: FIX_MODEL,
      max_tokens: FIX_MAX_TOKENS,
      system: 'Fix this Python code. Return ONLY the corrected Python code — no explanations, no markdown fences, no commentary. The code runs in a sandbox with pandas, numpy, plotly, json, math, and collections available. Data is at /tmp/data.json. Write HTML charts to /tmp/output.html. Print analysis to stdout.',
      messages: [
        {
          role: 'user',
          content: `This code failed:\n\n${code}\n\nError:\n${stderr.slice(0, 3000)}`,
        },
      ],
    });

    const text = msg.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;

    let fixed = text.text.trim();
    if (fixed.startsWith('```')) {
      fixed = fixed.replace(/^```(?:python)?\n?/, '').replace(/\n?```$/, '');
    }
    return fixed;
  } catch (err) {
    console.error('[sandbox] Code fix call failed:', err);
    return null;
  }
}

async function syntaxCheck(
  sandbox: Sandbox & AsyncDisposable,
  codePath: string,
): Promise<string | null> {
  const check = await sandbox.runCommand('python3', [
    '-c',
    `import ast; ast.parse(open('${codePath}').read())`,
  ]);
  if (check.exitCode !== 0) {
    return (await check.stderr()).slice(0, 3000);
  }
  return null;
}

async function executeAndCollect(
  sandbox: Sandbox & AsyncDisposable,
): Promise<{ analysis: string; htmlArtifact: string | null; exitCode: number; stderr: string }> {
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

  const stderr = result.exitCode !== 0 ? (await result.stderr()).slice(0, 5000) : '';

  return { analysis, htmlArtifact, exitCode: result.exitCode, stderr };
}

export async function runAnalysis(
  code: string,
  dataContext: unknown,
  maxRetries: number = MAX_CODE_RETRIES,
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

    let currentCode = code;
    let retries = 0;

    await sandbox.writeFiles([
      { path: '/tmp/data.json', content: JSON.stringify(dataContext) },
      { path: '/tmp/analysis.py', content: currentCode },
    ]);

    // Syntax pre-check before first execution
    const syntaxErr = await syntaxCheck(sandbox, '/tmp/analysis.py');
    if (syntaxErr) {
      const fixed = await askClaudeToFix(currentCode, syntaxErr);
      if (fixed) {
        currentCode = fixed;
        retries++;
        await sandbox.writeFiles([{ path: '/tmp/analysis.py', content: currentCode }]);
        const recheck = await syntaxCheck(sandbox, '/tmp/analysis.py');
        if (recheck) {
          return { analysis: '', htmlArtifact: null, error: `Syntax error (unfixable): ${recheck}`, retries };
        }
      } else {
        return { analysis: '', htmlArtifact: null, error: `Syntax error: ${syntaxErr}`, retries: 0 };
      }
    }

    // Execute with retry loop
    let lastResult = await executeAndCollect(sandbox);

    while (lastResult.exitCode !== 0 && retries < maxRetries) {
      console.log(`[sandbox] Attempt ${retries + 1} failed, asking Claude to fix...`);
      const fixed = await askClaudeToFix(currentCode, lastResult.stderr);
      if (!fixed) break;

      currentCode = fixed;
      retries++;
      await sandbox.writeFiles([{ path: '/tmp/analysis.py', content: currentCode }]);

      const syntaxErr2 = await syntaxCheck(sandbox, '/tmp/analysis.py');
      if (syntaxErr2) {
        lastResult = { analysis: '', htmlArtifact: null, exitCode: 1, stderr: syntaxErr2 };
        continue;
      }

      lastResult = await executeAndCollect(sandbox);
    }

    if (lastResult.exitCode !== 0) {
      return {
        analysis: lastResult.analysis,
        htmlArtifact: lastResult.htmlArtifact,
        error: lastResult.stderr,
        retries,
      };
    }

    return {
      analysis: lastResult.analysis,
      htmlArtifact: lastResult.htmlArtifact,
      retries,
    };
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
