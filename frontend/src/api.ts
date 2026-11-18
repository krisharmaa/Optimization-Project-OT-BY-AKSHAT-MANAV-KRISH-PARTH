import type { DecisionResult, RunParams, RunProgress, RunResult, ScenarioInfo } from './types';
import { useAuth } from './auth';
import { API_ROOT } from './config';

const authHeader = (): Record<string, string> => {
  const t = useAuth.getState().token;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

// Requests go to the backend (src/config.ts): /api through the Vite proxy in development, VITE_API_URL when deployed.
const BASE = API_ROOT;

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 && useAuth.getState().token) useAuth.getState().logout();
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
  let failures = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    // A poll that does not answer within 20 s is abandoned and retried, so one stalled request cannot freeze the page.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let st: { status: string; progress?: RunProgress; result?: RunResult; error?: string };
    try {
      st = await json(await fetch(`${BASE}/runs/${runId}`, { headers: authHeader(), signal: ctrl.signal }));
      failures = 0;
    } catch (e) {
      if (++failures >= 5) throw e instanceof Error && e.name === 'AbortError' ? new Error('The optimiser server stopped answering.') : e;
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (st.progress) onProgress(st.progress);
    if (st.status === 'done' && st.result) return st.result;
    if (st.status === 'error') throw new Error(st.error ?? 'Optimiser failed');
  }
}

/** TOPSIS recommendation for a front. Give either `weights` (gaps, room fit, workload) or three AHP judgements. */
export async function fetchDecision(objectives: number[][], weights: number[] | null, ahp: number[] | null): Promise<DecisionResult> {
  return json<DecisionResult>(
    await fetch(`${BASE}/mcdm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ objectives, weights: ahp ? null : weights, ahp }),
    }),
  );
}
