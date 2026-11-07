import type { Plan } from "./model";
export type Score = {
  missed_checks: number;
  shortfall: number;
  cost_idr: number;
};
export type Candidate = {
  plan_id: string;
  kind: string;
  recommended: boolean;
  score: Score;
  des_run_id: string | null;
  des_checks: unknown;
  diff: {
    path: string;
    old: unknown;
    new: unknown;
    approval_needed: string | null;
  }[];
};
export type Optimization = {
  id: string;
  plan_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error: { message: string } | null;
  progress: {
    rounds: number;
    elapsed_seconds: number;
    kept_moves: number;
  } | null;
  starting_plan: {
    score: Score | null;
    des_run_id: string | null;
    des_checks: unknown;
  } | null;
  candidates: Candidate[];
};
export type Comparison = {
  optimization_id: string;
  plan: { id: string; document: Plan };
  candidate: Candidate;
  runs: { baseline?: Plan; candidate?: Plan };
};
export class ServiceError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/simulation/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  }).catch((e) => {
    if (e.name === "AbortError") throw e;
    throw new ServiceError(
      "The optimization service is unavailable. Your draft and V1 preview are safe.",
    );
  });
  const data = await response.json().catch(() => {
    throw new ServiceError(
      "The optimization service is unavailable. Start the server bridge and try again.",
    );
  });
  if (!response.ok)
    throw new ServiceError(
      data.error?.message ?? "The service could not complete this request.",
      data.validation?.issues ?? data.error?.details,
    );
  return data as T;
}
export async function optimize(plan: Plan, seed: number, signal?: AbortSignal) {
  const data = await request<{ plan_id: string; optimization: Optimization }>(
    "optimize",
    { plan, base_seed: seed, replications: 20 },
    signal,
  );
  if (!data.optimization?.id || data.optimization.plan_id !== data.plan_id)
    throw new ServiceError("The service returned an incomplete optimization.");
  return checkedJob(data.optimization);
}
export const getOptimization = (id: string, signal?: AbortSignal) =>
  request<Optimization>(
    `optimizations/${encodeURIComponent(id)}`,
    undefined,
    signal,
  ).then(checkedJob);
export const cancelOptimization = (id: string) =>
  request<Optimization>(
    `optimizations/${encodeURIComponent(id)}/cancel`,
    {},
  ).then(checkedJob);
export const getComparison = (
  id: string,
  candidateId: string,
  signal?: AbortSignal,
) =>
  request<Comparison>(
    `optimizations/${encodeURIComponent(id)}/comparison/${encodeURIComponent(candidateId)}`,
    undefined,
    signal,
  );

function checkedJob(job: Optimization): Optimization {
  if (
    !job ||
    typeof job.id !== "string" ||
    typeof job.plan_id !== "string" ||
    !["queued", "running", "succeeded", "failed", "cancelled"].includes(
      job.status,
    ) ||
    !Array.isArray(job.candidates)
  )
    throw new ServiceError(
      "The service returned an invalid optimization status.",
    );
  for (const candidate of job.candidates)
    if (
      typeof candidate.plan_id !== "string" ||
      !Array.isArray(candidate.diff) ||
      !candidate.score ||
      !Object.values(candidate.score).every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      throw new ServiceError("The service returned an incomplete candidate.");
  return job;
}
