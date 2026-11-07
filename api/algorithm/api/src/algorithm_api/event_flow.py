"""Minute-grid expected flow with FCFS class cohorts and fractional returns."""

import heapq
import itertools
import math
from collections import defaultdict, deque

from .event_capacity import applicable, check_deadline, lane_capacity, mean_time, seconds
from .event_des import Journey, demand_inputs


class FlowSimulation(Journey):
    def __init__(self, document, resources, deadline):
        super().__init__(document, resources, deadline)
        self.step_means = {sid: mean_time(step) for sid, step in resources['steps'].items()}
        self.counter = itertools.count()
        self.records = {}
        self.pending = {}
        self.queue_index = {}
        self.holding_pools = {}
        self.holding_changes = defaultdict(list)
        self.holding_lumps = defaultdict(list)
        self.holding_amount = 0.0
        self.holding_fields = ('walking_seconds', 'service_seconds', 'wait_seconds', 'opening_hold_seconds', 'gate_join_hold_seconds', 'arrival')
        self.queues = {gid: deque() for gid in self.groups}
        self.capacities = {}
        profile = document['event']['audience_profile']
        for gid, group in self.groups.items():
            if group['lanes']:
                self.capacities[gid] = lane_capacity(group['lanes'][0]['positions'], resources['steps'], profile, deadline)
            else:
                self.capacities[gid] = dict(visitors_per_minute=0, mean_lane_seconds=0, visitors=6000, warmup_discarded=1000)
        demand = demand_inputs(document)
        categories = document['event']['ticket_categories']
        for category in categories:
            cid = category['id']
            total = (category.get('sold', 0) + category.get('issued', 0)) * (1 - document['event']['capacity'].get('no_show_percent_estimate', 0) / 100)
            self.attendance += total
            for start, end, share in demand[cid]['windows']:
                for minute in range(math.floor(start / 60), math.ceil(end / 60)):
                    check_deadline(deadline)
                    amount = total * share * max(0, min(end, minute * 60 + 60) - max(start, minute * 60)) / (end - start)
                    attributes = [('gender', [('female', profile.get('female_percent', 50) / 100), ('male', 1 - profile.get('female_percent', 50) / 100)])]
                    for key, field in [('bag', 'visitors_with_bag_percent'), ('locker', 'visitors_using_locker_percent'), ('accessible', 'accessible_visitors_percent')]:
                        chance = profile.get(field, 0) / 100
                        attributes.append((key, [(True, chance), (False, 1 - chance)]))
                    for combination in itertools.product(*(options for _, options in attributes)):
                        weight = amount * math.prod(chance for _, chance in combination)
                        if weight == 0:
                            continue
                        visitor = dict(category=cid, weight=weight, exception=False, help_resolved_draw=0, locker_remove_seconds=900, join_delay=150,
                                       arrival=minute * 60, planned_join=None if demand[cid]['gate_join'] == 'after_redemption' else demand[cid]['gate_join'], group_size=1)
                        visitor.update({key: choice[0] for (key, _), choice in zip(attributes, combination)})
                        self.register(visitor)
                        self.push(minute * 60, 1, 'arrival', visitor, visitor['id'])
        first = min([g['opens'] for g in self.groups.values()] + [v['arrival'] for v in self.records.values()])
        self.grid_start = math.floor(first / 60) * 60
        for at in range(int(self.grid_start), int(self.horizon) + 1, 60):
            super().push(at, 1, 'release_holding', None)
            super().push(at, 4, 'tick', None)
        for gid, group in self.groups.items():
            super().push(group['closes'], 3, 'close', gid, gid)

    def register(self, visitor):
        visitor['id'] = f"f{next(self.counter):09d}"
        self.records[visitor['id']] = visitor
        return visitor

    def key(self, visitor):
        return (visitor['category'], visitor['gender'], visitor['bag'], visitor['locker'], visitor['accessible'], visitor.get('exception', False), visitor.get('locker_done', False), visitor.get('locker_reserved', False), visitor.get('escorted', False), visitor.get('exception_reason'))

    def merge(self, target, source):
        total = target['weight'] + source['weight']
        for key in ('walking_seconds', 'service_seconds', 'wait_seconds', 'opening_hold_seconds', 'gate_join_hold_seconds', 'arrival', 'queue_join'):
            target[key] = (target.get(key, 0) * target['weight'] + source.get(key, 0) * source['weight']) / total
        keys = target.get('point_waits', {}).keys() | source.get('point_waits', {}).keys()
        target['point_waits'] = {
            key: (target.get('point_waits', {}).get(key, 0) * target['weight'] + source.get('point_waits', {}).get(key, 0) * source['weight']) / total
            for key in keys
        }
        target['weight'] = total
        source['state'] = 'split'
        self.records.pop(source['id'], None)

    def split(self, visitor, amount):
        if amount >= visitor['weight']:
            return visitor
        part = dict(visitor, weight=amount, point_waits=dict(visitor.get('point_waits', {})))
        visitor['weight'] -= amount
        self.register(part)
        return part

    def push(self, at, priority, kind, payload, stable=''):
        if kind in ('tick', 'close', 'release_holding'):
            return super().push(at, priority, kind, payload, stable)
        at = math.ceil((at - 1e-9) / 60) * 60
        visitor = payload if kind == 'arrival' else payload[0]
        suffix = () if kind == 'arrival' else tuple(
            (x.get('id'), x.get('outcome'), x.get('delay')) if isinstance(x, dict) else x
            for x in payload[1:]
        )
        key = (at, kind, self.key(visitor), suffix)
        if key in self.pending:
            self.merge(self.pending[key], visitor)
            return
        self.pending[key] = visitor
        super().push(at, priority, kind, (key, payload), stable)

    def route_gate(self, visitor, origin, now):
        visitor['exception'] = False
        visitor.pop('exception_reason', None)
        visitor.pop('return_gate', None)
        self.push(now, 1, 'prepare_gate', (visitor, origin), visitor['id'])

    def prepare_gate(self, visitor, origin, now):
        planned = visitor.get('planned_join')
        outer = seconds(self.schedule.get('outer_area_open', '00:00'))
        if planned is None:
            at = max(now, outer)
            visitor['gate_join_hold_seconds'] = visitor.get('gate_join_hold_seconds', 0) + at - now
            self.zone(visitor, 'zone_forecourt', now)
            visitor['state'] = 'gate_join_holding'
            self.push(at, 1, 'walk_gate', (visitor, origin, self.gate_target(visitor)), visitor['id'])
            return
        key = (self.key(visitor), origin)
        if key not in self.holding_pools:
            self.holding_pools[key] = dict(template=dict(visitor), rate=[0.0] * (len(self.holding_fields) + 1), origin=origin)
        values = [visitor['weight']] + [visitor['weight'] * (visitor.get(field, 0) - now if field == 'gate_join_hold_seconds' else visitor.get(field, 0)) for field in self.holding_fields]
        self.zone(visitor, 'zone_forecourt', now)
        self.holding_amount += visitor['weight']
        visitor['state'] = 'split'
        self.records.pop(visitor['id'], None)
        if planned is None:
            at = math.ceil(max(now, outer) / 60) * 60
            self.holding_lumps[at].append((key, values))
            return
        start, end = planned
        def cdf(at):
            if at < outer:
                return 0.0
            planned_share = min(1.0, max(0.0, (at - start) / (end - start)))
            ready_share = min(1.0, max(0.0, (at - now) / 300))
            return planned_share * ready_share
        first = math.ceil(max(now, outer, start) / 60) * 60
        transition = math.ceil(max(now + 300, outer, start) / 60) * 60
        last = math.ceil(max(now + 300, outer, end) / 60) * 60
        previous = 0.0
        for at in range(first, min(transition, last) + 1, 60):
            value = cdf(at)
            share = max(0.0, value - previous)
            if share:
                self.holding_lumps[at].append((key, [x * share for x in values]))
            previous = value
        remaining = 1 - previous
        next_at = transition + 60
        if remaining <= 0:
            return
        if next_at >= last:
            self.holding_lumps[last].append((key, [x * remaining for x in values]))
            return
        rate_share = 60 / (end - start)
        full_last = math.floor(end / 60) * 60
        if full_last >= next_at:
            rate = [x * rate_share for x in values]
            self.holding_changes[next_at].append((key, rate))
            self.holding_changes[full_last + 60].append((key, [-x for x in rate]))
            remaining -= ((full_last - next_at) // 60 + 1) * rate_share
        if remaining > 0:
            self.holding_lumps[last].append((key, [x * remaining for x in values]))

    def release_holding(self, now):
        for key, values in self.holding_changes.pop(now, []):
            rate = self.holding_pools[key]['rate']
            for i, value in enumerate(values):
                rate[i] += value
        released = {}
        for key, values in self.holding_lumps.pop(now, []):
            target = released.setdefault(key, [0.0] * len(values))
            for i, value in enumerate(values):
                target[i] += value
        for key, pool in self.holding_pools.items():
            rate = pool['rate']
            if rate[0] > 0:
                target = released.setdefault(key, [0.0] * len(rate))
                for i, value in enumerate(rate):
                    target[i] += value
        for key, values in released.items():
            amount = values[0]
            if amount <= 0:
                continue
            pool = self.holding_pools[key]
            visitor = dict(pool['template'], weight=amount, zone='zone_forecourt', state='gate_join_holding')
            for field, value in zip(self.holding_fields, values[1:]):
                visitor[field] = value / amount + (now if field == 'gate_join_hold_seconds' else 0)
            self.register(visitor)
            self.holding_amount -= amount
            self.walk(visitor, pool['origin'], self.gate_target(visitor), now, gate=True)

    def join_point(self, visitor, point, now):
        if point == self.locker_point and not visitor.get('locker_reserved'):
            available = max(0, self.locker_stock - self.locker_used)
            if 0 < available < visitor['weight']:
                part = self.split(visitor, available)
                super().join_point(part, point, now)
        super().join_point(visitor, point, now)

    def help_complete(self, visitor, point, now):
        probability = self.resources['steps'].get('help_desk_resolution', {}).get('results', {}).get('resolved_percent', 100) / 100
        if probability > 0:
            resolved = self.split(visitor, visitor['weight'] * probability)
            self.support['help_resolved'] += resolved['weight']
            self.after_redemption(resolved, point, now)
            if resolved is visitor:
                return
        self.support['help_refused'] += visitor['weight']
        self.refuse(visitor, now, visitor.get('exception_reason', 'help_desk_unresolved'), point)

    def join(self, visitor, gid, now):
        group = self.groups[gid]
        if now >= group['closes']:
            self.refuse(visitor, now, 'last_entry_passed' if group['is_gate'] else 'redemption_closed' if group['point'] == self.first else 'point_closed', group['point'])
            return
        self.observe_join(visitor, gid, now)
        key = (gid, now, self.key(visitor))
        if key in self.queue_index:
            self.merge(self.queue_index[key], visitor)
        else:
            self.queue_index[key] = visitor
            visitor['queue_key'] = key
            self.queues[gid].append(visitor)

    def start(self, visitor, gid, now):
        group = self.groups[gid]
        positions = group['lanes'][0]['positions']
        expected_elapsed = 0.0
        survivors = visitor
        for position in positions:
            for sid in position['steps']:
                step = self.resources['steps'][sid]
                if not applicable(step, survivors):
                    continue
                expected_elapsed += self.step_means[sid]
                base_weight = survivors['weight']
                exceptions = step.get('exceptions', [])
                continued_extra = sum(e['share_percent'] / 100 * e.get('extra_minutes', 0) * 60 for e in exceptions if e['outcome'] in ('continue', 'secondary_check'))
                for exception in exceptions:
                    probability = exception['share_percent'] / 100
                    if probability == 0 or exception['outcome'] in ('continue', 'secondary_check'):
                        continue
                    amount = min(survivors['weight'], base_weight * probability)
                    part = self.split(survivors, amount)
                    extra = exception.get('extra_minutes', 0) * 60
                    duration = expected_elapsed + (0 if exception['outcome'] == 'step_aside_and_return' else extra)
                    part['service_seconds'] = part.get('service_seconds', 0) + duration
                    outcome = dict(exception, delay=extra if exception['outcome'] == 'step_aside_and_return' else 0)
                    self.push(now + duration, 0, 'depart', (part, gid, outcome), part['id'])
                    if part is survivors:
                        return
                expected_elapsed += continued_extra
        duration = max(expected_elapsed, self.capacities[gid]['mean_lane_seconds'])
        survivors['service_seconds'] = survivors.get('service_seconds', 0) + duration
        self.push(now + duration, 0, 'depart', (survivors, gid, None), survivors['id'])

    def tick(self, now):
        for gid, group in self.groups.items():
            if not group['opens'] <= now < group['closes']:
                continue
            active = [lane for lane in group['lanes'] if lane['available_from'] <= now]
            capacity = len(active) * self.capacities[gid]['visitors_per_minute']
            available = capacity
            served = 0.0
            batches = {}
            while self.queues[gid] and available > 0:
                visitor = self.queues[gid][0]
                amount = min(visitor['weight'], available)
                if amount == visitor['weight']:
                    self.queues[gid].popleft()
                    self.queue_index.pop(visitor['queue_key'], None)
                    part = visitor
                else:
                    part = self.split(visitor, amount)
                available = max(0, available - amount)
                served += amount
                self.observe_start(part, gid, now)
                key = self.key(part)
                if key in batches:
                    self.merge(batches[key], part)
                else:
                    batches[key] = part
            for visitor in batches.values():
                self.start(visitor, gid, now)
            if served and active:
                fraction = served / capacity
                for lane in active:
                    self.lane_busy[gid].append((now, min(self.horizon, now + 60 * fraction)))
                    positions = lane['positions']
                    mean_total = max(1e-12, sum(p['mean_seconds'] / p['servers'] for p in positions))
                    for position in positions:
                        duration = min(60, served / len(active) * position['mean_seconds'] / position['servers'])
                        for worker in position['staff']:
                            self.work[worker].append((now, min(self.horizon, now + duration), gid))

    def run(self):
        processed = 0
        while self.events:
            now, _, _, _, kind, payload = heapq.heappop(self.events)
            if now > self.horizon:
                break
            if processed % 256 == 0:
                check_deadline(self.deadline)
            processed += 1
            if kind == 'release_holding':
                self.release_holding(now)
            elif kind == 'tick':
                self.tick(now)
            elif kind == 'close':
                group = self.groups[payload]
                while self.queues[payload]:
                    visitor = self.queues[payload].popleft()
                    self.queue_index.pop(visitor['queue_key'], None)
                    self.refuse(visitor, now, 'last_entry_passed' if group['is_gate'] else 'redemption_closed' if group['point'] == self.first else 'point_closed', group['point'])
            else:
                key, payload = payload
                self.pending.pop(key, None)
                if kind == 'prepare_gate':
                    self.prepare_gate(*payload, now)
                elif kind == 'depart':
                    self.depart(*payload[:2], now, payload[2])
                else:
                    self.dispatch_route(now, kind, payload)
        self.visitors = list(self.records.values())
        result = self.result()
        if self.holding_amount > 1e-9:
            result['unfinished_states']['gate_join_holding'] = self.holding_amount
        result['events_processed'] = processed
        result['capacities'] = self.capacities
        result['grid_start'] = self.grid_start
        return result


def simulate_flow(document, resources, deadline):
    return FlowSimulation(document, resources, deadline).run()
