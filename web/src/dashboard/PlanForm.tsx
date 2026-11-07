import { useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  MapPin,
  LockKeyhole,
  CheckCircle2,
} from "lucide-react";
import { Button, Badge, Card, Notice, Heading, Forward } from "./ui";
import {
  get,
  set,
  copyDemo,
  totals,
  fmt,
  money,
  steps,
  titles,
  validate,
  exportJSON,
  type Draft,
  type Plan,
  type Step,
} from "./model";

type Props = {
  draft: Draft;
  step: Step;
  onChange: (plan: Plan) => void;
  onType: (v: "public" | "private") => void;
  onStep: (s: Step) => void;
  onHome: () => void;
  onSimulation: () => void;
};
const schedule = [
  ["Arrival generation starts", "arrival_generation_start"],
  ["Outer / prefunction area opens", "outer_area_open"],
  ["General admission opens", "doors_open"],
  ["Wristband service opens", "redemption_open"],
  ["Wristband service closes", "redemption_close"],
  ["Last entry", "last_entry"],
  ["Opening act", "opening_act"],
  ["Main act", "main_act"],
  ["Model / venue slot ends", "model_end"],
  ["Ultimate check-in", "ultimate_check_in_start"],
  ["Ultimate experience", "ultimate_experience"],
  ["Premium doors open", "premium_concert_doors"],
];
export default function PlanForm({
  draft,
  step,
  onChange,
  onType,
  onStep,
  onHome,
  onSimulation,
}: Props) {
  const p = draft.plan,
    t = totals(p),
    [errorsVisible, setErrorsVisible] = useState(false),
    [arrivalCategory, setArrivalCategory] = useState("all"),
    [cohortsOpen, setCohortsOpen] = useState(false);
  const issues = validate(p),
    sectionIssues = issues.filter((i) => i.step === step);
  const change = (path: string, value: unknown) => {
    const next = set(p, path, value);
    if (path === "venue.name") {
      next.event.venue = value;
      next.venue.id = "";
    }
    onChange(next);
  };
  function input(
    label: string,
    path: string,
    type = "number",
    options?: { label: string; value: string }[],
    hint?: string,
  ) {
    const value = get(p, path),
      error = errorsVisible
        ? issues.find((i) => i.path === path)?.message
        : undefined;
    return (
      <label className={`op-field ${error ? "invalid" : ""}`} key={path}>
        <span>{label}</span>
        {options ? (
          <select
            aria-label={label}
            value={value ?? ""}
            onChange={(e) => change(path, e.target.value)}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={label}
            aria-invalid={Boolean(error)}
            type={type}
            min={type === "number" ? 0 : undefined}
            step={type === "number" ? "any" : undefined}
            value={value ?? ""}
            onChange={(e) =>
              change(
                path,
                type === "number"
                  ? e.target.value === ""
                    ? null
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            onBlur={() => {
              if (error) setErrorsVisible(true);
            }}
          />
        )}
        {(error || hint) && (
          <small className={error ? "op-error" : ""}>{error ?? hint}</small>
        )}
      </label>
    );
  }
  function table(headers: string[], rows: React.ReactNode[][]) {
    return (
      <div className="op-table-scroll">
        <table className="op-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const estimate = (
      <Badge tone="amber">
        {draft.demo ? "Demo estimate" : "Your estimate"}
      </Badge>
    ),
    policy = <Badge tone="coral">Policy</Badge>;
  const gates = p.venue.layout.gates as Plan[],
    cats = p.event.ticket_categories as Plan[];
  const addCategory = () => {
    const next = structuredClone(p),
      id = "category_" + crypto.randomUUID();
    next.event.ticket_categories.push({
      id,
      name: "New category",
      admission: "standing",
      sold: null,
      quota: null,
      expected_attendees_estimate: null,
      entry_gate: "",
      entry_area_id: "",
    });
    next.demand.arrival_windows_percent[id] = {
      "09:00-13:00": null,
      "13:00-15:30": null,
      "15:30-17:30": null,
      "17:30-19:30": null,
    };
    onChange(next);
  };
  const addGate = () => {
    const next = structuredClone(p),
      id = "gate_" + crypto.randomUUID();
    next.venue.layout.gates.push({
      id,
      name: "New entry area",
      opens: "",
      closes: "",
      max_lanes: null,
      serves_categories: [],
      lanes: [
        {
          group: "general",
          count: null,
          steps: ["eticket_scan", "wristband_fit", "security_inspection"],
          equipment_per_lane: { handheld_scanner: 1, metal_detector_wand: 1 },
        },
      ],
    });
    onChange(next);
  };
  const setCategoryGate = (index: number, id: string) => {
    const next = structuredClone(p),
      c = next.event.ticket_categories[index];
    c.entry_gate = id;
    c.entry_area_id = id.replace(/^proposed_gate_/, "");
    for (const gate of next.venue.layout.gates)
      gate.serves_categories = next.event.ticket_categories
        .filter((c: Plan) => c.entry_gate === gate.id)
        .map((c: Plan) => c.id);
    onChange(next);
  };
  const categoryRows = (rows: Plan[]) =>
    rows.map((c) => {
      const i = cats.indexOf(c);
      return [
        input("Category name", `event.ticket_categories.${i}.name`, "text"),
        input("Admission", `event.ticket_categories.${i}.admission`, "text", [
          { label: "Standing", value: "standing" },
          { label: "Seated", value: "seated" },
        ]),
        input(`${c.name} sold`, `event.ticket_categories.${i}.sold`),
        input(`${c.name} quota`, `event.ticket_categories.${i}.quota`),
        input(
          `${c.name} expected arrivals`,
          `event.ticket_categories.${i}.expected_attendees_estimate`,
        ),
        <select
          aria-label={`${c.name} entry area`}
          value={c.entry_gate ?? ""}
          onChange={(e) => setCategoryGate(i, e.target.value)}
        >
          <option value="">Choose entry area</option>
          {gates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>,
        <button
          className="op-icon-button"
          aria-label={`Remove ${c.name}`}
          onClick={() => {
            const next = structuredClone(p);
            next.event.ticket_categories.splice(i, 1);
            delete next.demand.arrival_windows_percent[c.id];
            for (const g of next.venue.layout.gates)
              g.serves_categories = (g.serves_categories ?? []).filter(
                (id: string) => id !== c.id,
              );
            onChange(next);
          }}
        >
          <Trash2 size={15} />
        </button>,
      ];
    });
  const next = () => {
    setErrorsVisible(true);
    if (sectionIssues.length) {
      document
        .querySelector("[data-form-top]")
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    onStep(steps[steps.indexOf(step) + 1] ?? "review");
    setErrorsVisible(false);
  };
  return (
    <div data-form-top>
      <Heading
        title={
          step === "brief"
            ? "Set the context for your entry plan"
            : step === "review"
              ? "Review your entry plan"
              : "Plan your entrance operations"
        }
      >
        {step === "brief"
          ? "Add the event, venue, and operating times used to plan arrivals."
          : step === "review"
            ? "Check the inputs that will be sent with this scenario."
            : draft.demo
              ? "Review the supplied GBK demo inputs, then adjust them for your scenario."
              : "Add what you know. Keep unknown inputs in the draft."}
      </Heading>
      {["attendance", "checks", "resources", "targets"].includes(step) && (
        <>
          <nav className="op-form-tabs" aria-label="Entry operations sections">
            {steps.slice(1, 5).map((s, i) => (
              <Button
                key={s}
                primary={step === s}
                aria-current={step === s ? "step" : undefined}
                onClick={() => {
                  onStep(s);
                  setErrorsVisible(false);
                }}
              >
                {i + 1}　{titles[s]}
              </Button>
            ))}
          </nav>
          <p className="op-eyebrow">
            ENTRY OPERATIONS · {steps.indexOf(step)} OF 4
          </p>
        </>
      )}
      {errorsVisible && sectionIssues.length > 0 && (
        <Notice
          title={`Please fix ${sectionIssues.length} input${sectionIssues.length === 1 ? "" : "s"} before continuing`}
          tone="amber"
        >
          <ul>
            {sectionIssues.slice(0, 8).map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Notice>
      )}
      {step === "brief" && (
        <>
          <div
            className="op-grid two"
            role="radiogroup"
            aria-label="Venue type"
          >
            {(["public", "private"] as const).map((type) => (
              <button
                className={`op-choice ${draft.venueType === type ? "selected" : ""}`}
                role="radio"
                aria-checked={draft.venueType === type}
                key={type}
                onClick={() => onType(type)}
              >
                {type === "public" ? (
                  <MapPin size={21} />
                ) : (
                  <LockKeyhole size={21} />
                )}
                <div>
                  <strong>
                    {type === "public" ? "Public venue" : "Private venue"}
                  </strong>
                  <p>
                    {type === "public"
                      ? "Use the venue’s saved entry information"
                      : "Provide the venue and entry points"}
                  </p>
                </div>
                <span className="radio-dot" />
              </button>
            ))}
          </div>
          {draft.demo && (
            <Notice title="GBK demo · Editable assumptions">
              This is a proposed 70,000-person scenario for 14 Nov 2026. The
              2023 concert is a historical reference.
            </Notice>
          )}
          <Card
            title="Event and venue"
            tag={<Badge>{draft.demo ? "Demo example" : "Draft"}</Badge>}
          >
            <div className="op-grid two">
              {input("Event name", "event.name", "text")}
              {input("Event date", "event.date", "date")}
              {draft.venueType === "public" ? (
                <label className="op-field">
                  <span>Listed venue</span>
                  <select
                    value={p.venue.id ?? ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        const preset = copyDemo(),
                          next = structuredClone(p);
                        next.venue = preset.venue;
                        next.event.venue = preset.event.venue;
                        next.spatial_context = preset.spatial_context;
                        onChange(next);
                      }
                    }}
                  >
                    <option value="">Select venue</option>
                    <option value="gbk-osm-local">
                      Stadion Utama Gelora Bung Karno · Demo venue
                    </option>
                  </select>
                </label>
              ) : (
                input("Venue name or address", "venue.name", "text")
              )}
              {input("Timezone", "meta.timezone", "text", [
                { value: "Asia/Jakarta", label: "Asia/Jakarta · WIB (UTC+7)" },
              ])}
            </div>
            <p className="op-muted">
              {draft.venueType === "public"
                ? `${gates.length} proposed entry areas · Venue approval pending`
                : "Add the venue’s entry points in the next section."}
            </p>
          </Card>
          <Card title="Entry timing" tag={policy}>
            <div className="op-grid three">
              {schedule.map(([label, key]) =>
                input(label, "event.schedule." + key, "time"),
              )}
            </div>
            <p className="op-muted">
              All times use Asia/Jakarta. Package check-in and general gate
              opening are separate policies.
            </p>
          </Card>
        </>
      )}
      {step === "attendance" && (
        <>
          <Card title="Attendance and ticket demand" tag={estimate}>
            <div className="op-grid three">
              {input("Expected attendees", "event.expected_attendees_estimate")}
              {input("Tickets sold / issued", "event.capacity.tickets_sold")}
              {input(
                "No-show estimate (%)",
                "event.capacity.no_show_percent_estimate",
              )}
              {input(
                "Tickets on sale / quota",
                "event.capacity.tickets_on_sale",
              )}
            </div>
            <p className="op-muted">
              Expected arrivals, sold tickets and quota are separate inputs.
              Zero is an explicit estimate.
            </p>
          </Card>
          <Card
            title="Ticket categories and entry areas"
            tag={<Badge tone="amber">{fmt(t.sold)} total</Badge>}
          >
            <Button onClick={addCategory}>
              <Plus size={16} />
              Add category
            </Button>
            {table(
              [
                "Category",
                "Admission",
                "Sold",
                "Quota",
                "Expected",
                "Entry area",
                "",
              ],
              categoryRows(cats.filter((c) => !c.id.startsWith("infinity_"))),
            )}
            {cats.some((c) => c.id.startsWith("infinity_")) && (
              <details
                open={cohortsOpen}
                onToggle={(e) => setCohortsOpen(e.currentTarget.open)}
              >
                <summary>
                  Infinity ·{" "}
                  {fmt(
                    cats
                      .filter((c) => c.id.startsWith("infinity_"))
                      .reduce((s, c) => s + Number(c.sold ?? 0), 0),
                  )}{" "}
                  attendees across 9 viewing tiers
                </summary>
                <p>
                  All original cohort IDs are preserved. These counts are
                  included once in the category total.
                </p>
                {table(
                  [
                    "Viewing tier",
                    "Admission",
                    "Sold",
                    "Quota",
                    "Expected",
                    "Entry area",
                    "",
                  ],
                  categoryRows(
                    cats.filter((c) => c.id.startsWith("infinity_")),
                  ),
                )}
              </details>
            )}
            <p className="op-muted">
              {cats.length} submitted cohorts · Sold {fmt(t.sold)} /{" "}
              {fmt(p.event.capacity.tickets_sold)} · Quota {fmt(t.quota)} /{" "}
              {fmt(p.event.capacity.tickets_on_sale)}
            </p>
          </Card>
          <Card title="Arrival profile" tag={estimate}>
            <label className="op-field">
              <span>Apply profile to</span>
              <select
                value={arrivalCategory}
                onChange={(e) => setArrivalCategory(e.target.value)}
              >
                <option value="all">All ticket categories</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {table(
              ["Arrival window", "Share (%)", "Expected arrivals"],
              Object.keys(
                p.demand.arrival_windows_percent[
                  arrivalCategory === "all" ? cats[0]?.id : arrivalCategory
                ] ?? {},
              ).map((window) => {
                const selected =
                    arrivalCategory === "all"
                      ? cats
                      : cats.filter((c) => c.id === arrivalCategory),
                  values = selected.map(
                    (c) => p.demand.arrival_windows_percent[c.id]?.[window],
                  ),
                  same = values.every((v) => v === values[0]),
                  share = same ? values[0] : "";
                return [
                  window,
                  <input
                    aria-label={`${window} arrival share`}
                    type="number"
                    min="0"
                    max="100"
                    placeholder={same ? "" : "Mixed"}
                    value={share ?? ""}
                    onChange={(e) => {
                      const next = structuredClone(p);
                      for (const c of selected)
                        next.demand.arrival_windows_percent[c.id][window] =
                          e.target.value === "" ? null : Number(e.target.value);
                      onChange(next);
                    }}
                  />,
                  same && typeof share === "number"
                    ? fmt(
                        Math.round(
                          ((arrivalCategory === "all"
                            ? Number(p.event.expected_attendees_estimate)
                            : Number(selected[0]?.sold)) *
                            share) /
                            100,
                        ),
                      )
                    : "—",
                ];
              }),
            )}
            <p className="op-muted">
              Each category’s arrival shares must total 100%.
            </p>
          </Card>
          <Card title="Audience assumptions" tag={estimate}>
            <div className="op-grid three">
              {[
                ["Typical group size", "typical_group_size"],
                ["Arrive in groups (%)", "arrive_in_groups_percent"],
                ["Female attendees (%)", "female_percent"],
                ["Visitors with bags (%)", "visitors_with_bag_percent"],
                ["Locker use (%)", "visitors_using_locker_percent"],
                ["Accessible visitors (%)", "accessible_visitors_percent"],
              ].map(([l, k]) => input(l, "event.audience_profile." + k))}
            </div>
            <p className="op-muted">
              Use the expected accessibility demand for your event.
            </p>
          </Card>
        </>
      )}
      {step === "checks" && (
        <>
          <Card
            title="Entry areas and active lanes"
            tag={<Badge tone="amber">{t.lanes} active lanes</Badge>}
          >
            <Button onClick={addGate}>
              <Plus size={16} />
              Add entry area
            </Button>
            {table(
              ["Entry area", "Active lanes", "Lane limit", "Opens", "Closes"],
              gates.map((g, i) => [
                input(
                  "Entry area name",
                  `venue.layout.gates.${i}.name`,
                  "text",
                ),
                input(
                  `${g.name} active lanes`,
                  `venue.layout.gates.${i}.lanes.0.count`,
                ),
                input(
                  `${g.name} lane limit`,
                  `venue.layout.gates.${i}.max_lanes`,
                ),
                input(
                  `${g.name} opens`,
                  `venue.layout.gates.${i}.opens`,
                  "time",
                ),
                input(
                  `${g.name} closes`,
                  `venue.layout.gates.${i}.closes`,
                  "time",
                ),
              ]),
            )}
            <p className="op-muted">
              Use each gate’s approved lane limit. Demo limits still require
              venue approval.
            </p>
          </Card>
          <Card title="Checks in each admission lane" tag={estimate}>
            <p className="op-muted">
              Ticket + ID → Wristband → Security · 1 scanner + 1 detector wand
              per active lane
            </p>
            {table(
              ["Order / check", "Typical seconds", "Slow seconds"],
              p.process_steps.steps.map((s: Plan, i: number) => [
                `${i + 1}. ${s.name}`,
                input(
                  `${s.name} typical seconds`,
                  `process_steps.steps.${i}.time_per_person_seconds.typical`,
                ),
                input(
                  `${s.name} slow seconds`,
                  `process_steps.steps.${i}.time_per_person_seconds.slow`,
                ),
              ]),
            )}
          </Card>
          <Card title="Ticket help and exceptions" tag={estimate}>
            {table(
              ["Help point", "Desks", "Opens", "Closes"],
              (p.venue.layout.service_points ?? []).map(
                (s: Plan, i: number) => [
                  s.name,
                  input(
                    `${s.name} desks`,
                    `venue.layout.service_points.${i}.lanes.0.count`,
                  ),
                  input(
                    `${s.name} opens`,
                    `venue.layout.service_points.${i}.opens`,
                    "time",
                  ),
                  input(
                    `${s.name} closes`,
                    `venue.layout.service_points.${i}.closes`,
                    "time",
                  ),
                ],
              ),
            )}
            <div className="op-grid two">
              {input(
                "Resolved (%)",
                `process_steps.steps.${Math.max(
                  0,
                  p.process_steps.steps.findIndex(
                    (s: Plan) => s.id === "help_desk_resolution",
                  ),
                )}.results.resolved_percent`,
              )}
              {input(
                "Refused (%)",
                `process_steps.steps.${Math.max(
                  0,
                  p.process_steps.steps.findIndex(
                    (s: Plan) => s.id === "help_desk_resolution",
                  ),
                )}.results.refused_percent`,
              )}
            </div>
            <p className="op-muted">
              Exception arrival rate is unspecified in the supplied plan.
              Resolution outcomes do not imply a failure rate.
            </p>
          </Card>
          <Card title="Admission policies" tag={policy}>
            {input(
              "Group entry rule",
              "event.admission_planning_notes.group_policy",
              "text",
            )}
            {input(
              "Wristband collection",
              "event.admission_planning_notes.wristband_collection",
              "text",
            )}
          </Card>
        </>
      )}
      {step === "resources" && (
        <>
          <Card title="Staff shift" tag={estimate}>
            {p.staff.shifts.map((s: Plan, i: number) => (
              <div className="op-grid three" key={s.id}>
                {input("Shift starts", `staff.shifts.${i}.start`, "time")}
                {input("Shift ends", `staff.shifts.${i}.end`, "time")}
                {input(
                  "Meal break (minutes)",
                  `staff.shifts.${i}.meal_break_minutes`,
                )}
              </div>
            ))}
            {input(
              "Meal allowance per person (IDR)",
              "staff.meal_allowance_idr_per_person",
            )}
          </Card>
          <Card
            title="Staff by entry area"
            tag={<Badge tone="amber">{t.staff} people</Badge>}
          >
            <Button
              onClick={() => {
                const next = structuredClone(p);
                for (const g of gates)
                  for (const kind of ["scan", "security"]) {
                    if (
                      next.staff.roles.some(
                        (r: Plan) =>
                          r.assignment?.some((a: Plan) => a.point === g.id) &&
                          r.can_do?.includes(
                            kind === "scan"
                              ? "eticket_scan"
                              : "security_inspection",
                          ),
                      )
                    )
                      continue;
                    next.staff.roles.push({
                      id: crypto.randomUUID(),
                      name: g.name + " " + kind,
                      count: null,
                      gender: { female: null, male: null },
                      rate_idr_per_shift: null,
                      pool_limit_total: null,
                      shift: p.staff.shifts[0]?.id,
                      can_do:
                        kind === "scan"
                          ? ["eticket_scan", "wristband_fit"]
                          : ["security_inspection"],
                      assignment: [
                        {
                          point: g.id,
                          lane_group: "general",
                          per_lane: 1,
                          count: null,
                        },
                      ],
                    });
                  }
                onChange(next);
              }}
            >
              <Plus size={16} />
              Add missing gate roles
            </Button>
            {table(
              ["Role", "Count", "Female", "Male", "Rate / shift (IDR)", "Pool"],
              p.staff.roles.map((r: Plan, i: number) => [
                r.name,
                ...[
                  "count",
                  "gender.female",
                  "gender.male",
                  "rate_idr_per_shift",
                  "pool_limit_total",
                ].map((k) => input(`${r.name} ${k}`, `staff.roles.${i}.${k}`)),
              ]),
            )}
          </Card>
          <Card title="Staff assignments" tag={policy}>
            {table(
              ["Role", "Assigned point", "Assigned count"],
              p.staff.roles.flatMap((r: Plan, i: number) =>
                (r.assignment ?? []).map((a: Plan, j: number) => [
                  r.name,
                  gates.find((g) => g.id === a.point)?.name ?? a.point,
                  input(
                    `${r.name} assigned count`,
                    `staff.roles.${i}.assignment.${j}.count`,
                  ),
                ]),
              ),
            )}
            <p className="op-muted">
              Assigned staff must cover each active lane and the full opening
              hours.
            </p>
          </Card>
          <Card title="Equipment inventory" tag={estimate}>
            {p.constraints.equipment.items.map((e: Plan, i: number) => (
              <div className="op-equipment" key={e.id}>
                <h3>{e.name}</h3>
                <div className="op-grid three">
                  {[
                    ["Available", "available"],
                    ["Extra rentable", "extra_rentable"],
                    ["Rental / unit (IDR)", "extra_cost_idr_per_unit"],
                    ["Committed cost (IDR)", "committed_cost_idr"],
                    ["Lead time (days)", "lead_time_days"],
                  ].map(([l, k]) =>
                    input(l, `constraints.equipment.items.${i}.${k}`),
                  )}
                  <div className="op-stat">
                    <span>Required by active lanes</span>
                    <strong>
                      {t.required[e.id] ?? 0} / {e.available ?? "—"}
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </Card>
          <Notice title="Check resources before adding a lane">
            An extra lane needs a scanner, a detector wand, and qualified staff.
            Check availability and shift coverage together.
          </Notice>
        </>
      )}
      {step === "targets" && (
        <>
          <Card title="Entry service targets" tag={policy}>
            <div className="op-grid two">
              {input(
                "Gate wait target (minutes)",
                "constraints.service_targets.gate_wait.max_minutes",
              )}
              {input(
                "Share of visitors (%)",
                "constraints.service_targets.gate_wait.for_share_of_visitors_percent",
              )}
              {input(
                "Longest acceptable wait (minutes)",
                "constraints.service_targets.longest_acceptable_wait_minutes",
              )}
              {input(
                "Inside before main act (%)",
                "constraints.service_targets.inside_before_main_act_percent",
              )}
            </div>
          </Card>
          <Card title="Budget limits" tag={estimate}>
            <div className="op-grid two">
              {input("Staff cap (IDR)", "constraints.budget.staff_cap_idr")}
              {input(
                "Equipment cap (IDR)",
                "constraints.budget.equipment_cap_idr",
              )}
            </div>
            <p className="op-muted">
              Staff and equipment use separate budget limits. Meals count toward
              the staff cap.
            </p>
          </Card>
          <Card title="Allowed timing changes" tag={policy}>
            <div className="op-grid three">
              {input(
                "Earliest doors open",
                "constraints.timing.doors_open_earliest",
                "time",
              )}
              {input(
                "Latest last entry",
                "constraints.timing.last_entry_latest",
                "time",
              )}
              {input(
                "Venue slot ends",
                "constraints.timing.venue_slot_end",
                "time",
              )}
            </div>
          </Card>
          <Card title="Entrance queue limits" tag={policy}>
            <div className="op-grid two">
              {input(
                "Maximum queue density (people / m²)",
                "constraints.safety.max_density_persons_per_m2.queue_zones",
              )}
              <label className="op-check">
                <input
                  type="checkbox"
                  checked={Boolean(
                    p.constraints.safety.queues_must_stay_inside_queue_zones,
                  )}
                  onChange={(e) =>
                    change(
                      "constraints.safety.queues_must_stay_inside_queue_zones",
                      e.target.checked,
                    )
                  }
                />
                Keep queues inside designated zones
              </label>
            </div>
            <p className="op-muted">
              Queue geometry comes from the venue model. Confirm these limits
              with venue operations.
            </p>
          </Card>
          <Notice title="Review your entry plan">
            Check the inputs before opening the 3D view. Optimize uses the
            latest saved plan and entrance layout.
          </Notice>
        </>
      )}
      {step === "review" && (
        <>
          <Notice
            title={
              issues.length
                ? `${issues.length} inputs need attention`
                : "Plan inputs checked"
            }
            tone={issues.length ? "amber" : "success"}
          >
            {issues.length
              ? "You can keep editing your draft and explore the venue. Resolve the inputs before optimizing."
              : "Local checks passed. Venue approval and service validation still apply before an operational decision."}
          </Notice>
          {[
            [
              "Event and schedule",
              `${p.event.date || "Date not set"} · ${p.venue.name || "Venue not selected"}\n${p.event.schedule.outer_area_open || "—"} outer area · ${p.event.schedule.doors_open || "—"} gates · ${p.event.schedule.main_act || "—"} main act`,
              "brief",
            ],
            [
              "Attendance and arrivals",
              `${fmt(p.event.capacity.tickets_sold)} sold · ${p.event.capacity.no_show_percent_estimate ?? "—"}% no-show · ${cats.length} cohorts`,
              "attendance",
            ],
            [
              "Entry areas and checks",
              `${gates.length} entry areas · ${t.lanes} active lanes\nTicket + ID → Wristband → Security`,
              "checks",
            ],
            [
              "People and equipment",
              `${t.staff} staff · ${p.staff.shifts[0]?.start || "—"}–${p.staff.shifts[0]?.end || "—"}\n${p.constraints.equipment.items.map((e: Plan) => `${e.available ?? "—"} ${e.name}`).join(" · ")}`,
              "resources",
            ],
            [
              "Targets and budgets",
              `${p.constraints.service_targets.gate_wait.for_share_of_visitors_percent ?? "—"}% wait ≤${p.constraints.service_targets.gate_wait.max_minutes ?? "—"} min\nStaff ${money(p.constraints.budget.staff_cap_idr ?? 0)} · equipment ${money(p.constraints.budget.equipment_cap_idr ?? 0)}`,
              "targets",
            ],
          ].map(([title, summary, s]) => (
            <Card
              title={title}
              key={s}
              action={<Button onClick={() => onStep(s as Step)}>Edit</Button>}
            >
              <p className="op-summary">{summary}</p>
              {issues
                .filter((i) => i.step === s)
                .slice(0, 3)
                .map((i, n) => (
                  <p key={n} className="op-error">
                    {i.message}
                  </p>
                ))}
            </Card>
          ))}
          <Card title="Planned resource cost" tag={<Badge>Calculated</Badge>}>
            {table(
              ["Cost item", "Amount (IDR)"],
              [
                ["Staff shifts", money(t.wages)],
                ["Meal allowances", money(t.meals)],
                ["Committed equipment", money(t.equipmentCost)],
                ["Total planned cost", <strong>{money(t.total)}</strong>],
              ],
            )}
            <p className="op-muted">
              Calculated from inputs. Additional rentals and optimization
              changes are not included.
            </p>
          </Card>
        </>
      )}
      <footer className="op-form-actions">
        <Button
          onClick={() =>
            step === "brief" ? onHome() : onStep(steps[steps.indexOf(step) - 1])
          }
        >
          <ArrowLeft size={16} />
          {step === "brief" ? "Back to home" : "Back"}
        </Button>
        <div>
          {step === "review" ? (
            <>
              <Button onClick={() => exportJSON(p, "opsidio-plan.json")}>
                Export plan
              </Button>
              <Button primary onClick={onSimulation}>
                Open 3D simulation <Forward />
              </Button>
            </>
          ) : (
            <Button primary onClick={next}>
              {step === "targets"
                ? "Review entry plan"
                : `Continue to ${titles[steps[steps.indexOf(step) + 1]].toLowerCase()}`}
              <Forward />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
