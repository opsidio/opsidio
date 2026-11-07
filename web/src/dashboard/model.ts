import demo from "./demo-plan.json";
import type { AbmConfig, LayoutRevision } from "../simulation/runtime-types";
import type { ResolvedLayoutGraph } from "../simulation/layout/core";

// Preserve optional service extensions that are not exposed by this editor.
export type Plan = Record<string, any>;
export type Step =
  | "brief"
  | "attendance"
  | "checks"
  | "resources"
  | "targets"
  | "review";
export type Draft = {
  id: string;
  revision: number;
  updatedAt: string;
  venueType: "public" | "private";
  demo: boolean;
  plan: Plan;
};
export type Issue = { path: string; message: string; step: Step };
export const steps: Step[] = [
  "brief",
  "attendance",
  "checks",
  "resources",
  "targets",
  "review",
];
export const titles: Record<Step, string> = {
  brief: "Event brief",
  attendance: "Attendance",
  checks: "Entry checks",
  resources: "Resources",
  targets: "Targets",
  review: "Review entry plan",
};
export const fmt = (value: unknown) =>
  typeof value === "number" ? value.toLocaleString("en-US") : "—";
export const money = (value: number) => `Rp ${fmt(value)}`;
export const copyDemo = (): Plan => structuredClone(demo);
export function blankPlan(): Plan {
  return {
    schema_version: "0.1",
    meta: { timezone: "Asia/Jakarta", currency: "IDR" },
    event: {
      id: crypto.randomUUID(),
      name: "",
      date: "",
      venue: "",
      schedule: {},
      capacity: {},
      audience_profile: {},
      ticket_categories: [],
      admission_planning_notes: {},
    },
    venue: {
      id: "",
      name: "",
      layout: { gates: [], service_points: [], zones: [], walking_paths: [] },
    },
    demand: { arrival_windows_percent: {}, group_size_share_percent: {} },
    process_steps: {
      steps: demo.process_steps.steps.map((s) => ({
        id: s.id,
        name: s.name,
        applies_to: s.applies_to,
        done_by: [],
        time_per_person_seconds: {},
        exceptions: [],
        ...(s.id === "help_desk_resolution" ? { results: {} } : {}),
      })),
    },
    staff: {
      meal_allowance_idr_per_person: null,
      shifts: [
        { id: "admission_shift", start: "", end: "", meal_break_minutes: null },
      ],
      roles: [],
    },
    constraints: {
      budget: {},
      service_targets: { gate_wait: {} },
      timing: {},
      safety: { max_density_persons_per_m2: {} },
      equipment: {
        items: demo.constraints.equipment.items.map((e) => ({
          id: e.id,
          name: e.name,
        })),
      },
    },
  };
}
export function newDraft(example = false): Draft {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    updatedAt: new Date().toISOString(),
    venueType: "public",
    demo: example,
    plan: example ? copyDemo() : blankPlan(),
  };
}
export function get(p: Plan, path: string): any {
  return path.split(".").reduce((v, k) => v?.[k], p);
}
export function set(p: Plan, path: string, value: unknown): Plan {
  const keys = path.split(".");
  if (keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k)))
    throw Error("Invalid field");
  const next = structuredClone(p);
  let at = next;
  keys.slice(0, -1).forEach((k, i) => {
    at = at[k] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
  });
  at[keys.at(-1)!] = value;
  if (path === "event.schedule.outer_area_open")
    next.event.schedule.prefunction_open = value;
  if (path === "event.schedule.doors_open")
    next.event.schedule.general_concert_doors = value;
  if (path === "event.date" && typeof value === "string" && validDate(value))
    next.event.day_of_week = new Date(value + "T12:00:00Z")
      .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      .toLowerCase();
  return next;
}
export function updated(d: Draft, plan: Plan): Draft {
  return {
    ...d,
    plan,
    revision: d.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
export function validDate(value: string) {
  const date = new Date(value + "T12:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}
export function planShape(value: unknown): value is Plan {
  const p = value as Plan;
  return Boolean(
    p &&
      typeof p === "object" &&
      p.schema_version === "0.1" &&
      p.event &&
      Array.isArray(p.event.ticket_categories) &&
      p.event.schedule &&
      p.event.capacity &&
      p.event.audience_profile &&
      p.event.admission_planning_notes &&
      p.meta &&
      p.venue?.layout &&
      Array.isArray(p.venue.layout.gates) &&
      Array.isArray(p.staff?.roles) &&
      Array.isArray(p.staff?.shifts) &&
      Array.isArray(p.process_steps?.steps) &&
      p.demand?.arrival_windows_percent &&
      Array.isArray(p.constraints?.equipment?.items) &&
      p.constraints?.budget &&
      p.constraints?.service_targets &&
      p.constraints?.safety &&
      p.constraints?.timing,
  );
}
export function totals(p: Plan) {
  const roles = p.staff.roles as Plan[],
    gates = p.venue.layout.gates as Plan[],
    equipment = p.constraints.equipment.items as Plan[];
  const staff = roles.reduce((n, r) => n + (Number(r.count) || 0), 0),
    wages = roles.reduce(
      (n, r) =>
        n + (Number(r.count) || 0) * (Number(r.rate_idr_per_shift) || 0),
      0,
    ),
    meals = staff * (Number(p.staff.meal_allowance_idr_per_person) || 0),
    equipmentCost = equipment.reduce(
      (n, r) => n + (Number(r.committed_cost_idr) || 0),
      0,
    );
  const required: Record<string, number> = {};
  for (const point of [...gates, ...(p.venue.layout.service_points ?? [])])
    for (const l of point.lanes ?? [])
      for (const [key, value] of Object.entries(l.equipment_per_lane ?? {}))
        required[key] =
          (required[key] ?? 0) + Number(value) * Number(l.count ?? 0);
  return {
    staff,
    wages,
    meals,
    equipmentCost,
    total: wages + meals + equipmentCost,
    required,
    lanes: gates.reduce(
      (n, r) =>
        n +
        (r.lanes ?? []).reduce(
          (n: number, l: Plan) => n + Number(l.count ?? 0),
          0,
        ),
      0,
    ),
    sold: p.event.ticket_categories.reduce(
      (n: number, c: Plan) => n + Number(c.sold ?? 0),
      0,
    ),
    quota: p.event.ticket_categories.reduce(
      (n: number, c: Plan) => n + Number(c.quota ?? 0),
      0,
    ),
  };
}
export function validate(p: Plan): Issue[] {
  const issues: Issue[] = [];
  const add = (step: Step, path: string, message: string) =>
    issues.push({ step, path, message });
  const number = (
    step: Step,
    path: string,
    label: string,
    max = Infinity,
    integer = true,
  ) => {
    const v = get(p, path);
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      add(
        step,
        path,
        `${label}: enter ${max === 100 ? "0–100%" : "a valid nonnegative number"}.`,
      );
  };
  const clock = (step: Step, path: string, label: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(get(p, path) ?? ""))
      add(step, path, `Set ${label}.`);
  };
  if (!p.event.name?.trim()) add("brief", "event.name", "Enter an event name.");
  if (!validDate(p.event.date ?? ""))
    add("brief", "event.date", "Choose a valid date.");
  if (!p.venue.name?.trim())
    add("brief", "venue.name", "Choose or enter your venue.");
  for (const key of ["outer_area_open", "doors_open", "last_entry", "main_act"])
    clock("brief", `event.schedule.${key}`, key.replaceAll("_", " "));
  if (p.event.schedule.doors_open >= p.event.schedule.last_entry)
    add(
      "brief",
      "event.schedule.last_entry",
      "Last entry must be after doors open.",
    );
  for (const key of [
    "expected_attendees_estimate",
    "capacity.tickets_sold",
    "capacity.tickets_on_sale",
  ])
    number("attendance", `event.${key}`, key.replaceAll("_", " "));
  number(
    "attendance",
    "event.capacity.no_show_percent_estimate",
    "No-show estimate",
    100,
    false,
  );
  const cats = p.event.ticket_categories as Plan[],
    gates = p.venue.layout.gates as Plan[],
    roles = p.staff.roles as Plan[],
    points = [...gates, ...(p.venue.layout.service_points ?? [])],
    t = totals(p);
  if (!cats.length)
    add("attendance", "event.ticket_categories", "Add a ticket category.");
  if (new Set(cats.map((c) => c.id)).size !== cats.length)
    add(
      "attendance",
      "event.ticket_categories",
      "Category IDs must be unique.",
    );
  cats.forEach((c, i) => {
    const path = `event.ticket_categories.${i}`;
    if (!c.name?.trim())
      add("attendance", path + ".name", "Name this category.");
    for (const key of ["sold", "quota", "expected_attendees_estimate"])
      number("attendance", path + "." + key, `${c.name} ${key}`);
    if (c.sold > c.quota)
      add("attendance", path + ".sold", `${c.name}: sold exceeds quota.`);
    if (!gates.some((g) => g.id === c.entry_gate))
      add(
        "attendance",
        path + ".entry_gate",
        `${c.name}: choose an entry area.`,
      );
    const shares = Object.values(p.demand.arrival_windows_percent[c.id] ?? {});
    if (
      !shares.length ||
      shares.some((v) => typeof v !== "number" || v < 0 || v > 100) ||
      Math.abs(shares.reduce<number>((n, v) => n + Number(v), 0) - 100) > 0.001
    )
      add(
        "attendance",
        "demand.arrival_windows_percent." + c.id,
        `${c.name}: arrival shares must total 100%.`,
      );
  });
  if (
    cats.reduce((n, c) => n + Number(c.expected_attendees_estimate ?? 0), 0) !==
    p.event.expected_attendees_estimate
  )
    add(
      "attendance",
      "event.expected_attendees_estimate",
      "Category expected arrivals must equal the event expected attendance.",
    );
  if (t.sold !== p.event.capacity.tickets_sold)
    add(
      "attendance",
      "event.capacity.tickets_sold",
      "Category sold counts must equal total tickets sold.",
    );
  if (t.quota !== p.event.capacity.tickets_on_sale)
    add(
      "attendance",
      "event.capacity.tickets_on_sale",
      "Category quotas must equal total tickets on sale.",
    );
  if (!gates.length)
    add("checks", "venue.layout.gates", "Add at least one entry area.");
  gates.forEach((g, i) => {
    const path = `venue.layout.gates.${i}`;
    number("checks", path + ".max_lanes", `${g.name} lane limit`);
    clock("checks", path + ".opens", `${g.name} opening time`);
    clock("checks", path + ".closes", `${g.name} closing time`);
    if (g.opens >= g.closes)
      add("checks", path + ".closes", "Closing must be after opening.");
    const count = (g.lanes ?? []).reduce(
      (n: number, l: Plan) => n + Number(l.count ?? 0),
      0,
    );
    if (count > g.max_lanes)
      add("checks", path + ".lanes.0.count", `${g.name}: lane limit exceeded.`);
    g.lanes.forEach((l: Plan, j: number) =>
      number("checks", path + `.lanes.${j}.count`, `${g.name} active lanes`),
    );
  });
  p.process_steps.steps.forEach((s: Plan, i: number) => {
    for (const key of ["typical", "slow"])
      number(
        "checks",
        `process_steps.steps.${i}.time_per_person_seconds.${key}`,
        `${s.name} ${key}`,
        Infinity,
        false,
      );
    if (s.time_per_person_seconds.slow < s.time_per_person_seconds.typical)
      add(
        "checks",
        `process_steps.steps.${i}.time_per_person_seconds.slow`,
        "Slow time must be at least the typical time.",
      );
    if (
      s.results &&
      Number(s.results.resolved_percent) + Number(s.results.refused_percent) !==
        100
    )
      add(
        "checks",
        `process_steps.steps.${i}.results`,
        "Help-desk outcomes must total 100%.",
      );
  });
  number("resources", "staff.meal_allowance_idr_per_person", "Meal allowance");
  roles.forEach((r, i) => {
    const path = `staff.roles.${i}`;
    for (const key of ["count", "rate_idr_per_shift", "pool_limit_total"])
      number(
        "resources",
        path + "." + key,
        `${r.name} ${key.replaceAll("_", " ")}`,
      );
    if (r.count > r.pool_limit_total)
      add(
        "resources",
        path + ".count",
        `${r.name}: count exceeds available pool.`,
      );
    if (Number(r.gender?.female) + Number(r.gender?.male) !== r.count)
      add(
        "resources",
        path + ".gender.female",
        `${r.name}: team composition must equal count.`,
      );
    const assigned = (r.assignment ?? []).reduce(
      (n: number, a: Plan) => n + Number(a.count ?? 0),
      0,
    );
    if (assigned > r.count)
      add("resources", path + ".count", `${r.name}: assignments exceed count.`);
    for (const a of r.assignment ?? []) {
      const point = points.find((p) => p.id === a.point),
        shift = p.staff.shifts.find((s: Plan) => s.id === r.shift);
      if (
        !point ||
        !shift ||
        shift.start > point.opens ||
        shift.end < point.closes
      )
        add(
          "resources",
          path + ".shift",
          `${r.name}: shift must cover the assigned point.`,
        );
    }
  });
  for (const point of points)
    for (const lane of point.lanes ?? [])
      for (const step of lane.steps ?? []) {
        const coverage = roles
          .filter((r) => (r.can_do ?? []).includes(step))
          .reduce(
            (n, r) =>
              n +
              (r.assignment ?? [])
                .filter(
                  (a: Plan) =>
                    a.point === point.id && a.lane_group === lane.group,
                )
                .reduce((n: number, a: Plan) => n + Number(a.count ?? 0), 0),
            0,
          );
        if (coverage < lane.count)
          add(
            "resources",
            "staff.roles",
            `${point.name}: ${lane.count} lanes need ${lane.count} qualified staff for ${step.replaceAll("_", " ")}; ${coverage} assigned.`,
          );
      }
  p.staff.shifts.forEach((s: Plan, i: number) => {
    clock("resources", `staff.shifts.${i}.start`, "shift start");
    clock("resources", `staff.shifts.${i}.end`, "shift end");
    number("resources", `staff.shifts.${i}.meal_break_minutes`, "Meal break");
    if (s.start >= s.end)
      add(
        "resources",
        `staff.shifts.${i}.end`,
        "Shift end must be after shift start.",
      );
  });
  p.constraints.equipment.items.forEach((e: Plan, i: number) => {
    for (const key of [
      "available",
      "extra_rentable",
      "extra_cost_idr_per_unit",
      "committed_cost_idr",
      "lead_time_days",
    ])
      number(
        "resources",
        `constraints.equipment.items.${i}.${key}`,
        `${e.name} ${key.replaceAll("_", " ")}`,
      );
    if ((t.required[e.id] ?? 0) > e.available)
      add(
        "resources",
        `constraints.equipment.items.${i}.available`,
        `${e.name}: ${t.required[e.id]} required, ${e.available} available.`,
      );
  });
  for (const key of ["staff_cap_idr", "equipment_cap_idr"])
    number("targets", "constraints.budget." + key, key.replaceAll("_", " "));
  for (const [key, max] of [
    ["gate_wait.max_minutes", Infinity],
    ["gate_wait.for_share_of_visitors_percent", 100],
    ["longest_acceptable_wait_minutes", Infinity],
    ["inside_before_main_act_percent", 100],
  ] as const)
    number(
      "targets",
      "constraints.service_targets." + key,
      key.replaceAll("_", " "),
      max,
      false,
    );
  for (const key of [
    "doors_open_earliest",
    "last_entry_latest",
    "venue_slot_end",
  ])
    clock("targets", "constraints.timing." + key, key.replaceAll("_", " "));
  if (t.wages + t.meals > p.constraints.budget.staff_cap_idr)
    add(
      "targets",
      "constraints.budget.staff_cap_idr",
      "Wages and meals exceed the staff budget.",
    );
  if (t.equipmentCost > p.constraints.budget.equipment_cap_idr)
    add(
      "targets",
      "constraints.budget.equipment_cap_idr",
      "Equipment exceeds its budget.",
    );
  return issues;
}
export const clockSeconds = (clock: unknown) => {
  if (typeof clock !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))
    return NaN;
  const [h, m] = clock.split(":").map(Number);
  return h * 3600 + m * 60;
};
export function workerConfig(
  plan: Plan,
  graph: ResolvedLayoutGraph | null,
  seed: number,
): AbmConfig | null {
  if (!graph || !validDate(plan.event.date ?? "")) return null;
  const start = plan.event.schedule.arrival_generation_start ?? "09:00",
    origin = clockSeconds(start),
    end = clockSeconds(plan.event.schedule.model_end ?? "23:30");
  const cats = (plan.event.ticket_categories as Plan[]).filter(
    (c) =>
      c.entry_area_id === "plaza_utara" ||
      c.entry_gate === "proposed_gate_plaza_utara",
  );
  if (
    !cats.length ||
    !Number.isFinite(origin) ||
    !Number.isFinite(end) ||
    end <= origin
  )
    return null;
  const cohorts = cats.map((c) => ({
    id: c.id,
    count:
      c.expected_attendees_estimate ??
      Math.round(
        Number(c.sold) *
          (1 - Number(plan.event.capacity.no_show_percent_estimate ?? 0) / 100),
      ),
    arrivalNodeId: "arrival",
    destinationNodeId: "destination",
    groupSize: plan.event.audience_profile?.typical_group_size ?? 1,
    windows: Object.entries(
      plan.demand.arrival_windows_percent[c.id] ?? {},
    ).map(([key, share]) => {
      const [a, b] = key.split("-");
      return {
        startSeconds: clockSeconds(a) - origin,
        endSeconds: clockSeconds(b) - origin,
        sharePercent: Number(share),
      };
    }),
  }));
  if (
    cohorts.some(
      (c) =>
        !Number.isSafeInteger(c.count) ||
        c.count < 0 ||
        !c.windows.length ||
        c.windows.some(
          (w) =>
            !Number.isFinite(w.startSeconds) ||
            !Number.isFinite(w.endSeconds) ||
            w.startSeconds < 0 ||
            w.endSeconds <= w.startSeconds,
        ) ||
        Math.abs(c.windows.reduce((s, w) => s + w.sharePercent, 0) - 100) >
          0.001,
    )
  )
    return null;
  return {
    seed,
    timeOrigin: `${plan.event.date}T${start}:00+07:00`,
    horizonSeconds: end - origin,
    walkSpeedMps: 1.2,
    nodes: graph.nodes,
    edges: graph.edges,
    cohorts,
  };
}
export function compilePlan(
  plan: Plan,
  layout: LayoutRevision,
  graph: ResolvedLayoutGraph,
): Plan {
  const next = structuredClone(plan);
  const distances = new Map<string, number>([["queue", 0]]);
  const remaining = new Set(graph.nodes.map((n) => n.id));
  while (remaining.size) {
    const current = [...remaining].sort(
      (a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity),
    )[0];
    if (!Number.isFinite(distances.get(current))) break;
    remaining.delete(current);
    for (const e of graph.edges.filter((e) => e.from === current)) {
      const d = distances.get(current)! + e.distanceM;
      if (d < (distances.get(e.to) ?? Infinity)) distances.set(e.to, d);
    }
  }
  const path = next.venue.layout.walking_paths?.find(
    (p: Plan) =>
      p.from === "queue_plaza_utara" && p.to === "proposed_gate_plaza_utara",
  );
  if (path && distances.has("scan_checkpoint"))
    path.distance_m = Number(distances.get("scan_checkpoint")!.toFixed(3));
  next.editor_context = {
    schema_version: "opsidio-dashboard/1",
    layout: structuredClone(layout),
    resolved_graph: structuredClone(graph),
    scope: "plaza_utara",
    derived_projections_require_regeneration: true,
  };
  // Source provenance and all other areas stay intact. The authored north layout is
  // explicit in editor_context; Doni receives its projected logical route distance.
  return next;
}
export function exportJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const identity = (draft: Draft, layout: LayoutRevision) =>
  `${draft.id}:${draft.revision}:${layout.id}:${layout.revision}`;
