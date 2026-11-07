import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("./model.ts", import.meta.url), "utf8");
const demo = await readFile(
  new URL("./demo-plan.json", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  source.replace(
    /import demo from ['"]\.\/demo-plan\.json['"];?/,
    `const demo = ${demo}`,
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  copyDemo,
  blankPlan,
  validate,
  set,
  totals,
  workerConfig,
  compilePlan,
  identity,
  newDraft,
  updated,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const graph = {
  nodes: [
    { id: "arrival", role: "arrival", position: [0, 0, 0] },
    { id: "queue", role: "queue", position: [10, 0, 0] },
    { id: "scan_checkpoint", role: "checkpoint", position: [20, 0, 0] },
    { id: "destination", role: "destination", position: [30, 0, 0] },
  ],
  edges: [
    { id: "one", from: "arrival", to: "queue", distanceM: 10 },
    { id: "two", from: "queue", to: "scan_checkpoint", distanceM: 37 },
    { id: "three", from: "scan_checkpoint", to: "destination", distanceM: 10 },
  ],
  routes: [],
  sceneNodes: [],
};
test("supplied GBK plan validates and keeps all 20 cohorts without double counting Infinity", () => {
  const p = copyDemo();
  assert.deepEqual(validate(p), []);
  assert.equal(p.event.ticket_categories.length, 20);
  assert.equal(totals(p).sold, 70000);
  assert.equal(totals(p).staff, 45);
  assert.equal(totals(p).lanes, 20);
});
test("new users start with unknown values rather than demo assumptions", () => {
  const p = blankPlan();
  assert.equal(p.event.name, "");
  assert.equal(p.event.ticket_categories.length, 0);
  assert.ok(validate(p).length > 0);
});
test("edits preserve source and spatial extensions, distinguish blank from zero, and synchronize aliases", () => {
  const p = copyDemo();
  p.unexposed = { preserve: true };
  const next = set(p, "event.schedule.outer_area_open", "12:30");
  assert.equal(next.event.schedule.prefunction_open, "12:30");
  assert.equal(p.event.schedule.outer_area_open, "13:00");
  assert.deepEqual(next.spatial_context, p.spatial_context);
  assert.deepEqual(next.unexposed, p.unexposed);
  assert.equal(
    set(p, "event.capacity.no_show_percent_estimate", null).event.capacity
      .no_show_percent_estimate,
    null,
  );
  assert.equal(
    set(p, "event.capacity.no_show_percent_estimate", 0).event.capacity
      .no_show_percent_estimate,
    0,
  );
  assert.throws(() => set(p, "__proto__.polluted", true));
});
test("attendance reconciliation, lane limits and equipment shortages block optimization", () => {
  let p = copyDemo();
  p.event.ticket_categories[0].sold += 1;
  p.venue.layout.gates[0].lanes[0].count = 9;
  p.constraints.equipment.items[0].available = 0;
  const messages = validate(p)
    .map((i) => i.message)
    .join(" ");
  assert.match(messages, /sold exceeds quota/);
  assert.match(messages, /lane limit exceeded/);
  assert.match(messages, /required/);
  assert.match(messages, /qualified staff/);
});
test("worker receives current expected cohorts and arrival profiles only for authored north route", () => {
  const p = copyDemo(),
    c = workerConfig(p, graph, 42);
  assert.equal(
    c.cohorts.reduce((n, c) => n + c.count, 0),
    15500,
  );
  assert.equal(c.seed, 42);
  assert.equal(c.timeOrigin, "2026-11-14T09:00:00+07:00");
  const north = p.event.ticket_categories.find(
    (c) => c.entry_area_id === "plaza_utara",
  );
  north.expected_attendees_estimate = 321;
  assert.equal(
    workerConfig(p, graph, 42).cohorts.find((c) => c.id === north.id).count,
    321,
  );
  p.demand.arrival_windows_percent[north.id]["09:00-13:00"] = 99;
  assert.equal(workerConfig(p, graph, 42), null);
  assert.equal(workerConfig(copyDemo(), null, 42), null);
});
test("compiled request preserves full plan and projects authored route length without mutating the draft", () => {
  const p = copyDemo(),
    before = structuredClone(p),
    layout = {
      schemaVersion: "opsidio-editor/0.1",
      id: "test",
      revision: 3,
      placements: [],
      nodes: graph.nodes,
      edges: graph.edges,
    };
  const compiled = compilePlan(p, layout, graph);
  assert.deepEqual(p, before);
  assert.equal(compiled.editor_context.layout.revision, 3);
  assert.equal(
    compiled.venue.layout.walking_paths.find(
      (p) =>
        p.from === "queue_plaza_utara" && p.to === "proposed_gate_plaza_utara",
    ).distance_m,
    37,
  );
  assert.deepEqual(compiled.spatial_context, p.spatial_context);
  assert.equal(compiled.event.ticket_categories.length, 20);
});
test("plan and layout revisions each invalidate prior snapshots", () => {
  const d = newDraft(true),
    layout = { id: "l", revision: 1 };
  const key = identity(d, layout);
  assert.notEqual(
    identity(updated(d, set(d.plan, "event.name", "Changed")), layout),
    key,
  );
  assert.notEqual(identity(d, { ...layout, revision: 2 }), key);
});
