import { useId, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "./ui";
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
  const [category, setCategory] = useState("all"),
    [message, setMessage] = useState("");
  const helpId = useId(),
    cats = plan.event.ticket_categories as Plan[];
  const selectedId =
    category === "all" || cats.some((c) => c.id === category)
      ? category
      : "all";
  const selected =
    selectedId === "all" ? cats : cats.filter((c) => c.id === selectedId);
  const profiles = plan.demand.arrival_windows_percent as Record<
    string,
    ArrivalProfile
  >;
  const windows = [
    ...new Set(selected.flatMap((c) => Object.keys(profiles[c.id] ?? {}))),
  ];
  const mixedTimes =
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
    selected.every((c) => arrivalSummary(profiles[c.id]).complete);
  const estimate = evenArrivalProfile(plan.event.schedule);
  const visibleTotals =
    selectedId === "all" && selected.length > 1
      ? selected.filter((c) => !arrivalSummary(profiles[c.id]).complete)
      : selected;
  const scope = selectedId === "all" ? "all categories" : selected[0]?.name;
  function update(change: (profile: ArrivalProfile) => ArrivalProfile) {
    const next = structuredClone(plan);
    for (const c of selected)
      next.demand.arrival_windows_percent[c.id] = change({ ...profiles[c.id] });
    onChange(next);
    setMessage("");
  }
  function rename(oldKey: string, newKey: string) {
    if (oldKey === newKey) return;
    if (selected.some((c) => Object.hasOwn(profiles[c.id] ?? {}, newKey))) {
      setMessage(
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
    <Card
      title="When will guests arrive?"
      tag={
        <Badge tone={ready ? "green" : "amber"}>
          {ready ? "100% accounted for" : "Estimate · can finish later"}
        </Badge>
      }
    >
      <p id={helpId} className="op-muted">
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
          <label className="op-field">
            <span>Whose arrival times are you editing?</span>
            <select
              value={selectedId}
              onChange={(e) => {
                setCategory(e.target.value);
                setMessage("");
              }}
            >
              <option value="all">All ticket categories together</option>
              {cats.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
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
                Set the arrival start and last-entry times in Event brief to use
                this estimate, or add times below.
              </small>
            )}
          </div>
          <p className="op-arrival-scope">
            Changes below apply to <strong>{scope}</strong>. “Varies” means
            categories currently have different estimates.
          </p>
          {mixedTimes ? (
            <p className="op-arrival-empty">
              These categories use different arrival times. Choose a category
              above to edit its times, or use the even split to give all
              categories the same pattern.
            </p>
          ) : windows.length > 0 ? (
            <div className="op-table-scroll">
              <table className="op-table op-arrival-table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Until</th>
                    <th>Guests arriving (%)</th>
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
                      same = values.every((v) => v === values[0]);
                    const rowKnown = selected.every(
                      (c, j) =>
                        typeof c.expected_attendees_estimate === "number" &&
                        typeof values[j] === "number" &&
                        Number.isFinite(values[j]),
                    );
                    const expected = rowKnown
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
                          <input
                            aria-label={`Arrival period ${i + 1} start`}
                            type="time"
                            value={start}
                            onChange={(e) =>
                              rename(window, `${e.target.value}-${end}`)
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Arrival period ${i + 1} end`}
                            type="time"
                            value={end}
                            onChange={(e) =>
                              rename(window, `${start}-${e.target.value}`)
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Arrival period ${i + 1} percentage`}
                            aria-describedby={helpId}
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            placeholder={same ? "Not estimated" : "Varies"}
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
              No arrival times estimated yet. Use the even split or add your own
              time period.
            </p>
          )}
          {!mixedTimes && (
            <Button
              onClick={() => {
                if (windows.includes("-")) {
                  setMessage(
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
              All {selected.length} categories account for 100% of their guests.
            </p>
          )}
          <div className="op-arrival-totals" aria-live="polite">
            {visibleTotals.map((c) => {
              const summary = arrivalSummary(profiles[c.id]);
              return (
                <div key={c.id} className={summary.complete ? "complete" : ""}>
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
                  <small>{arrivalMessage(profiles[c.id])}</small>
                  {selected.length > 1 && (
                    <Button onClick={() => setCategory(c.id)}>
                      Edit {c.name}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {message && (
            <p className="op-arrival-feedback" role="status">
              {message}
            </p>
          )}
          <p className="op-muted">
            You can continue planning with this unfinished. Arrival times and
            percentages must be complete before Optimize.
          </p>
        </>
      )}
    </Card>
  );
}
