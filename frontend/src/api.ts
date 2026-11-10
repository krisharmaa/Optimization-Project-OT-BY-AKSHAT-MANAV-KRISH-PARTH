import type { RunParams, RunProgress, RunResult, ScenarioInfo } from './types';
import { useAuth } from './auth';

const authHeader = (): Record<string, string> => {
  const t = useAuth.getState().token;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Requests go to /api, which Vite proxies to the Python server on port 8000 (see vite.config.ts).
const BASE = '/api';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep status text */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function backendAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Built-in instances and the validation study's default budget for each. */
export async function fetchScenarios(): Promise<ScenarioInfo[]> {
  return json<ScenarioInfo[]>(await fetch(`${BASE}/scenarios`));
}

/** The most recent finished run kept by the server (null if none yet or not signed in as admin). */
export async function fetchLatestRun(): Promise<RunResult | null> {
  const res = await fetch(`${BASE}/runs/latest`, { headers: authHeader() });
  return res.ok ? ((await res.json()) as RunResult) : null;
}

/** Starts a run of the final optimizer and polls it until it finishes, reporting progress along the way.
 *  `instance` is sent for custom runs (website or optimizer JSON); teachers' saved availability is added by the server. */
export async function optimise(params: RunParams, onProgress: (p: RunProgress) => void, instance?: unknown): Promise<RunResult> {
  const body = { ...params, instance: params.scenario === 'custom' ? instance : undefined };
  const { runId } = await json<{ runId: string }>(
    await fetch(`${BASE}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) }),
  );
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    const st = await json<{ status: string; progress?: RunProgress; result?: RunResult; error?: string }>(await fetch(`${BASE}/runs/${runId}`, { headers: authHeader() }));
    if (st.progress) onProgress(st.progress);
    if (st.status === 'done' && st.result) return st.result;
    if (st.status === 'error') throw new Error(st.error ?? 'Optimiser failed');
  }
}
