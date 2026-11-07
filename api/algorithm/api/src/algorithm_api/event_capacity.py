"""Operational resources, ordered positions, and finite-buffer lane experiments."""

import hashlib
import heapq
import itertools
import json
import math
import random
import time
from collections import deque

from .engine import ComputationTimeout

CAPACITY_MODEL_VERSION = 'lane_capacity_v1'
_CACHE = {}


def check_deadline(deadline):
    if time.monotonic() >= deadline:
        raise ComputationTimeout('Event-entry computation exceeded its deadline')


def seconds(clock):
    h, m = clock.split(':')
    return int(h) * 3600 + int(m) * 60


def clock(value):
    value = int(value // 60)
    return f'{value // 60:02d}:{value % 60:02d}'


def mean_time(step):
    times = step['time_per_person_seconds']
    typical, slow = times['typical'], times['slow']
    if typical == 0:
        return 0.0
    sigma = math.log(slow / typical) / 1.2816
    if sigma == 0:
        return float(typical)
    cap = 3 * slow
    normal = lambda x: (1 + math.erf(x / math.sqrt(2))) / 2
    return typical * math.exp(sigma * sigma / 2) * normal((math.log(cap / typical) - sigma * sigma) / sigma) + cap * (1 - normal(math.log(cap / typical) / sigma))


def applicable(step, visitor):
    return {'all_visitors': True, 'visitors_with_bag': visitor.get('bag', False),
            'visitors_using_locker': visitor.get('locker', False),
            'accessible_visitors': visitor.get('accessible', False),
            'visitors_with_exception': visitor.get('exception', False)}.get(step.get('applies_to', 'all_visitors'), True)


def step_share(step, profile):
    return {'all_visitors': 1, 'visitors_with_bag': profile.get('visitors_with_bag_percent', 0) / 100,
            'visitors_using_locker': 1, 'accessible_visitors': profile.get('accessible_visitors_percent', 0) / 100,
            'visitors_with_exception': 1}.get(step.get('applies_to', 'all_visitors'), 1)


def sample_position(position, steps, visitor, rng):
    duration = 0.0
    outcome = None
    for sid in position['steps']:
        step = steps[sid]
        if not applicable(step, visitor):
            continue
        times = step['time_per_person_seconds']
        typical, slow = times['typical'], times['slow']
        duration += typical if typical == slow else min(3 * slow, rng.lognormvariate(math.log(typical), math.log(slow / typical) / 1.2816)) if typical else 0
        chance = rng.random() * 100
        for exception in step.get('exceptions', []):
            chance -= exception['share_percent']
            if chance < 0:
                extra = exception.get('extra_minutes', 0) * 60
                name = exception['outcome']
                if name != 'step_aside_and_return':
                    duration += extra
                if name not in ('continue', 'secondary_check'):
                    outcome = dict(exception, delay=extra if name == 'step_aside_and_return' else 0)
                break
        if outcome:
            break
    return duration, outcome


def split_positions(step_ids, staff, steps, profile):
    """Choose the capable ordered partition with the smallest bottleneck mean."""
    if not step_ids or not staff:
        return []
    count = min(len(staff), len(step_ids))
    candidates = []
    for cuts in itertools.combinations(range(1, len(step_ids)), count - 1):
        bounds = (0,) + cuts + (len(step_ids),)
        blocks = [step_ids[a:b] for a, b in zip(bounds, bounds[1:])]
        def assign(index, available, positions):
            if index == len(blocks):
                extras = [staff[i] for i in available]
                result = [dict(p, roles=list(p['roles']), staff=list(p['staff'])) for p in positions]
                for person in extras:
                    choices = [p for p in result if set(p['steps']) <= set(person['can_do'])]
                    if not choices:
                        return
                    target = max(choices, key=lambda p: p['mean_seconds'] / p['servers'])
                    target['servers'] += 1
                    target['roles'].append(person['role'])
                    target['staff'].append(person['id'])
                candidates.append((max(p['mean_seconds'] / p['servers'] for p in result), result))
                return
            block = blocks[index]
            seen = set()
            for i in available:
                person = staff[i]
                key = (person['role'], tuple(person['can_do']))
                if key in seen or not set(block) <= set(person['can_do']):
                    continue
                seen.add(key)
                expected = sum(step_share(steps[s], profile) * (mean_time(steps[s]) + sum(e['share_percent'] / 100 * e.get('extra_minutes', 0) * 60 for e in steps[s].get('exceptions', []) if e['outcome'] != 'step_aside_and_return')) for s in block)
                assign(index + 1, [j for j in available if j != i], positions + [dict(steps=block, roles=[person['role']], staff=[person['id']], servers=1, mean_seconds=expected)])
        assign(0, list(range(len(staff))), [])
    return min(candidates, key=lambda item: item[0])[1] if candidates else []


class Lane:
    """One ordered lane with one waiting place between staffed positions."""

    def __init__(self, positions, schedule, service, departed, released=None):
        self.positions = positions
        self.schedule = schedule
        self.service = service
        self.departed = departed
        self.released = released
        self.slots = [[None] * p['servers'] for p in positions]
        self.buffers = [deque() for _ in positions]
        self.busy_start = {}

    def free(self):
        return any(item is None for item in self.slots[0])

    def start(self, visitor, now, position=0, server=None):
        if server is None:
            server = self.slots[position].index(None)
        duration, outcome = self.service(visitor, position, server, now)
        self.slots[position][server] = [visitor, False, outcome, now]
        self.schedule(now + duration, self, position, server)

    def complete(self, position, server, now):
        slot = self.slots[position][server]
        slot[1] = True
        if slot[2] is not None or position == len(self.positions) - 1:
            visitor, _, outcome, started = slot
            self.slots[position][server] = None
            if position == 0 and self.released:
                self.released(visitor, now, started)
            self.departed(visitor, now, outcome)
        self.pump(now)

    def pump(self, now):
        changed = True
        while changed:
            changed = False
            for pos in range(len(self.positions) - 1, 0, -1):
                for server, slot in enumerate(self.slots[pos]):
                    if slot is None and self.buffers[pos]:
                        self.start(self.buffers[pos].popleft(), now, pos, server)
                        changed = True
                for server, slot in enumerate(self.slots[pos - 1]):
                    if slot is not None and slot[1] and len(self.buffers[pos]) < 1:
                        visitor, _, _, started = slot
                        self.buffers[pos].append(visitor)
                        self.slots[pos - 1][server] = None
                        if pos == 1 and self.released:
                            self.released(visitor, now, started)
                        changed = True


def lane_capacity(positions, steps, profile, deadline):
    service_steps = {sid: dict(applies_to=steps[sid].get('applies_to', 'all_visitors'), time_per_person_seconds=steps[sid]['time_per_person_seconds'], exceptions=[{k: e[k] for k in ('id', 'share_percent', 'outcome', 'extra_minutes') if k in e} for e in steps[sid].get('exceptions', [])]) for p in positions for sid in p['steps']}
    service_profile = {k: profile.get(k, 0) for k in ('visitors_with_bag_percent', 'accessible_visitors_percent')}
    setup = dict(positions=[{k: p[k] for k in ('steps', 'servers')} for p in positions], steps=service_steps, profile=service_profile, version=CAPACITY_MODEL_VERSION)
    digest = hashlib.sha256(json.dumps(setup, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).digest()
    key = digest.hex()
    check_deadline(deadline)
    if key in _CACHE:
        return _CACHE[key]
    rng = random.Random(int.from_bytes(digest[:8], 'big'))
    events = []
    sequence = itertools.count()
    releases = []
    completed = []
    created = 0
    starts = {}
    def schedule(at, lane, position, server):
        heapq.heappush(events, (at, next(sequence), position, server))
    def service(visitor, position, server, now):
        return sample_position(positions[position], steps, visitor, rng)
    def departed(visitor, now, outcome):
        completed.append(now - starts[visitor['id']])
    lane = Lane(positions, schedule, service, departed, lambda visitor, now, start: releases.append(now))
    def fill(now):
        nonlocal created
        while lane.free() and created < 6000:
            v = dict(id=created, bag=rng.random() < profile.get('visitors_with_bag_percent', 0) / 100,
                     accessible=rng.random() < profile.get('accessible_visitors_percent', 0) / 100,
                     locker=True, exception=True)
            starts[created] = now
            created += 1
            lane.start(v, now)
    fill(0)
    while events:
        if len(completed) % 256 == 0:
            check_deadline(deadline)
        now, _, pos, server = heapq.heappop(events)
        lane.complete(pos, server, now)
        fill(now)
    elapsed = releases[-1] - releases[999]
    result = dict(visitors_per_minute=5000 * 60 / elapsed if elapsed else 1e12,
                  mean_lane_seconds=sum(completed[1000:]) / 5000,
                  visitors=6000, warmup_discarded=1000, configuration_hash=key,
                  model_version=CAPACITY_MODEL_VERSION)
    _CACHE[key] = result
    return result


def derive_resources(document, deadline):
    """Allocate individual staff and inventory in stable point and group order."""
    layout = document['venue']['layout']
    steps = {s['id']: s for s in document['process_steps']['steps']}
    roles = {r['id']: r for r in document['staff']['roles']}
    shifts = {s['id']: s for s in document['staff']['shifts']}
    equipment = {e['id']: e for e in document['constraints'].get('equipment', {}).get('items', [])}
    people = {}
    for rid, role in roles.items():
        genders = [g for g in ('female', 'male') for _ in range(role.get('gender', {}).get(g, 0))]
        genders += [None] * max(0, role['count'] - len(genders))
        shift = shifts[role['shift']]
        people[rid] = [dict(id=f'{rid}:{i}', role=rid, gender=g, can_do=role.get('can_do', []), certification=role.get('certification'), start=seconds(shift['start']), end=seconds(shift['end'])) for i, g in enumerate(genders)]
    used_people = set()
    used_equipment = {eid: 0 for eid in equipment}
    groups = {}
    shortages = []
    points = {p['id']: dict(p, is_gate=p in layout.get('gates', [])) for p in layout.get('service_points', []) + layout.get('gates', [])}
    profile = document['event']['audience_profile']
    for pid, point in sorted(points.items()):
        point_count = 0
        duties = {}
        for group in sorted(point.get('lanes', []), key=lambda g: g['group']):
            check_deadline(deadline)
            gid = f"{pid}/{group['group']}"
            assignments = [(rid, index, a) for rid, role in sorted(roles.items()) for index, a in enumerate(role.get('assignment', [])) if a.get('point') == pid and a.get('lane_group') == group['group']]
            capable = set(s for rid, _, a in assignments for s in roles[rid].get('can_do', []))
            lane_steps = [s for s in group['steps'] if s in capable]
            for sid in group['steps']:
                if sid in capable:
                    continue
                for rid, role in sorted(roles.items()):
                    for a in role.get('assignment', []):
                        if a.get('point') == pid and a.get('duty') and sid in role.get('can_do', []):
                            duty = a['duty']
                            record = duties.setdefault(duty, dict(steps=[], assignments=[]))
                            if sid not in record['steps']:
                                record['steps'].append(sid)
                            if (rid, a) not in record['assignments']:
                                record['assignments'].append((rid, a))
                            break
            lanes = []
            reasons = set()
            for index in range(group['count']):
                staff = []
                if point_count >= point.get('max_lanes', group['count']):
                    reasons.add('physical_lane_limit')
                    break
                for rid, _, assignment in assignments:
                    needed = assignment.get('per_lane', 0)
                    if (index + 1) * needed > assignment.get('count', 0):
                        reasons.add('staff_assignment_shortage')
                        continue
                    required_gender = assignment.get('gender')
                    if 'body_search' in lane_steps and 'body_search' in roles[rid].get('can_do', []):
                        required_gender = group.get('visitor_gender', required_gender)
                    eligible = [p for p in people[rid] if p['id'] not in used_people and p['id'] not in {x['id'] for x in staff} and (not required_gender or p['gender'] == required_gender)]
                    if any(s in ('body_search', 'bag_check') for s in lane_steps) and any(s in roles[rid].get('can_do', []) for s in ('body_search', 'bag_check')) and not roles[rid].get('certification'):
                        eligible = []
                    if len(eligible) < needed:
                        reasons.add('eligible_staff_shortage')
                    staff.extend(eligible[:needed])
                expected_staff = sum(a.get('per_lane', 0) for _, _, a in assignments)
                if len(staff) != expected_staff or not staff:
                    continue
                positions = split_positions(lane_steps, staff, steps, profile)
                if not positions:
                    reasons.add('no_operational_position_split')
                    continue
                unavailable = [eid for eid, count in group.get('equipment_per_lane', {}).items() if used_equipment.get(eid, 0) + count > equipment.get(eid, {}).get('available', 0) + equipment.get(eid, {}).get('extra_rented', 0)]
                if unavailable:
                    reasons.update(f'equipment:{eid}' for eid in unavailable)
                    continue
                used_people.update(p['id'] for p in staff)
                for eid, count in group.get('equipment_per_lane', {}).items():
                    used_equipment[eid] = used_equipment.get(eid, 0) + count
                lanes.append(dict(index=index, positions=positions, staff=staff, available_from=max(seconds(point['opens']), *(p['start'] for p in staff))))
                point_count += 1
            groups[gid] = dict(id=gid, point=pid, group=group['group'], definition=group, requested_lanes=group['count'], operational_lanes=len(lanes), lanes=lanes, opens=seconds(point['opens']), closes=seconds(point['closes']), is_gate=point['is_gate'], duty=False)
            if len(lanes) < group['count']:
                shortages.append(dict(lane_group=gid, requested_lanes=group['count'], operational_lanes=len(lanes), reasons=sorted(reasons)))
        for duty, record in sorted(duties.items()):
            lanes = []
            for rid, assignment in record['assignments']:
                eligible = [p for p in people[rid] if p['id'] not in used_people][:assignment['count']]
                for person in eligible:
                    positions = split_positions(record['steps'], [person], steps, profile)
                    if positions:
                        used_people.add(person['id'])
                        lanes.append(dict(index=len(lanes), positions=positions, staff=[person], available_from=max(seconds(point['opens']), person['start'])))
            gid = f'{pid}/{duty}'
            groups[gid] = dict(id=gid, point=pid, group=duty, definition=dict(steps=record['steps'], serves='accessible_visitors'), requested_lanes=sum(a['count'] for _, a in record['assignments']), operational_lanes=len(lanes), lanes=lanes, opens=seconds(point['opens']), closes=seconds(point['closes']), is_gate=point['is_gate'], duty=True)
    return dict(groups=groups, points=points, steps=steps, roles=roles, shifts=shifts, equipment=equipment, equipment_used=used_equipment, shortages=shortages, people={p['id']: p for pool in people.values() for p in pool})
