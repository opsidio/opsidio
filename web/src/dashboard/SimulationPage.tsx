import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Hand,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import venueJson from "../simulation/venue/gbk.json";
import scenario from "../../../data/scenarios/coldplay-gbk-demo.json";
import { catalogue } from "../simulation/model";
import { LayoutEditor, useLayoutEditor } from "../simulation/layout";
import { useAbmWorker } from "../simulation/abm/useAbmWorker";
import type {
  EntryAreaMarker,
  Point,
  SceneView,
  VenuePack,
} from "../simulation/types";
import { Badge, Brand, Button, Notice } from "./ui";
import {
  clockSeconds,
  compilePlan,
  exportJSON,
  fmt,
  identity,
  money,
  planShape,
  validate,
  workerConfig,
  type Draft,
  type Plan,
} from "./model";
import {
  cancelOptimization,
  getComparison,
  getOptimization,
  optimize,
  ServiceError,
  type Comparison,
  type Optimization,
} from "./api";
const GbkCanvas = lazy(() => import("../scene/GbkCanvas"));
const PlaybackClock = lazy(() => import("../scene/PlaybackClock"));
const CrowdPreview = lazy(() =>
  import("../simulation/abm/CrowdPreview").then((m) => ({
    default: m.CrowdPreview,
  })),
);
const venue = venueJson as unknown as VenuePack;
function errorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "The service could not complete this request.";
  if (error instanceof ServiceError && Array.isArray(error.details)) {
    const details = error.details
      .slice(0, 6)
      .map((issue) => issue?.message)
      .filter(Boolean)
      .join(" ");
    return details ? `${message} ${details}` : message;
  }
  return message;
}
function changeLabel(plan: Plan, path: string) {
  const ids = [...path.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const items = [
    ...plan.venue.layout.gates,
    ...(plan.venue.layout.service_points ?? []),
    ...plan.staff.roles,
    ...plan.constraints.equipment.items,
  ];
  const item = items.find((item) => ids.includes(item.id));
  const field = path.split(".").at(-1)?.replaceAll("_", " ") ?? "Plan input";
  return item
    ? `${item.name} · ${field}`
    : path
        .replace(/^(venue\.layout|constraints|staff|event)\./, "")
        .replaceAll(".", " · ")
        .replaceAll("_", " ");
}
const displayValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

const pending = (job: Optimization | null) =>
  job?.status === "queued" || job?.status === "running";
type SavedRun = {
  job: Optimization | null;
  snapshot: string;
  comparison: Comparison | null;
};
function restore(key: string): SavedRun {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (v?.job?.id && typeof v.snapshot === "string") return v;
  } catch {}
  return { job: null, snapshot: "", comparison: null };
}
export default function SimulationPage({
  draft,
  onBack,
  onChange,
}: {
  draft: Draft;
  onBack: () => void;
  onChange: (p: Plan) => void;
}) {
  const editor = useLayoutEditor({
    bounds: venue.editBounds,
    catalogue,
    storageKey: `opsidio:layout:${draft.id}`,
  });
  const [view, setView] = useState<SceneView>("entry"),
    [pan, setPan] = useState(false),
    [labels, setLabels] = useState(true),
    [markers, setMarkers] = useState(false),
    [panel, setPanel] = useState<"overview" | "layout" | "compare" | null>(
      "overview",
    );
  const [seed, setSeed] = useState(20261114),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(180),
    [seconds, setSeconds] = useState(7 * 3600),
    clock = useRef(7 * 3600),
    [stats, setStats] = useState({ visibleCount: 0, walkingCount: 0 });
  const linked = draft.plan.venue.id === "gbk-osm-local",
    config = useMemo(
      () =>
        linked ? workerConfig(draft.plan, editor.runnableGraph, seed) : null,
      [draft.plan, editor.runnableGraph, seed, linked],
    ),
    abm = useAbmWorker(config, editor.layout.revision);
  const runKey = `opsidio:optimization:${draft.id}`,
    [run, setRun] = useState<SavedRun>(() => restore(runKey)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadingCandidate, setLoadingCandidate] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [storageNote, setStorageNote] = useState("");
  const job = run.job,
    comparison = run.comparison,
    snapshot = identity(draft, editor.layout) + ":" + seed,
    stale = Boolean(job && run.snapshot !== snapshot),
    issues = useMemo(() => validate(draft.plan), [draft.plan]),
    request = useRef<AbortController | null>(null);
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  useEffect(() => {
    setPlaying(false);
  }, [config]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!run.job) return;
    try {
      sessionStorage.setItem(runKey, JSON.stringify(run));
      setStorageNote("");
    } catch {
      setStorageNote(
        "This result could not be saved in this tab. Export it before leaving.",
      );
    }
  }, [run, runKey]);
  // Poll only the returned job ID. Stop on network errors, terminal states or unmount.
  useEffect(() => {
    if (!job || !pending(job) || error) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getOptimization(job.id, controller.signal);
        if (next.id !== job.id)
          throw Error("The returned optimization does not match this request.");
        setRun((r) => (r.job?.id === next.id ? { ...r, job: next } : r));
        if (pending(next)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Could not check optimization progress.",
          );
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job?.id, job?.status, error]);
  const duration = config?.horizonSeconds ?? 14.5 * 3600,
    origin = config ? clockSeconds(config.timeOrigin.slice(11, 16)) : 9 * 3600,
    time = origin + seconds,
    timeLabel = `${String(Math.floor(time / 3600) % 24).padStart(2, "0")}:${String(Math.floor(time / 60) % 60).padStart(2, "0")}`;
  const entryMarkers: EntryAreaMarker[] = scenario.entry_areas.map((a) => ({
    id: a.id,
    label: a.label,
    position: a.position as unknown as Point,
    color: a.color,
    attendees: draft.plan.event.ticket_categories
      .filter((c: Plan) => c.entry_area_id === a.id)
      .reduce(
        (n: number, c: Plan) =>
          n + Number(c.expected_attendees_estimate ?? c.sold ?? 0),
        0,
      ),
  }));
  function seek(value: number) {
    clock.current = value;
    setSeconds(value);
    setPlaying(false);
  }
  async function startOptimize() {
    if (issues.length || !editor.runnableGraph) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setLoadingCandidate(false);
    setError("");
    setPanel("compare");
    setReviewed(false);
    const key = snapshot;
    try {
      const plan = linked
          ? compilePlan(draft.plan, editor.layout, editor.runnableGraph)
          : structuredClone(draft.plan),
        job = await optimize(plan, seed, controller.signal);
      setRun({ job, snapshot: key, comparison: null });
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function chooseCandidate(id: string) {
    if (!job) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoadingCandidate(true);
    setError("");
    setReviewed(false);
    try {
      const next = await getComparison(job.id, id, controller.signal);
      if (
        next.optimization_id !== job.id ||
        next.plan.id !== id ||
        !planShape(next.plan.document)
      )
        throw Error(
          "The returned candidate is incomplete or does not match this comparison.",
        );
      setRun((r) => (r.job?.id === job.id ? { ...r, comparison: next } : r));
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoadingCandidate(false);
    }
  }
  const scopeCount = config?.cohorts.reduce((n, c) => n + c.count, 0);
  return (
    <main className="op-simulation" aria-label="3D crowd simulation">
      <div className="op-scene">
        <Suspense
          fallback={
            <div className="op-scene-loading">
              <LoaderCircle className="op-spin" />
              Loading the GBK model…
            </div>
          }
        >
          {linked ? (
            <GbkCanvas
              venue={venue}
              catalogue={catalogue}
              placements={editor.layout.placements}
              routes={panel === "layout" ? editor.graph.routes : []}
              nodes={panel === "layout" ? editor.graph.sceneNodes : []}
              entryAreas={markers ? entryMarkers : undefined}
              view={view}
              autoRotate={false}
              panMode={pan}
              showLabels={labels}
              showGuides={panel === "layout"}
              selectedId={panel === "layout" ? editor.selectedId : null}
              onSelect={panel === "layout" ? editor.onSelect : () => {}}
              onMove={panel === "layout" ? editor.onMove : () => {}}
            >
              <PlaybackClock
                clockRef={clock}
                playing={playing && Boolean(abm.result)}
                rate={rate}
                duration={duration}
                onTick={setSeconds}
                onEnd={() => setPlaying(false)}
              />
              {abm.result && (
                <CrowdPreview
                  result={abm.result}
                  clockRef={clock}
                  maxVisible={5000}
                  onSampleStats={setStats}
                />
              )}
            </GbkCanvas>
          ) : (
            <div className="op-scene-loading">
              <Layers3 size={40} />
              <h2>No 3D model linked yet</h2>
              <p>
                The team’s available model is Stadion Utama GBK.
                <br />
                Your event inputs are saved; connect a matching venue model to
                preview arrivals.
              </p>
              <Button onClick={onBack}>Back to event plan</Button>
            </div>
          )}
        </Suspense>
      </div>
      <header className="op-sim-header">
        <button
          className="op-icon-button"
          aria-label="Back to event plan"
          onClick={onBack}
        >
          <ArrowLeft size={21} />
        </button>
        <Brand />
        <span className="op-header-divider" />
        <div className="op-sim-title">
          <strong>{draft.plan.event.name || "Untitled event"}</strong>
          <small>
            Entrance simulation · Plan {draft.revision} / Layout{" "}
            {editor.layout.revision}
          </small>
        </div>
        <Badge tone="green">V1 workspace</Badge>
        <Button
          primary
          disabled={
            busy || pending(job) || issues.length > 0 || !editor.runnableGraph
          }
          title={
            issues.length
              ? "Review missing inputs before optimizing"
              : undefined
          }
          onClick={() => void startOptimize()}
        >
          {busy || pending(job) ? (
            <LoaderCircle className="op-spin" size={16} />
          ) : (
            <Sparkles size={16} />
          )}{" "}
          {busy ? "Submitting…" : pending(job) ? "Optimizing…" : "Optimize"}
        </Button>
      </header>
      <nav className="op-camera-bar" aria-label="Camera controls">
        {(
          [
            { id: "orbit", label: "360° view" },
            { id: "isometric", label: "Isometric" },
            { id: "entry", label: "Entry gate" },
            { id: "map", label: "Map" },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
        <button
          aria-label="Pan camera"
          aria-pressed={pan}
          onClick={() => setPan(!pan)}
        >
          <Hand size={16} />
        </button>
      </nav>
      <nav className="op-sim-tools" aria-label="Workspace tools">
        <Button
          aria-pressed={panel === "overview"}
          onClick={() => setPanel(panel === "overview" ? null : "overview")}
        >
          <Play size={16} />
          Playback
        </Button>
        <Button
          disabled={!linked}
          aria-pressed={panel === "layout"}
          onClick={() => {
            setPanel(panel === "layout" ? null : "layout");
            setView("layout");
          }}
        >
          <SlidersHorizontal size={16} />
          Edit layout
        </Button>
        <Button
          aria-pressed={panel === "compare"}
          onClick={() => setPanel(panel === "compare" ? null : "compare")}
        >
          <Layers3 size={16} />
          V1 / V2
        </Button>
        <Button aria-pressed={markers} onClick={() => setMarkers(!markers)}>
          Entry areas
        </Button>
        <Button aria-pressed={labels} onClick={() => setLabels(!labels)}>
          Labels
        </Button>
      </nav>
      {panel === "layout" && (
        <div className="op-layout-panel">
          <LayoutEditor editor={editor} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "overview" && (
        <section className="op-sim-panel">
          <header>
            <div>
              <span className="op-eyebrow">V1 · ARRIVAL PREVIEW</span>
              <h2>Explore the entrance</h2>
            </div>
            <button
              className="op-icon-button"
              aria-label="Close playback panel"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </header>
          <p>
            Preview {fmt(scopeCount)} arrivals at <strong>Plaza Utara</strong>.
            The other entry areas are shown as markers; their routes are not yet
            authored.
          </p>
          <div className="op-sim-metrics">
            <div>
              <small>Expected · full event</small>
              <strong>
                {fmt(draft.plan.event.expected_attendees_estimate)}
              </strong>
            </div>
            <div>
              <small>Walking now</small>
              <strong>{abm.result ? fmt(stats.walkingCount) : "—"}</strong>
            </div>
          </div>
          <label className="op-field">
            <span>Scenario seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isSafeInteger(n)) setSeed(n);
              }}
            />
          </label>
          <Button
            primary
            disabled={!config || abm.status === "running"}
            onClick={() => {
              seek(Math.min(7 * 3600, duration));
              abm.generate();
            }}
          >
            {abm.status === "running" ? (
              <LoaderCircle size={16} className="op-spin" />
            ) : (
              <Play size={16} />
            )}{" "}
            {abm.status === "running"
              ? "Generating arrivals…"
              : abm.result
                ? "Regenerate V1"
                : "Generate V1 arrivals"}
          </Button>
          {abm.status === "running" && (
            <Button onClick={abm.cancel}>Cancel</Button>
          )}
          {abm.error && (
            <p className="op-error" role="alert">
              {abm.error}
            </p>
          )}
          {!config && (
            <Notice title="A few inputs are needed" tone="amber">
              Choose the GBK venue and add valid north-entry cohorts, arrival
              shares, and a connected layout.
            </Notice>
          )}
          {abm.result && (
            <p className="op-success">
              <CheckCircle2 size={15} />
              {fmt(abm.result.generatedCount)} arrivals generated
            </p>
          )}
          {abm.result?.issues.map((i, index) => (
            <p className="op-error" key={index}>
              {i}
            </p>
          ))}
          <div className="op-panel-note">
            The 3D playback shows walking arrivals. Queue times and service
            outcomes come from the optimization service.
          </div>
          {issues.length > 0 && (
            <Button onClick={onBack}>
              Review {issues.length} incomplete inputs
              <ArrowRight size={15} />
            </Button>
          )}
        </section>
      )}
      {panel === "compare" && (
        <section className="op-sim-panel op-comparison">
          <header>
            <div>
              <span className="op-eyebrow">OPTIMIZATION</span>
              <h2>Compare the possibilities</h2>
            </div>
            <button
              className="op-icon-button"
              aria-label="Close comparison"
              onClick={() => setPanel(null)}
            >
              <X size={18} />
            </button>
          </header>
          {stale && (
            <Notice title="Inputs have changed" tone="amber">
              This comparison belongs to an earlier plan or layout. Optimize
              again to compare your current inputs.
            </Notice>
          )}
          {storageNote && (
            <p role="alert" className="op-error">
              {storageNote}
            </p>
          )}
          {error && (
            <Notice title="Unable to complete this step" tone="amber">
              {error}
              {pending(job) && (
                <Button onClick={() => setError("")}>Resume checking</Button>
              )}
            </Notice>
          )}
          {!job && !busy && (
            <>
              <div className="op-compare-empty">
                <Sparkles size={30} />
                <h3>A better entry plan starts here</h3>
                <p>
                  Optimize tests changes to lanes, staffing, opening times, and
                  equipment against your targets.
                </p>
              </div>
              <Button
                primary
                disabled={issues.length > 0 || !editor.runnableGraph}
                onClick={() => void startOptimize()}
              >
                Optimize this plan
                <ArrowRight size={16} />
              </Button>
            </>
          )}
          {(busy || pending(job)) && (
            <div className="op-optimization-progress" role="status">
              <LoaderCircle className="op-spin" size={28} />
              <h3>
                {busy
                  ? "Submitting your plan"
                  : "Testing possible improvements"}
              </h3>
              <p>
                {job?.progress
                  ? `${job.progress.rounds} rounds · ${job.progress.kept_moves} improvements · ${Math.round(job.progress.elapsed_seconds)} seconds`
                  : "The service will return candidate plans for you to compare."}
              </p>
              {job && pending(job) && (
                <Button
                  onClick={() =>
                    void cancelOptimization(job.id)
                      .then((next) => {
                        setRun((r) => ({ ...r, job: next }));
                        setError("");
                      })
                      .catch((e) => setError(e.message))
                  }
                >
                  Cancel optimization
                </Button>
              )}
            </div>
          )}
          {job?.status === "failed" && (
            <Notice title="Optimization did not finish" tone="amber">
              {job.error?.message ??
                "The service could not find a result. Your original plan is unchanged."}
            </Notice>
          )}
          {job?.status === "cancelled" && (
            <p>Optimization cancelled. V1 is unchanged.</p>
          )}
          {job?.status === "succeeded" && (
            <>
              <Badge tone="green">Optimization complete</Badge>
              {job.candidates.length ? (
                <label className="op-field">
                  <span>V2 candidate</span>
                  <select
                    value={comparison?.plan.id ?? ""}
                    onChange={(e) => void chooseCandidate(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a candidate
                    </option>
                    {job.candidates.map((c, i) => (
                      <option key={c.plan_id} value={c.plan_id}>
                        Candidate {i + 1}
                        {c.recommended ? " · Recommended" : ""} · {c.kind}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p>
                  The service returned no candidate plans. Your original plan
                  remains V1.
                </p>
              )}
              {loadingCandidate && (
                <p role="status">Loading candidate and verified runs…</p>
              )}
              {comparison && (
                <>
                  <table className="op-table op-score-table">
                    <thead>
                      <tr>
                        <th>Service score</th>
                        <th>V1</th>
                        <th>V2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Missed checks", "missed_checks"],
                          ["Target shortfall", "shortfall"],
                          ["Resource cost", "cost_idr"],
                        ] as const
                      ).map(([label, key]) => (
                        <tr key={key}>
                          <td>{label}</td>
                          {[
                            job.starting_plan?.score,
                            comparison.candidate.score,
                          ].map((s, i) => (
                            <td key={i}>
                              {typeof s?.[key] === "number"
                                ? key === "cost_idr"
                                  ? money(s[key])
                                  : fmt(s[key])
                                : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <small className="op-muted">
                    Lower scores are better. Service verification: V1{" "}
                    {comparison.runs.baseline ? "available" : "not returned"} ·
                    V2{" "}
                    {comparison.runs.candidate ? "available" : "not returned"}.
                  </small>
                  <h3>Suggested changes</h3>
                  <div className="op-suggestions">
                    {comparison.candidate.diff.length ? (
                      comparison.candidate.diff.map((d, i) => (
                        <div key={i}>
                          <strong>
                            {changeLabel(comparison.plan.document, d.path)}
                          </strong>
                          <p>
                            {displayValue(d.old)} <ArrowRight size={13} />{" "}
                            {displayValue(d.new)}
                          </p>
                          {d.approval_needed && (
                            <Badge tone="amber">
                              {String(d.approval_needed)}
                            </Badge>
                          )}
                        </div>
                      ))
                    ) : (
                      <p>No changes returned for this candidate.</p>
                    )}
                  </div>
                  <label className="op-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I have reviewed these changes and any required approvals.
                  </label>
                  <Button
                    primary
                    disabled={stale || !reviewed || loadingCandidate}
                    onClick={() => {
                      if (currentSnapshot.current !== run.snapshot) return;
                      onChange(structuredClone(comparison.plan.document));
                      setReviewed(false);
                      setPanel("overview");
                      abm.cancel();
                    }}
                  >
                    Use V2 inputs
                    <ArrowRight size={16} />
                  </Button>
                  <p className="op-muted">
                    Applying V2 creates a new draft revision. Regenerate its
                    arrival preview after applying.
                  </p>
                  <Button
                    onClick={() =>
                      exportJSON(
                        { optimization: job, ...comparison },
                        "opsidio-comparison.json",
                      )
                    }
                  >
                    <Download size={15} />
                    Export comparison
                  </Button>
                </>
              )}
            </>
          )}
        </section>
      )}
      <div className="op-playback">
        <button
          className="op-icon-button"
          aria-label="Restart playback"
          disabled={!abm.result}
          onClick={() => seek(0)}
        >
          <RotateCcw size={19} />
        </button>
        <Button
          primary
          aria-label={playing ? "Pause playback" : "Play playback"}
          disabled={!abm.result}
          onClick={() => {
            if (seconds >= duration) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </Button>
        <div className="op-time">
          <strong>{timeLabel}</strong>
          <small>WIB · V1 arrivals</small>
        </div>
        <input
          type="range"
          aria-label="Simulation time"
          min="0"
          max={duration}
          step="30"
          value={Math.min(seconds, duration)}
          disabled={!abm.result}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <select
          aria-label="Playback speed"
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
        >
          <option value={60}>1 min / sec</option>
          <option value={180}>3 min / sec</option>
          <option value={600}>10 min / sec</option>
        </select>
      </div>
      <span className="op-scene-hint">
        Drag to {pan ? "pan" : "orbit"} · Scroll to zoom · Right-drag to pan
      </span>
      <a
        className="op-scene-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors · Illustrative structures
      </a>
    </main>
  );
}
