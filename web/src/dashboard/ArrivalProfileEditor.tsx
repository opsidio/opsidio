import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "./ui";
import FormField, {
  FieldMessage,
  RequiredMark,
  useFormValidation,
} from "./FormField";
import TimeField from "./TimeField";
import {
  arrivalMessage,
  arrivalSummary,
  evenArrivalProfile,
  fmt,
  replaceArrivalProfiles,
  type ArrivalProfile,
  type Plan,
} from "./model";
type Props = { plan: Plan; onChange: (plan: Plan) => void };
const percent = (value: number) => Number(value.toFixed(3));
export default function ArrivalProfileEditor({ plan, onChange }: Props) {
  const context = useFormValidation(),
    root = useRef<HTMLDivElement>(null),
    [category, setCategory] = useState("all"),
    [message, setMessage] = useState(""),
    [actionError, setActionError] = useState("");
  const cats = plan.event.ticket_categories as Plan[],
    prefix = "demand.arrival_windows_percent.";
  useEffect(() => {
    if (context?.focusPath.startsWith(prefix)) {
      const id = context.focusPath.slice(prefix.length);
      if (cats.some((c) => c.id === id)) {
        setCategory(id);
        const timer = setTimeout(() => {
          const input = root.current?.querySelector<HTMLElement>(
            "input[type=number],button",
          );
          input?.scrollIntoView({ behavior: "smooth", block: "center" });
          input?.focus({ preventScroll: true });
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [context?.focusPath, context?.attempt]);
  const selectedId =
      category === "all" || cats.some((c) => c.id === category)
        ? category
        : "all",
    selected =
      selectedId === "all" ? cats : cats.filter((c) => c.id === selectedId),
    profiles = plan.demand.arrival_windows_percent as Record<
      string,
      ArrivalProfile
    >;
  const windows = [
      ...new Set(selected.flatMap((c) => Object.keys(profiles[c.id] ?? {}))),
    ],
    mixedTimes =
      selected.length > 1 &&
      new Set(
        selected.map((c) =>
          Object.keys(profiles[c.id] ?? {})
            .sort()
            .join("|"),
        ),
      ).size > 1;
  const ready =
      selected.length > 0 &&
      selected.every((c) => arrivalSummary(profiles[c.id]).complete),
    estimate = evenArrivalProfile(plan.event.schedule);
  const visibleTotals =
      selectedId === "all" && selected.length > 1
        ? selected.filter((c) => !arrivalSummary(profiles[c.id]).complete)
        : selected,
    scope = selectedId === "all" ? "all categories" : selected[0]?.name;
  function update(change: (profile: ArrivalProfile) => ArrivalProfile) {
    const next = structuredClone(plan);
    for (const c of selected)
      next.demand.arrival_windows_percent[c.id] = change({ ...profiles[c.id] });
    onChange(next);
    setMessage("");
    setActionError("");
  }
  function rename(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    if (selected.some((c) => Object.hasOwn(profiles[c.id] ?? {}, newKey))) {
      setActionError(
        "That time period already exists. Edit its percentage instead.",
      );
      return;
    }
    update((profile) => {
      const rows = Object.entries(profile);
      if (!Object.hasOwn(profile, oldKey)) rows.push([oldKey, null]);
      return Object.fromEntries(
        rows.map(([key, value]) => [key === oldKey ? newKey : key, value]),
      );
    });
  }
  return (
    <div
      ref={root}
      data-field-path={
        prefix + (selectedId === "all" ? (selected[0]?.id ?? "") : selectedId)
      }
    >
      <Card
        title="When will guests arrive?"
        tag={
          <Badge tone={ready ? "green" : "amber"}>
            {ready ? "100% accounted for" : "Required estimate"}
          </Badge>
        }
      >
        <p className="op-muted">
          Split your guests across arrival times.{" "}
          <strong>100% means every expected guest is counted once.</strong> For
          example, 25% means 25 out of every 100 guests arrive in that period.
        </p>
        {!cats.length ? (
          <p className="op-muted">
            Add a ticket category above to estimate when its guests will arrive.
          </p>
        ) : (
          <>
            <FormField label="Whose arrival times are you editing?">
              {(attrs) => (
                <select
                  {...attrs}
                  value={selectedId}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setMessage("");
                    setActionError("");
                  }}
                >
                  <option value="all">All ticket categories together</option>
                  {cats.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <div className="op-arrival-estimate">
              <div>
                <strong>Not sure yet?</strong>
                <p>
                  Use an even split between your arrival start and last-entry
                  times, then adjust it. This is an editable starting estimate.
                </p>
              </div>
              <Button
                disabled={!estimate}
                onClick={() => {
                  if (estimate) {
                    onChange(
                      replaceArrivalProfiles(
                        plan,
                        selected.map((c) => c.id),
                        estimate,
                      ),
                    );
                    setActionError("");
                    setMessage(
                      `Even-split estimate applied to ${scope}. You can change it below.`,
                    );
                  }
                }}
              >
                Use even split
              </Button>
              {!estimate && (
                <small>
                  Set arrival start and last-entry times in Event brief to use
                  this estimate, or add times below.
                </small>
              )}
            </div>
            <p className="op-arrival-scope">
              Changes below apply to <strong>{scope}</strong>. “Varies” means
              categories have different estimates.
            </p>
            {mixedTimes ? (
              <p className="op-arrival-empty">
                Choose a category to edit its different arrival times, or use
                the even split to give every category the same pattern.
              </p>
            ) : windows.length > 0 ? (
              <div className="op-table-scroll">
                <table className="op-table op-arrival-table">
                  <thead>
                    <tr>
                      <th>
                        From
                        <RequiredMark />
                      </th>
                      <th>
                        Until
                        <RequiredMark />
                      </th>
                      <th>
                        Guests arriving (%)
                        <RequiredMark />
                      </th>
                      <th>Expected guests</th>
                      <th>
                        <span className="op-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.map((window, i) => {
                      const [start = "", end = ""] = window.split("-"),
                        values = selected.map((c) => profiles[c.id]?.[window]),
                        same = values.every((v) => v === values[0]),
                        rowPath = prefix + selectedId + `.periods.${i}`;
                      const known = selected.every(
                          (c, j) =>
                            typeof c.expected_attendees_estimate === "number" &&
                            typeof values[j] === "number" &&
                            Number.isFinite(values[j]),
                        ),
                        expected = known
                          ? Math.round(
                              selected.reduce(
                                (sum, c, j) =>
                                  sum +
                                  (c.expected_attendees_estimate *
                                    Number(values[j])) /
                                    100,
                                0,
                              ),
                            )
                          : null;
                      return (
                        <tr key={i}>
                          <td>
                            <TimeField
                              path={rowPath + ".start"}
                              label={`Arrival period ${i + 1} start`}
                              value={start}
                              required
                              compact
                              onChange={(value) =>
                                rename(window, `${value}-${end}`)
                              }
                            />
                          </td>
                          <td>
                            <TimeField
                              path={rowPath + ".end"}
                              label={`Arrival period ${i + 1} end`}
                              value={end}
                              required
                              compact
                              onChange={(value) =>
                                rename(window, `${start}-${value}`)
                              }
                            />
                          </td>
                          <td>
                            <FormField
                              path={rowPath + ".share"}
                              label={`Arrival period ${i + 1} percentage`}
                              value={same ? values[0] : 100}
                              required
                            >
                              {(attrs) => (
                                <input
                                  {...attrs}
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="any"
                                  placeholder={
                                    same ? "Not estimated" : "Varies"
                                  }
                                  value={same ? (values[0] ?? "") : ""}
                                  onChange={(e) =>
                                    update((profile) => ({
                                      ...profile,
                                      [window]:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    }))
                                  }
                                />
                              )}
                            </FormField>
                          </td>
                          <td>{expected === null ? "—" : fmt(expected)}</td>
                          <td>
                            <button
                              className="op-icon-button"
                              aria-label={`Remove arrival period ${i + 1}`}
                              onClick={() =>
                                update((profile) =>
                                  Object.fromEntries(
                                    Object.entries(profile).filter(
                                      ([key]) => key !== window,
                                    ),
                                  ),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="op-arrival-empty">
                No arrival times yet. Use the even split or add a time period.
              </p>
            )}
            {!mixedTimes && (
              <Button
                onClick={() => {
                  if (windows.includes("-")) {
                    setActionError(
                      "Complete the blank start and end times before adding another period.",
                    );
                    return;
                  }
                  update((profile) => ({ ...profile, "-": null }));
                }}
              >
                <Plus size={15} />
                Add arrival period
              </Button>
            )}
            {ready && selected.length > 1 && (
              <p className="op-success" role="status">
                <CheckCircle2 size={16} />
                All {selected.length} categories account for 100% of their
                guests.
              </p>
            )}
            <div className="op-arrival-totals" aria-live="polite">
              {visibleTotals.map((c) => {
                const summary = arrivalSummary(profiles[c.id]);
                return (
                  <div
                    key={c.id}
                    className={summary.complete ? "complete" : ""}
                  >
                    <strong>{c.name}</strong>
                    <span>
                      {summary.complete && <CheckCircle2 size={15} />}
                      <b>{percent(summary.total)}% assigned</b>
                      {!summary.complete && (
                        <span>
                          {" "}
                          ·{" "}
                          {summary.total <= 100
                            ? `${percent(100 - summary.total)}% left`
                            : `${percent(summary.total - 100)}% too much`}
                        </span>
                      )}
                    </span>
                    <FieldMessage
                      error={
                        context?.submitted && !summary.complete
                          ? arrivalMessage(profiles[c.id])
                          : undefined
                      }
                      hint={
                        !context?.submitted || summary.complete
                          ? arrivalMessage(profiles[c.id])
                          : undefined
                      }
                    />
                    {selected.length > 1 && (
                      <Button onClick={() => setCategory(c.id)}>
                        Edit {c.name}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <FieldMessage error={actionError} />
            {message && (
              <p className="op-arrival-feedback" role="status">
                {message}
              </p>
            )}
            <p className="op-muted">
              Complete every arrival period and make each category total 100%
              before continuing.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
