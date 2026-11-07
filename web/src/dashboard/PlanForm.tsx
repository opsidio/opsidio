import { isValidElement, useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, MapPin, LockKeyhole } from "lucide-react";
import {
  Button,
  Badge,
  Card,
  Notice,
  Heading,
  Forward,
  GbkDemoLink,
} from "./ui";
import ArrivalProfileEditor from "./ArrivalProfileEditor";
import TimeField from "./TimeField";
import FormField, {
  FieldMessage,
  FormValidationContext,
  RequiredMark,
  focusField,
} from "./FormField";
import StaffAssignments from "./StaffAssignments";
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
  isRequiredField,
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
  validationAttempt?: number;
};
const scheduleGroups = [
  {
    title: "Arrivals & admission",
    fields: [
      [
        "Guests start arriving",
        "arrival_generation_start",
        "First arrivals outside the venue.",
      ],
      [
        "Outer area opens",
        "outer_area_open",
        "Waiting areas and pre-event activities.",
      ],
      [
        "Entrance gates open",
        "doors_open",
        "Guests can enter the event space.",
      ],
      ["Last admission", "last_entry", "Final time guests may enter."],
    ],
  },
  {
    title: "Show & closing",
    fields: [
      ["Opening act (optional)", "opening_act", ""],
      ["Main performance", "main_act", ""],
      ["Venue closes", "model_end", "Latest time included in this plan."],
    ],
  },
];
const specialAccess = [
  ["Wristband service opens", "redemption_open"],
  ["Wristband service closes", "redemption_close"],
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
  validationAttempt = 0,
}: Props) {
  const p = draft.plan,
    t = totals(p),
    [touched, setTouched] = useState<Set<string>>(() => new Set()),
    [cohortsOpen, setCohortsOpen] = useState(false),
    [submitted, setSubmitted] = useState(Boolean(validationAttempt)),
    [focusPath, setFocusPath] = useState(""),
    [attempt, setAttempt] = useState(0);

  const issues = validate(p),
    sectionIssues = issues.filter((i) => i.step === step);
  useEffect(() => {
    if (validationAttempt) {
      setSubmitted(true);
      const first = issues.find((i) => i.step === step);
      if (first) {
        setFocusPath(first.path);
        setAttempt((n) => n + 1);
      }
    }
  }, [validationAttempt, step]);
  useEffect(() => {
    if (attempt && focusPath) {
      const frame = requestAnimationFrame(() => focusField(focusPath));
      return () => cancelAnimationFrame(frame);
    }
  }, [attempt, focusPath]);
  const reveal = (path: string) => {
    setFocusPath(path);
    setAttempt((n) => n + 1);
  };
  const check = () => {
    setSubmitted(true);
    if (sectionIssues.length) {
      reveal(sectionIssues[0].path);
      return false;
    }
    return true;
  };

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
      required = isRequiredField(path, p);
    if (type === "time")
      return (
        <TimeField
          key={path}
          path={path}
          label={label}
          value={value ?? ""}
          required={required}
          onChange={(value) => change(path, value)}
          hint={hint}
          compact={path.startsWith("venue.layout.")}
        />
      );
    return (
      <FormField
        key={path}
        path={path}
        value={value}
        required={required}
        label={label}
        hint={hint}
      >
        {(attrs) =>
          options ? (
            <select
              {...attrs}
              value={value ?? ""}
              onChange={(e) => change(path, e.target.value)}
            >
              <option value="">Choose…</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              {...attrs}
              type={type}
              min={type === "number" ? 0 : undefined}
              step={type === "number" ? "any" : undefined}
              value={value ?? ""}
              onBlur={(event) => {
                if (
                  type === "date" &&
                  event.currentTarget.value !== (value ?? "")
                )
                  change(path, event.currentTarget.value);
                attrs.onBlur();
              }}
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
            />
          )
        }
      </FormField>
    );
  }

  function table(headers: string[], rows: React.ReactNode[][]) {
    return (
      <div className="op-table-scroll">
        <table className="op-table">
          <thead>
            <tr>
              {headers.map((h, index) => (
                <th key={h}>
                  {h}
                  {rows.some(
                    (row) =>
                      isValidElement<{ required?: boolean }>(row[index]) &&
                      row[index].props.required,
                  ) && <RequiredMark />}
                </th>
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
      name: cats.length ? "New category" : "General",
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
        <FormField
          label={`${c.name} entry area`}
          path={`event.ticket_categories.${i}.entry_gate`}
          value={c.entry_gate}
          required
        >
          {(attrs) => (
            <select
              {...attrs}
              value={c.entry_gate ?? ""}
              onChange={(e) => setCategoryGate(i, e.target.value)}
            >
              <option value="">Choose entry area</option>
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </FormField>,
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
    if (!check()) return;
    onStep(steps[steps.indexOf(step) + 1] ?? "review");
  };
  return (
    <FormValidationContext.Provider
      value={{
        plan: p,
        issues,
        submitted,
        focusPath,
        attempt,
        touched,
        touch: (path) => setTouched((current) => new Set([...current, path])),
      }}
    >
      <div data-form-top>
        <Heading
          title={
            step === "brief"
              ? "Set the context for your entry plan"
              : step === "review"
                ? "Review your entry plan"
                : {
                    attendance: "How many guests will arrive?",
                    checks: "How will guests enter?",
                    resources: "Who and what do you need?",
                    targets: "What should a smooth entrance look like?",
                  }[step]
          }
          action={<GbkDemoLink />}
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
            <nav
              className="op-form-tabs"
              aria-label="Entry operations sections"
            >
              {steps.slice(1, 5).map((s, i) => (
                <Button
                  key={s}
                  primary={step === s}
                  aria-current={step === s ? "step" : undefined}
                  onClick={() => {
                    if (steps.indexOf(s) > steps.indexOf(step) && !check())
                      return;
                    onStep(s);
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
        {step !== "review" && (
          <p className="op-draft-guidance">
            Fields marked <RequiredMark /> are required. Complete this section
            before continuing; your draft is saved as you work.
          </p>
        )}
        {submitted && sectionIssues.length > 0 && (
          <div className="op-validation-summary" role="alert">
            <strong>
              Fix {sectionIssues.length}{" "}
              {sectionIssues.length === 1 ? "item" : "items"} to continue
            </strong>
            <p>Review the highlighted fields below.</p>
            <ul>
              {sectionIssues.slice(0, 8).map((issue, i) => (
                <li key={i}>
                  <button type="button" onClick={() => reveal(issue.path)}>
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
            {sectionIssues.length > 8 && (
              <small>
                {sectionIssues.length - 8} more{" "}
                {sectionIssues.length - 8 === 1 ? "item is" : "items are"}{" "}
                highlighted in this section.
              </small>
            )}
          </div>
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
                  <FormField
                    label="Listed venue"
                    path="venue.name"
                    value={p.venue.name}
                    required
                  >
                    {(attrs) => (
                      <select
                        {...attrs}
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
                    )}
                  </FormField>
                ) : (
                  input("Venue name or address", "venue.name", "text")
                )}
                {input("Timezone", "meta.timezone", "text", [
                  {
                    value: "Asia/Jakarta",
                    label: "Asia/Jakarta · WIB (UTC+7)",
                  },
                ])}
              </div>
              <p className="op-muted">
                {draft.venueType === "public"
                  ? `${gates.length} proposed entry areas · Venue approval pending`
                  : "Add the venue’s entry points in the next section."}
              </p>
            </Card>
            <Card title="Event day timeline" tag={<Badge>WIB · UTC+7</Badge>}>
              <p className="op-muted">
                Type a time such as <strong>17:30</strong> or{" "}
                <strong>5:30 pm</strong>, or choose from the dropdown. Times are
                saved in 24-hour format for {p.event.date || "your event date"}.
              </p>
              {scheduleGroups.map((group) => (
                <section className="op-timing-section" key={group.title}>
                  <h3>{group.title}</h3>
                  <div className="op-grid two">
                    {group.fields.map(([label, key, hint]) =>
                      input(
                        label,
                        "event.schedule." + key,
                        "time",
                        undefined,
                        hint,
                      ),
                    )}
                  </div>
                </section>
              ))}
              <details className="op-special-times">
                <summary>
                  Wristbands & special access <span>Optional times</span>
                </summary>
                <p className="op-muted">
                  Use these when wristband collection, premium entry, or a
                  package experience happens separately. Existing times stay
                  saved.
                </p>
                <div className="op-grid two">
                  {specialAccess.map(([label, key]) =>
                    input(label, "event.schedule." + key, "time"),
                  )}
                </div>
              </details>
            </Card>
          </>
        )}
        {step === "attendance" && (
          <>
            <Card title="Attendance and ticket demand" tag={estimate}>
              <div className="op-grid three">
                {input(
                  "Expected attendees",
                  "event.expected_attendees_estimate",
                )}
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
                Expected attendees is your forecast; sold tickets is the number
                already issued; quota is the number offered. The category rows
                below should add up to these totals. Leave unknown numbers
                blank; use zero only when you mean none.
              </p>
            </Card>
            <Card
              fieldPath="event.ticket_categories"
              title={
                <>
                  Ticket categories and entry areas
                  <RequiredMark />
                </>
              }
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
            <ArrivalProfileEditor plan={p} onChange={onChange} />
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
            <div className="op-entry-guide" aria-label="How entry works">
              {[
                ["1", "Ticket check", "Staff check the guest’s ticket and ID."],
                [
                  "2",
                  "Wristband",
                  "Staff fit the wristband for the guest’s category.",
                ],
                [
                  "3",
                  "Security",
                  "Security staff check the guest and their belongings.",
                ],
              ].map(([number, title, text]) => (
                <div key={number}>
                  <span>{number}</span>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <Card
              fieldPath="venue.layout.gates"
              title={
                <>
                  Entrances and queue lanes
                  <RequiredMark />
                </>
              }
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
                An entrance can have several lanes working in parallel. “Active
                lanes” means how many are open; “Lane limit” is the most the
                entrance can support.
              </p>
            </Card>
            <Card title="Checks in each admission lane" tag={estimate}>
              <p className="op-muted">
                Enter how many seconds one guest usually needs for each check,
                and a slower estimate for busy periods. Each active lane needs a
                ticket scanner, a detector wand, and staff.
              </p>
              {table(
                ["Check", "Usual time (seconds)", "Slower time (seconds)"],
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
                    input(
                      "Help point name",
                      `venue.layout.service_points.${i}.name`,
                      "text",
                    ),
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
                These desks help guests whose tickets need extra attention.
                “Resolved” is the share allowed to continue after help;
                “Refused” is the share unable to enter. Together they account
                for all guests who visit the help desk (100%).
              </p>
            </Card>
            <Card title="Admission policies" tag={policy}>
              {input(
                "Group entry rule",
                "event.admission_planning_notes.group_policy",
                "text",
                [
                  {
                    label:
                      "Guests who bought together enter with the registered ticket holder",
                    value:
                      "tickets_purchased_together_enter_with_registered_holder",
                  },
                  ...(![
                    "tickets_purchased_together_enter_with_registered_holder",
                    undefined,
                    "",
                  ].includes(p.event.admission_planning_notes.group_policy)
                    ? [
                        {
                          label:
                            p.event.admission_planning_notes.group_policy.replaceAll(
                              "_",
                              " ",
                            ),
                          value: p.event.admission_planning_notes.group_policy,
                        },
                      ]
                    : []),
                ],
              )}
              {input(
                "Wristband collection",
                "event.admission_planning_notes.wristband_collection",
                "text",
                [
                  {
                    label: "At the guest’s assigned entrance, during admission",
                    value: "during_admission_at_the_category_entry_area",
                  },
                  ...(![
                    "during_admission_at_the_category_entry_area",
                    undefined,
                    "",
                  ].includes(
                    p.event.admission_planning_notes.wristband_collection,
                  )
                    ? [
                        {
                          label:
                            p.event.admission_planning_notes.wristband_collection.replaceAll(
                              "_",
                              " ",
                            ),
                          value:
                            p.event.admission_planning_notes
                              .wristband_collection,
                        },
                      ]
                    : []),
                ],
              )}
            </Card>
          </>
        )}
        {step === "resources" && (
          <>
            <p className="op-draft-guidance">
              Set the hours your team can work, then assign people to each
              entrance. Each open lane needs qualified staff for ticket checks,
              wristbands, and security.
            </p>
            <Card
              title="Staff shifts"
              tag={estimate}
              action={
                <Button
                  onClick={() => {
                    const next = structuredClone(p);
                    next.staff.shifts.push({
                      id: "shift_" + crypto.randomUUID(),
                      name: `Shift ${p.staff.shifts.length + 1}`,
                      start: "",
                      end: "",
                      meal_break_minutes: null,
                    });
                    onChange(next);
                  }}
                >
                  <Plus size={15} />
                  Add shift
                </Button>
              }
            >
              {p.staff.shifts.map((s: Plan, i: number) => {
                const used = p.staff.roles.some(
                  (role: Plan) => role.shift === s.id,
                );
                return (
                  <section className="op-shift-row" key={s.id}>
                    <header>
                      <strong>{s.name ?? `Shift ${i + 1}`}</strong>
                      <Button
                        disabled={used}
                        title={
                          used
                            ? "Reassign roles before removing this shift"
                            : undefined
                        }
                        onClick={() => {
                          const next = structuredClone(p);
                          next.staff.shifts.splice(i, 1);
                          onChange(next);
                        }}
                      >
                        <Trash2 size={14} />
                        Remove shift
                      </Button>
                    </header>
                    <div className="op-grid three">
                      {input("Shift starts", `staff.shifts.${i}.start`, "time")}
                      {input("Shift ends", `staff.shifts.${i}.end`, "time")}
                      {input(
                        "Meal break (minutes)",
                        `staff.shifts.${i}.meal_break_minutes`,
                      )}
                    </div>
                  </section>
                );
              })}
              {input(
                "Meal allowance per person (IDR)",
                "staff.meal_allowance_idr_per_person",
              )}
            </Card>
            <Card
              fieldPath="staff.roles"
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
              <p className="op-muted">
                Count is the team you plan to use. Female + male should equal
                that count. Available staff is the maximum number you can source
                for this role.
              </p>
              {table(
                [
                  "Role",
                  "Count",
                  "Female",
                  "Male",
                  "Rate / shift (IDR)",
                  "Available staff",
                  "Shift",
                ],
                p.staff.roles.map((r: Plan, i: number) => [
                  input(`${r.name} role name`, `staff.roles.${i}.name`, "text"),
                  ...[
                    "count",
                    "gender.female",
                    "gender.male",
                    "rate_idr_per_shift",
                    "pool_limit_total",
                  ].map((k) =>
                    input(`${r.name} ${k}`, `staff.roles.${i}.${k}`),
                  ),
                  input(
                    `${r.name} shift`,
                    `staff.roles.${i}.shift`,
                    "text",
                    p.staff.shifts.map((shift: Plan, j: number) => ({
                      label: shift.name ?? `Shift ${j + 1}`,
                      value: shift.id,
                    })),
                  ),
                ]),
              )}
            </Card>
            <StaffAssignments plan={p} onChange={onChange} />
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
              An extra lane needs a scanner, a detector wand, and qualified
              staff. Check availability and shift coverage together.
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
                Staff and equipment use separate budget limits. Meals count
                toward the staff cap.
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
                ? "Complete the required inputs before opening the simulation."
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
                    <FieldMessage key={n} error={i.message} />
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
              step === "brief"
                ? onHome()
                : onStep(steps[steps.indexOf(step) - 1])
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
    </FormValidationContext.Provider>
  );
}
