"""Deterministic individual corridor simulation and bounded lane comparison."""

import heapq
import math
import time
from dataclasses import dataclass
from fractions import Fraction
from typing import Literal

from .models import Evaluation, PlanDocument, RunOutput, lane_cost_minor, money_from_minor


class ComputationTimeout(Exception):
    """The computation did not finish within its monotonic deadline."""


@dataclass
class Comparison:
    baseline: RunOutput
    best: RunOutput
    best_plan: PlanDocument | None
    evaluations: list[Evaluation]
    stop_reason: Literal['completed', 'time_limit']


def _check_deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise ComputationTimeout('Corridor computation exceeded its deadline')


def simulate(plan: PlanDocument, *, deadline: float) -> RunOutput:
    """Schedule every visitor and measure completed and unfinished states at the horizon."""
    _check_deadline(deadline)
    segments = []
    scan_index = 0
    nodes = plan.route.nodes
    for index, (start, end) in enumerate(zip(nodes, nodes[1:]), start=1):
        _check_deadline(deadline)
        segments.append(math.dist(
            (start.position.x, start.position.y, start.position.z),
            (end.position.x, end.position.y, end.position.z),
        ))
        if end.id == plan.route.scan_node_id:
            scan_index = index
    distance = math.fsum(segments)
    speed = Fraction(str(plan.walking_speed_mps))
    walk_to_scan = Fraction(str(math.fsum(segments[:scan_index]))) / speed
    walk_to_admission = Fraction(str(math.fsum(segments[scan_index:]))) / speed
    horizon = Fraction(str(plan.horizon_seconds))
    first_arrival = Fraction(str(plan.arrivals.start_seconds))
    arrival_window = Fraction(str(plan.arrivals.end_seconds)) - first_arrival
    service_time = Fraction(str(plan.scan.service_seconds))
    count = plan.arrivals.count
    lanes = [(Fraction(0), index) for index in range(plan.scan.lanes)]
    heapq.heapify(lanes)
    unfinished = dict(walking_to_scan=0, queued=0, scanning=0, walking_to_admission=0)
    waits = []
    queue_events = []
    walking_observations = []
    admitted = 0
    for index in range(count):
        _check_deadline(deadline)
        arrival = first_arrival + index * arrival_window / count
        queue_entry = arrival + walk_to_scan
        lane_available, lane_index = heapq.heappop(lanes)
        service_start = max(queue_entry, lane_available)
        service_end = service_start + service_time
        admission = service_end + walk_to_admission
        heapq.heappush(lanes, (service_end, lane_index))
        walking_observations.append(min(walk_to_scan, max(0, horizon - arrival)))
        walking_observations.append(min(walk_to_admission, max(0, horizon - service_end)))
        if admission <= horizon:
            admitted += 1
        elif queue_entry > horizon:
            unfinished['walking_to_scan'] += 1
        elif service_start > horizon:
            unfinished['queued'] += 1
        elif service_end > horizon:
            unfinished['scanning'] += 1
        else:
            unfinished['walking_to_admission'] += 1
        if service_start <= horizon:
            waits.append(service_start - queue_entry)
        if queue_entry < service_start and queue_entry <= horizon:
            queue_events.append((queue_entry, 1))
            if service_start <= horizon:
                queue_events.append((service_start, -1))
    queue = peak_queue = 0
    for _, delta in sorted(queue_events):
        _check_deadline(deadline)
        queue += delta
        peak_queue = max(peak_queue, queue)
    waits.sort()
    staff = int(plan.scan.staff_cost_per_lane.amount.replace('.', '')) * plan.scan.lanes
    equipment = int(plan.scan.scanner_cost_per_lane.amount.replace('.', '')) * plan.scan.lanes
    output = RunOutput.model_validate({
        'population': {
            'total': count, 'admitted': admitted, 'unfinished': count - admitted,
            'unfinished_by_state': unfinished,
        },
        'walking': {
            'route_distance_m': distance,
            'free_flow_seconds_per_visitor': float(walk_to_scan + walk_to_admission),
            'total_observed_seconds': float(sum(walking_observations)),
        },
        'scan': {
            'lanes': plan.scan.lanes, 'peak_queue': peak_queue,
            'wait_p90_seconds': float(waits[(9 * len(waits) + 9) // 10 - 1]) if waits else None,
            'wait_sample_count': len(waits),
        },
        'costs': {
            'staff': money_from_minor(staff), 'equipment': money_from_minor(equipment),
            'total': money_from_minor(staff + equipment),
        },
        'checks': {
            'queue_target_met': peak_queue <= plan.targets.max_peak_scan_queue,
            'budget_met': staff + equipment <= int(plan.budget.amount.replace('.', '')),
            'all_admitted': admitted == count,
        },
    })
    _check_deadline(deadline)
    return output


def score(output: RunOutput, plan: PlanDocument) -> tuple[int, int, int]:
    """Rank completed simulations by unfinished count, excess queue, and exact cost."""
    return (
        output.population.unfinished,
        max(0, output.scan.peak_queue - plan.targets.max_peak_scan_queue),
        lane_cost_minor(plan, output.scan.lanes),
    )


def compare_lanes(plan: PlanDocument, *, deadline: float) -> Comparison:
    """Evaluate feasible lane counts and retain only completed improvements."""
    baseline = simulate(plan, deadline=min(deadline, time.monotonic() + 2.0))
    best_score = score(baseline, plan)
    comparison = Comparison(
        baseline=baseline, best=baseline, best_plan=None,
        evaluations=[Evaluation(lanes=plan.scan.lanes, status='completed', score=best_score)],
        stop_reason='completed',
    )
    maximum = min(
        plan.scan.physical_slots, plan.scan.available_staff, plan.scan.available_scanners, 8,
    )
    budget = int(plan.budget.amount.replace('.', ''))
    for lanes in range(plan.scan.lanes + 1, maximum + 1):
        try:
            _check_deadline(deadline)
            if lane_cost_minor(plan, lanes) > budget:
                comparison.evaluations.append(Evaluation(lanes=lanes, status='excluded_budget', score=None))
                continue
            candidate = plan.model_copy(update={'scan': plan.scan.model_copy(update={'lanes': lanes})})
            output = simulate(candidate, deadline=min(deadline, time.monotonic() + 2.0))
            candidate_score = score(output, candidate)
        except ComputationTimeout:
            comparison.stop_reason = 'time_limit'
            break
        comparison.evaluations.append(Evaluation(lanes=lanes, status='completed', score=candidate_score))
        if candidate_score < best_score:
            best_score = candidate_score
            comparison.best = output
            comparison.best_plan = candidate
    return comparison
