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
  arrivalSummary,
  arrivalMessage,
  evenArrivalProfile,
  replaceArrivalProfiles,
  normalizeTime,
  displayTime,
  changeStaffAssignment,
  moveStaffAssignment,
  addStaffAssignment,
  removeStaffAssignment,
  isRequiredField,
  firstBlockingIssue,
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
test("only committed rentals count toward available equipment", () => {
  const plan = copyDemo();
  const scanner = plan.constraints.equipment.items[0];
  const required = totals(plan).required[scanner.id];
  scanner.available = required - 1;
  const equipmentIssue = () =>
    validate(plan).some((issue) => issue.path === "constraints.equipment.items.0.available");
  assert.equal(equipmentIssue(), true);
  scanner.extra_rented = 1;
  assert.equal(equipmentIssue(), false);
  scanner.extra_rented = scanner.extra_rentable + 1;
  assert.equal(equipmentIssue(), true);
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

test("General arrival error states show the missing share and reject blank, invalid or overlapping inputs", () => {
  const profile = { "13:00-15:00": 40, "15:00-17:00": 30 };
  assert.equal(arrivalSummary(profile).total, 70);
  assert.match(arrivalMessage(profile), /Add 30%/);
  assert.match(
    arrivalMessage({ "13:00-15:00": 80, "15:00-17:00": 30 }),
    /Remove 10%/,
  );
  assert.match(arrivalMessage({ "13:00-15:00": null }), /blank percentage/);
  for (const p of [
    {},
    { "13:00-15:00": NaN },
    { "13:00-15:00": -1, "15:00-17:00": 101 },
    { "15:00-13:00": 100 },
    { "13:00-15:00": 50, "14:00-17:00": 50 },
  ])
    assert.equal(arrivalSummary(p).complete, false);
  assert.equal(
    arrivalSummary({
      "13:00-15:00": 33.3,
      "15:00-17:00": 33.3,
      "17:00-19:00": 33.4,
    }).complete,
    true,
  );
  const plan = copyDemo(),
    id = plan.event.ticket_categories[0].id;
  plan.event.ticket_categories[0].name = "General";
  plan.demand.arrival_windows_percent[id] = profile;
  assert.ok(
    validate(plan).some(
      (i) => i.message === "General: Add 30% more to account for all guests.",
    ),
  );
});
test("even split uses the actual event times, accounts for all guests and needs a valid planning interval", () => {
  const profile = evenArrivalProfile({
    arrival_generation_start: "13:00",
    last_entry: "19:00",
  });
  assert.deepEqual(profile, {
    "13:00-14:30": 25,
    "14:30-16:00": 25,
    "16:00-17:30": 25,
    "17:30-19:00": 25,
  });
  assert.equal(arrivalSummary(profile).complete, true);
  assert.equal(
    arrivalSummary(
      evenArrivalProfile({ doors_open: "13:00", last_entry: "13:03" }),
    ).complete,
    true,
  );
  assert.equal(evenArrivalProfile({}), null);
  assert.equal(
    evenArrivalProfile({ doors_open: "19:00", last_entry: "13:00" }),
    null,
  );
});
test("arrival updates affect only explicitly selected categories and retain unexposed plan data", () => {
  const plan = copyDemo(),
    before = structuredClone(plan),
    id = plan.event.ticket_categories[0].id;
  const profile = { "15:00-17:00": 100 };
  const next = replaceArrivalProfiles(plan, [id], profile);
  assert.deepEqual(plan, before);
  assert.deepEqual(next.demand.arrival_windows_percent[id], profile);
  assert.deepEqual(
    next.demand.arrival_windows_percent[plan.event.ticket_categories[1].id],
    before.demand.arrival_windows_percent[plan.event.ticket_categories[1].id],
  );
  assert.deepEqual(next.spatial_context, plan.spatial_context);
  const all = replaceArrivalProfiles(
    plan,
    plan.event.ticket_categories.map((c) => c.id),
    profile,
  );
  assert.ok(
    all.event.ticket_categories.every(
      (c) => arrivalSummary(all.demand.arrival_windows_percent[c.id]).complete,
    ),
  );
});

test("friendly time input normalizes 12-hour, 24-hour and compact entries without accepting invalid times", () => {
  for (const [input, expected] of [
    ["5:30 pm", "17:30"],
    ["9am", "09:00"],
    ["12am", "00:00"],
    ["12 pm", "12:00"],
    ["1730", "17:30"],
    ["930", "09:30"],
    ["17.30", "17:30"],
    ["9", "09:00"],
    ["  5:30 PM  ", "17:30"],
    ["", ""],
  ])
    assert.equal(normalizeTime(input), expected, input);
  for (const input of [
    "24:00",
    "12:60",
    "13 pm",
    "0am",
    "9:3",
    "later",
    "-1",
    null,
  ])
    assert.equal(normalizeTime(input), null, String(input));
  assert.equal(displayTime("17:30"), "5:30 PM");
  assert.equal(displayTime("00:00"), "12:00 AM");
});
test("assignment editing preserves plan extensions and switches to an actual lane at the chosen point", () => {
  const plan = copyDemo(),
    original = structuredClone(plan),
    role = plan.staff.roles[0];
  role.assignment[0].custom_note = "Preserve this";
  const help = plan.venue.layout.service_points[0];
  const next = changeStaffAssignment(plan, role.id, 0, {
    point: help.id,
    count: 2,
  });
  assert.equal(next.staff.roles[0].assignment[0].point, help.id);
  assert.equal(next.staff.roles[0].assignment[0].lane_group, "desk");
  assert.equal(next.staff.roles[0].assignment[0].count, 2);
  assert.equal(next.staff.roles[0].assignment[0].custom_note, "Preserve this");
  assert.deepEqual(next.spatial_context, original.spatial_context);
  assert.equal(
    plan.staff.roles[0].assignment[0].point,
    original.staff.roles[0].assignment[0].point,
  );
  assert.ok(validate(next).some((i) => i.message.includes("not qualified")));
});
test("adding, moving and removing assignments changes allocation without duplicating staff or costs", () => {
  const plan = copyDemo(),
    first = plan.staff.roles[0],
    target = plan.staff.roles[3],
    original = structuredClone(plan),
    cost = totals(plan).total;
  const added = addStaffAssignment(plan, first.id);
  assert.equal(added.staff.roles[0].assignment.length, 2);
  assert.equal(added.staff.roles[0].assignment[1].count, null);
  const moved = moveStaffAssignment(added, first.id, 1, target.id);
  assert.equal(moved.staff.roles[0].assignment.length, 1);
  assert.equal(moved.staff.roles[3].assignment.length, 2);
  const removed = removeStaffAssignment(moved, target.id, 1);
  assert.deepEqual(removed, original);
  assert.equal(totals(moved).total, cost);
  assert.deepEqual(plan, original);
});
test("assignment validation rejects fractional people, missing lane groups, over-allocation and uncovered shifts", () => {
  let plan = copyDemo(),
    id = plan.staff.roles[0].id;
  plan = changeStaffAssignment(plan, id, 0, {
    count: 1.5,
    lane_group: "missing",
  });
  assert.ok(
    validate(plan).some((i) => i.path === "staff.roles.0.assignment.0.count"),
  );
  assert.ok(
    validate(plan).some(
      (i) => i.path === "staff.roles.0.assignment.0.lane_group",
    ),
  );
  plan = changeStaffAssignment(copyDemo(), id, 0, { count: 9 });
  assert.ok(
    validate(plan).some((i) => i.message.includes("assignments exceed count")),
  );
  plan.staff.shifts[0].start = "18:00";
  assert.ok(validate(plan).some((i) => i.path === "staff.roles.0.shift"));
});

test("required simulation times block progression while optional show times stay optional", () => {
  const plan = copyDemo();
  for (const key of ["arrival_generation_start", "model_end"]) {
    const missing = set(plan, "event.schedule." + key, "");
    assert.equal(isRequiredField("event.schedule." + key, missing), true);
    assert.ok(
      validate(missing).some((i) => i.path === "event.schedule." + key),
    );
    assert.equal(firstBlockingIssue(missing, "attendance").step, "brief");
    assert.equal(firstBlockingIssue(missing, "simulation").step, "brief");
  }
  for (const key of [
    "opening_act",
    "ultimate_check_in_start",
    "premium_concert_doors",
  ]) {
    const optional = set(plan, "event.schedule." + key, "");
    assert.equal(isRequiredField("event.schedule." + key, optional), false);
    assert.ok(
      !validate(optional).some((i) => i.path === "event.schedule." + key),
    );
  }
});
test("empty plans cannot skip forward through tabs, review or simulation", () => {
  const plan = blankPlan();
  assert.equal(firstBlockingIssue(plan, "brief"), undefined);
  for (const target of [
    "attendance",
    "checks",
    "resources",
    "targets",
    "review",
    "simulation",
  ])
    assert.equal(firstBlockingIssue(plan, target).step, "brief");
  assert.equal(firstBlockingIssue(copyDemo(), "simulation"), undefined);
});
test("validation blocks the first incomplete section and allows going back to it", () => {
  let plan = set(
    copyDemo(),
    "event.ticket_categories.0.expected_attendees_estimate",
    null,
  );
  assert.equal(firstBlockingIssue(plan, "checks").step, "attendance");
  assert.equal(firstBlockingIssue(plan, "review").step, "attendance");
  assert.equal(firstBlockingIssue(plan, "attendance"), undefined);
  plan = set(copyDemo(), "staff.shifts.0.start", "");
  assert.equal(firstBlockingIssue(plan, "targets").step, "resources");
  assert.equal(firstBlockingIssue(plan, "simulation").step, "resources");
});
test("all exposed required groups validate missing values and accept explicit zero where meaningful", () => {
  const plan = copyDemo();
  const paths = [
    "event.name",
    "event.date",
    "meta.timezone",
    "venue.name",
    "event.expected_attendees_estimate",
    "event.audience_profile.typical_group_size",
    "event.audience_profile.female_percent",
    "venue.layout.gates.0.name",
    "venue.layout.gates.0.lanes.0.count",
    "process_steps.steps.0.time_per_person_seconds.typical",
    "staff.roles.0.name",
    "staff.roles.0.gender.female",
    "staff.roles.0.shift",
    "staff.roles.0.assignment.0.count",
    "staff.shifts.0.meal_break_minutes",
    "constraints.equipment.items.0.available",
    "constraints.budget.staff_cap_idr",
    "constraints.safety.max_density_persons_per_m2.queue_zones",
  ];
  for (const path of paths) {
    assert.equal(isRequiredField(path, plan), true, path);
    const broken = set(
      plan,
      path,
      typeof path === "string" &&
        [
          "event.name",
          "meta.timezone",
          "venue.name",
          "staff.roles.0.name",
          "staff.roles.0.shift",
          "venue.layout.gates.0.name",
        ].includes(path)
        ? ""
        : null,
    );
    assert.ok(
      validate(broken).some((i) => i.path === path),
      path,
    );
  }
  const zero = set(plan, "event.capacity.no_show_percent_estimate", 0);
  assert.ok(
    !validate(zero).some(
      (i) => i.path === "event.capacity.no_show_percent_estimate",
    ),
  );
  assert.ok(
    validate(set(plan, "event.audience_profile.typical_group_size", 0)).some(
      (i) => i.path === "event.audience_profile.typical_group_size",
    ),
  );
});
test("arrivals outside the required simulation period cannot proceed", () => {
  const plan = copyDemo(),
    id = plan.event.ticket_categories[0].id;
  plan.demand.arrival_windows_percent[id] = { "23:00-23:59": 100 };
  assert.ok(
    validate(plan).some(
      (i) => i.path === "demand.arrival_windows_percent." + id,
    ),
  );
  assert.equal(firstBlockingIssue(plan, "checks").step, "attendance");
});

test("missing inputs report the field to fix instead of treating unknown values as zero", () => {
  const plan = copyDemo();
  const quotaIssues = validate(set(plan, "event.ticket_categories.0.quota", null));
  assert.ok(quotaIssues.some((i) => i.path === "event.ticket_categories.0.quota"));
  assert.ok(!quotaIssues.some((i) => i.path === "event.ticket_categories.0.sold"));
  const shift = set(plan, "staff.shifts.0.end", "");
  assert.ok(validate(shift).some((i) => i.path === "staff.shifts.0.end"));
  assert.ok(
    !validate(shift).some((i) => /^staff\.roles\.\d+\.shift$/.test(i.path)),
  );
  const assignment = set(plan, "staff.roles.0.assignment.0.count", null);
  assert.ok(
    validate(assignment).some(
      (i) => i.path === "staff.roles.0.assignment.0.count",
    ),
  );
  assert.ok(!validate(assignment).some((i) => i.path === "staff.roles"));
  const budget = set(plan, "constraints.budget.staff_cap_idr", null);
  assert.equal(
    validate(budget).filter(
      (i) => i.path === "constraints.budget.staff_cap_idr",
    ).length,
    1,
  );
});
