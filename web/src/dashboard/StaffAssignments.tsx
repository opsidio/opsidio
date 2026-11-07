import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "./ui";
import {
  addStaffAssignment,
  changeStaffAssignment,
  displayTime,
  fmt,
  moveStaffAssignment,
  removeStaffAssignment,
  set,
  validate,
  type Plan,
} from "./model";
const names: Record<string, string> = {
  eticket_scan: "Ticket checks",
  wristband_fit: "Wristbands",
  security_inspection: "Security checks",
  help_desk_resolution: "Ticket help",
};
const laneName = (group: string) =>
  group === "general"
    ? "Admission lanes"
    : group === "desk"
      ? "Help desks"
      : group.replaceAll("_", " ");
export default function StaffAssignments({
  plan,
  onChange,
}: {
  plan: Plan;
  onChange: (plan: Plan) => void;
}) {
  const roles = plan.staff.roles as Plan[],
    points = [
      ...plan.venue.layout.gates,
      ...(plan.venue.layout.service_points ?? []),
    ] as Plan[],
    shifts = plan.staff.shifts as Plan[];
  const [addRole, setAddRole] = useState(roles[0]?.id ?? ""),
    [expanded, setExpanded] = useState<Set<string>>(
      () => new Set(roles[0] ? [roles[0].id + ":0"] : []),
    );
  const roleForNew = roles.some((r) => r.id === addRole)
    ? addRole
    : (roles[0]?.id ?? "");
  const rows = roles.flatMap((role, roleIndex) =>
    (role.assignment ?? []).map((assignment: Plan, index: number) => ({
      role,
      roleIndex,
      assignment,
      index,
    })),
  );
  const planned = roles.reduce((n, r) => n + Number(r.count ?? 0), 0),
    assigned = rows.reduce((n, r) => n + Number(r.assignment.count ?? 0), 0),
    unassigned = roles.reduce(
      (n, r) =>
        n +
        Math.max(
          0,
          Number(r.count ?? 0) -
            (r.assignment ?? []).reduce(
              (s: number, a: Plan) => s + Number(a.count ?? 0),
              0,
            ),
        ),
      0,
    );
  const issues = validate(plan).filter((i) => i.step === "resources"),
    unknownCount = roles.some((r) => typeof r.count !== "number"),
    unknownAssigned = rows.some((r) => typeof r.assignment.count !== "number");
  const over = roles.filter(
    (r) =>
      (r.assignment ?? []).reduce(
        (n: number, a: Plan) => n + Number(a.count ?? 0),
        0,
      ) > Number(r.count ?? 0),
  );
  return (
    <Card title="Staff assignments" tag={<Badge>Editable</Badge>}>
      <p className="op-muted">
        Choose who works at each entrance or help point. You can change any
        assignment below, add another, or remove it. Planned team sizes and
        costs are set in “Staff by entry area” above.
      </p>
      <div className="op-assignment-summary">
        <div>
          <span>Planned staff</span>
          <strong>{unknownCount ? "Not set" : fmt(planned)}</strong>
        </div>
        <div>
          <span>Assigned</span>
          <strong>{unknownAssigned ? "Incomplete" : fmt(assigned)}</strong>
        </div>
        <div>
          <span>Still to assign</span>
          <strong>{unknownCount ? "Not set" : fmt(unassigned)}</strong>
        </div>
      </div>
      <div className="op-assignment-add">
        <label className="op-field">
          <span>Add an assignment for</span>
          <select
            value={roleForNew}
            onChange={(e) => setAddRole(e.target.value)}
          >
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() => {
            setExpanded(
              (current) =>
                new Set([
                  ...current,
                  roleForNew +
                    ":" +
                    (roles.find((r) => r.id === roleForNew)?.assignment
                      ?.length ?? 0),
                ]),
            );
            onChange(addStaffAssignment(plan, roleForNew));
          }}
          disabled={!roleForNew}
        >
          <Plus size={16} />
          Add assignment
        </Button>
      </div>
      {!roles.length && (
        <p className="op-muted">
          Add staff roles above first, then assign them here.
        </p>
      )}
      {!rows.length && roles.length > 0 && (
        <p className="op-arrival-empty">
          No assignments yet. Choose a role above to add your first assignment.
        </p>
      )}
      {over.map((role) => (
        <p className="op-error" key={role.id}>
          {role.name}: more people are assigned than the {role.count ?? 0}{" "}
          planned for this role. Reduce the assignments or update the team size
          above.
        </p>
      ))}
      <div className="op-assignment-rows">
        {rows.map(({ role, roleIndex, assignment: a, index }, i) => {
          const point = points.find((p) => p.id === a.point),
            lanes = point?.lanes ?? [],
            prefix = `Assignment ${i + 1}`,
            path = `staff.roles.${roleIndex}.assignment.${index}`;
          const error = (field: string) =>
            issues.find((issue) => issue.path === path + "." + field)?.message;
          const rowKey = role.id + ":" + index,
            isExpanded = expanded.has(rowKey);
          const shiftError = issues.find(
            (issue) => issue.path === `staff.roles.${roleIndex}.shift`,
          )?.message;
          return (
            <section
              className={`op-assignment-row ${isExpanded ? "is-expanded" : ""}`}
              aria-label={prefix}
              key={role.id + ":" + index}
            >
              <header>
                <button
                  className="op-assignment-toggle"
                  aria-label={`Edit ${prefix.toLowerCase()}`}
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(rowKey)) next.delete(rowKey);
                      else next.add(rowKey);
                      return next;
                    })
                  }
                >
                  <span>
                    <strong>{role.name}</strong>
                    <small>
                      {prefix} · {point?.name ?? "Choose a location"} ·{" "}
                      {a.count ?? "—"} {a.count === 1 ? "person" : "people"}
                    </small>
                  </span>
                  <span className="op-assignment-edit">
                    Edit
                    <ChevronDown size={16} />
                  </span>
                </button>
                <button
                  className="op-icon-button"
                  aria-label={`Remove ${prefix.toLowerCase()}`}
                  onClick={() =>
                    onChange(removeStaffAssignment(plan, role.id, index))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </header>
              {isExpanded && (
                <>
                  <p className="op-assignment-skills">
                    This role can perform:{" "}
                    {(role.can_do ?? [])
                      .map((id: string) => names[id] ?? id.replaceAll("_", " "))
                      .join(" · ") || "Duties not set"}
                  </p>
                  <div className="op-assignment-grid">
                    <label className="op-field">
                      <span>Role</span>
                      <select
                        aria-label={`${prefix} role`}
                        value={role.id}
                        onChange={(e) => {
                          const target = e.target.value;
                          setExpanded(
                            (current) =>
                              new Set([
                                ...current,
                                target +
                                  ":" +
                                  (roles.find((r) => r.id === target)
                                    ?.assignment?.length ?? 0),
                              ]),
                          );
                          onChange(
                            moveStaffAssignment(plan, role.id, index, target),
                          );
                        }}
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      className={`op-field ${error("point") ? "invalid" : ""}`}
                    >
                      <span>Entrance / help point</span>
                      <select
                        aria-label={`${prefix} entrance`}
                        value={a.point ?? ""}
                        aria-invalid={Boolean(error("point"))}
                        onChange={(e) =>
                          onChange(
                            changeStaffAssignment(plan, role.id, index, {
                              point: e.target.value,
                            }),
                          )
                        }
                      >
                        <option value="">Choose a location</option>
                        {points.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {error("point") && (
                        <small className="op-error">{error("point")}</small>
                      )}
                    </label>
                    {a.duty && !lanes.length ? (
                      <label className="op-field">
                        <span>Duty</span>
                        <input
                          aria-label={`${prefix} duty`}
                          value={a.duty ?? ""}
                          onChange={(e) =>
                            onChange(
                              changeStaffAssignment(plan, role.id, index, {
                                duty: e.target.value,
                              }),
                            )
                          }
                        />
                      </label>
                    ) : (
                      <label
                        className={`op-field ${error("lane_group") ? "invalid" : ""}`}
                      >
                        <span>Lane group</span>
                        <select
                          aria-label={`${prefix} lane group`}
                          value={a.lane_group ?? ""}
                          disabled={!point || !lanes.length}
                          aria-invalid={Boolean(error("lane_group"))}
                          onChange={(e) =>
                            onChange(
                              changeStaffAssignment(plan, role.id, index, {
                                lane_group: e.target.value,
                              }),
                            )
                          }
                        >
                          <option value="">Choose lanes</option>
                          {lanes.map((l: Plan) => (
                            <option key={l.group} value={l.group}>
                              {laneName(l.group)} · {l.count ?? "—"} lanes
                            </option>
                          ))}
                        </select>
                        {error("lane_group") && (
                          <small className="op-error">
                            {error("lane_group")}
                          </small>
                        )}
                      </label>
                    )}
                    <label
                      className={`op-field ${shiftError ? "invalid" : ""}`}
                    >
                      <span>Shift for this role</span>
                      <select
                        aria-label={`${prefix} shift`}
                        value={role.shift ?? ""}
                        aria-invalid={Boolean(shiftError)}
                        onChange={(e) =>
                          onChange(
                            set(
                              plan,
                              `staff.roles.${roleIndex}.shift`,
                              e.target.value,
                            ),
                          )
                        }
                      >
                        <option value="">Choose a shift</option>
                        {shifts.map((s, j) => (
                          <option key={s.id} value={s.id}>
                            {s.name ?? `Shift ${j + 1}`} ·{" "}
                            {s.start ? displayTime(s.start) : "Start not set"}–
                            {s.end ? displayTime(s.end) : "End not set"}
                          </option>
                        ))}
                      </select>
                      {shiftError && (
                        <small className="op-error">{shiftError}</small>
                      )}
                    </label>
                    <label
                      className={`op-field ${error("count") ? "invalid" : ""}`}
                    >
                      <span>People assigned</span>
                      <input
                        type="number"
                        aria-label={`${prefix} people assigned`}
                        value={a.count ?? ""}
                        min="0"
                        step="1"
                        aria-invalid={Boolean(error("count"))}
                        onChange={(e) =>
                          onChange(
                            changeStaffAssignment(plan, role.id, index, {
                              count:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            }),
                          )
                        }
                      />
                      <small className={error("count") ? "op-error" : ""}>
                        {error("count") ??
                          `${role.count ?? "—"} planned for this role`}
                      </small>
                    </label>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>
      <p className="op-muted">
        A role uses one shift across its assignments. Changing its shift here
        updates all assignments for that role. The shift must cover the
        entrance’s opening hours; total assignments must fit the planned team
        size.
      </p>
    </Card>
  );
}
