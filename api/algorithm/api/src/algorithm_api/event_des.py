"""Chronological individual simulation and shared visitor journey rules."""

import hashlib
import heapq
import itertools
import math
import random
from collections import defaultdict, deque

from .event_capacity import Lane, applicable, check_deadline, clock, sample_position, seconds


def demand_inputs(document):
    event = document['event']
    demand = document.get('demand', {})
    doors, main = seconds(event['schedule']['doors_open']), seconds(event['schedule']['main_act'])
    result = {}
    for category in event['ticket_categories']:
        cid = category['id']
        supplied = demand.get('arrival_windows_percent', {}).get(cid)
        if supplied is not None:
            windows = [(seconds(key.split('-')[0]), seconds(key.split('-')[1]), share / 100) for key, share in supplied.items()]
        else:
            if category.get('admission') == 'standing':
                boundaries = [doors - 150 * 60, doors - 90 * 60, doors - 30 * 60, doors + 30 * 60, doors + 90 * 60, main, main + 45 * 60]
                shares = [.08, .20, .32, .27, .10, .03]
            else:
                boundaries = [doors - 120 * 60, doors - 60 * 60, doors, doors + 60 * 60, main - 30 * 60, main, main + 45 * 60]
                shares = [.10, .25, .33, .20, .08, .04]
            windows = []
            carry = 0
            for a, b, share in zip(boundaries, boundaries[1:], shares):
                if b <= a:
                    if windows:
                        x, y, z = windows[-1]
                        windows[-1] = (x, y, z + share)
                    else:
                        carry += share
                else:
                    windows.append((a, b, share + carry))
                    carry = 0
            if carry and windows:
                a, b, share = windows[-1]
                windows[-1] = (a, b, share + carry)
        join = demand.get('gate_join_windows', {}).get(cid)
        if join is None:
            join = (doors - (60 if category.get('admission') == 'standing' else 45) * 60, doors + (15 if category.get('admission') == 'standing' else 30) * 60)
        elif join != 'after_redemption':
            join = tuple(seconds(value) for value in join.split('-'))
        result[cid] = dict(windows=windows, gate_join=join, basis='estimate' if supplied is not None else 'assumed')
    return result


def uniform_window(rng, windows):
    pick = rng.random() * sum(share for _, _, share in windows)
    for start, end, share in windows:
        pick -= share
        if pick <= 0:
            return rng.uniform(start, end)
    return windows[-1][1]


def generate_visitors(document, seed, deadline):
    rng = random.Random(seed)
    event = document['event']
    profile = event['audience_profile']
    demand = demand_inputs(document)
    distribution = document.get('demand', {}).get('group_size_share_percent', {'1': 55, '2': 15, '3': 20, '4': 10})
    sizes = [int(k) for k in distribution]
    weights = list(distribution.values())
    visitors = []
    group_id = 0
    for category in sorted(event['ticket_categories'], key=lambda c: c['id']):
        cid = category['id']
        present = []
        for holder in range((category.get('sold', 0) + category.get('issued', 0))):
            if holder % 256 == 0:
                check_deadline(deadline)
            comes = rng.random() >= event['capacity'].get('no_show_percent_estimate', 0) / 100
            attrs = [rng.random() for _ in range(7)]
            if comes:
                present.append(dict(id=f'{cid}:{holder:05d}', category=cid, gender='female' if attrs[0] < profile.get('female_percent', 50) / 100 else 'male',
                    bag=attrs[1] < profile.get('visitors_with_bag_percent', 0) / 100,
                    locker=attrs[2] < profile.get('visitors_using_locker_percent', 0) / 100,
                    accessible=attrs[3] < profile.get('accessible_visitors_percent', 0) / 100,
                    help_resolved_draw=attrs[4], locker_remove_seconds=600 + attrs[5] * 600, join_delay=attrs[6] * 300,
                    weight=1.0, exception=False))
        index = 0
        while index < len(present):
            size = rng.choices(sizes, weights=weights)[0]
            members = present[index:index + size]
            arrival = uniform_window(rng, demand[cid]['windows'])
            join = demand[cid]['gate_join']
            planned = None if join == 'after_redemption' else rng.uniform(*join)
            for visitor in members:
                visitor.update(arrival=arrival, planned_join=planned, group=f'g{group_id}', group_size=len(members))
                visitors.append(visitor)
            group_id += 1
            index += size
    return visitors


class Journey:
    """Shared routing and observations for discrete visitors and weighted flow."""

    def __init__(self, document, resources, deadline):
        self.document = document
        self.resources = resources
        self.deadline = deadline
        self.layout = document['venue']['layout']
        self.categories = {c['id']: c for c in document['event']['ticket_categories']}
        self.schedule = document['event']['schedule']
        self.horizon = seconds(document['constraints'].get('timing', {}).get('venue_slot_end', self.schedule.get('show_end_estimate', self.schedule['last_entry'])))
        self.groups = resources['groups']
        self.first = next((f['point'] for f in sorted(self.layout.get('visitor_flow', []), key=lambda f: f.get('order', 0)) if f.get('required') and f['point'] != 'entry_gate_of_category'), next(iter(resources['points'])))
        self.help_point = self.layout.get('exceptions_go_to', 'help_desk')
        self.locker_point = next((g['point'] for g in self.groups.values() if 'locker_dropoff' in g['definition'].get('steps', [])), None)
        self.priority = next((p['id'] for p in resources['points'].values() if p.get('also_serves') == 'accessible_visitors' and p['is_gate']), None)
        self.paths = {}
        for path in self.layout.get('walking_paths', []):
            self.paths[path['from'], path['to']] = path['distance_m']
            self.paths[path['to'], path['from']] = path['distance_m']
        self.events = []
        self.serial = itertools.count()
        self.visitors = []
        self.attendance = 0.0
        self.terminal = []
        self.joins = defaultdict(list)
        self.starts = defaultdict(list)
        self.finishes = defaultdict(list)
        self.zone_events = defaultdict(list)
        self.work = defaultdict(list)
        self.lane_busy = defaultdict(list)
        self.exception_counts = defaultdict(float)
        self.support = defaultdict(float)
        self.arrivals = []
        self.locker_used = 0.0
        item = resources['equipment'].get('locker_unit', {})
        self.locker_stock = item.get('available', 0) + item.get('extra_rented', 0)
        self.locker_full_at = None

    def push(self, at, priority, kind, payload, stable=''):
        heapq.heappush(self.events, (at, priority, stable, next(self.serial), kind, payload))

    def zone(self, visitor, zone, now):
        old = visitor.get('zone')
        if old:
            self.zone_events[old].append((now, -visitor['weight']))
        visitor['zone'] = zone
        if zone:
            self.zone_events[zone].append((now, visitor['weight']))

    def refuse(self, visitor, now, reason, point):
        self.zone(visitor, None, now)
        visitor.update(state='refused', refused_at=now, reason=reason, refused_where=point)
        self.terminal.append(visitor)

    def group_for(self, visitor, point, duty=False):
        choices = [g for g in self.groups.values() if g['point'] == point and g['duty'] == duty]
        if duty:
            choices = [g for g in choices if any(applicable(self.resources['steps'][s], visitor) for s in g['definition']['steps'])]
        else:
            preferred = [g for g in choices if visitor['accessible'] and g['definition'].get('also_serves') == 'accessible_visitors']
            if preferred:
                choices = preferred
            else:
                choices = [g for g in choices if not g['definition'].get('serves_categories') or visitor['category'] in g['definition']['serves_categories']]
            choices = [g for g in choices if not g['definition'].get('visitor_gender') or g['definition']['visitor_gender'] == visitor['gender']]
        return min(choices, key=lambda g: g['id'])['id'] if choices else None

    def walk(self, visitor, origin, target, now, gate=False):
        duration = self.paths.get((origin, target), 0)
        visitor['walking_seconds'] = visitor.get('walking_seconds', 0) + duration
        self.zone(visitor, None, now)
        visitor['state'] = 'walking'
        self.push(now + duration, 1, 'gate_join' if gate else 'join_point', (visitor, target), visitor['id'])

    def gate_target(self, visitor):
        return self.priority if visitor['accessible'] and self.priority else self.categories[visitor['category']]['entry_gate']

    def route_gate(self, visitor, origin, now):
        target = self.gate_target(visitor)
        ready = now
        planned = visitor.get('planned_join')
        join = ready if planned is None else max(planned, ready + visitor['join_delay'])
        join = max(join, seconds(self.schedule.get('outer_area_open', '00:00')))
        visitor['gate_join_hold_seconds'] = visitor.get('gate_join_hold_seconds', 0) + join - now
        self.zone(visitor, 'zone_forecourt', now)
        visitor['state'] = 'gate_join_holding'
        self.push(join, 1, 'walk_gate', (visitor, origin, target), visitor['id'])

    def after_redemption(self, visitor, point, now):
        visitor['redeemed_at'] = now
        if visitor['locker'] and not visitor.get('locker_done') and self.locker_point:
            self.walk(visitor, point, self.locker_point, now)
        else:
            self.route_gate(visitor, point, now)

    def depart(self, visitor, gid, now, outcome):
        group = self.groups[gid]
        point = group['point']
        self.finishes[gid].append((now, visitor['weight'], visitor['category']))
        if outcome:
            name = outcome['outcome']
            self.exception_counts[outcome.get('id', name)] += visitor['weight']
            if name == 'help_desk':
                visitor['exception_reason'] = outcome.get('id', name)
            else:
                visitor.pop('exception_reason', None)
            if name == 'refuse_entry':
                self.refuse(visitor, now, outcome.get('id', name), point)
            elif name == 'step_aside_and_return':
                self.zone(visitor, None, now)
                visitor['state'] = 'returning'
                self.push(now + outcome.get('delay', 0), 1, 'join_group', (visitor, gid), visitor['id'])
            elif name == 'help_desk':
                visitor['exception'] = True
                self.walk(visitor, point, self.help_point, now)
            elif name == 'locker_point':
                visitor['locker'] = True
                visitor['locker_done'] = False
                visitor['return_gate'] = point
                if self.locker_point:
                    self.walk(visitor, point, self.locker_point, now)
                else:
                    self.refuse(visitor, now, 'locker_unavailable', point)
            elif name == 'redirect_to_correct_gate':
                self.walk(visitor, point, self.gate_target(visitor), now, gate=True)
            elif name == 'back_to_redemption':
                visitor['redeemed_at'] = None
                self.walk(visitor, point, self.first, now)
            return
        if group['duty']:
            visitor['escorted'] = True
            self.support['escorted_visitors'] += visitor['weight']
            self.join_point(visitor, point, now)
        elif point == self.help_point:
            self.help_complete(visitor, point, now)
        elif point == self.locker_point:
            self.locker_complete(visitor, point, now)
        elif group['is_gate']:
            visitor.update(state='admitted', admitted_at=now)
            self.terminal.append(visitor)
            leads = self.resources['points'][point].get('leads_to', [])
            destination = self.destination(visitor, leads)
            holding = next((z for z in leads if any(zone['id'] == z and zone.get('type') == 'holding' for zone in self.layout.get('zones', []))), None)
            self.zone(visitor, holding or destination, now)
            if holding and destination != holding:
                self.push(now + 600, 1, 'destination', (visitor, destination), visitor['id'])
            elif holding:
                self.push(now + 600, 1, 'destination', (visitor, None), visitor['id'])
        else:
            self.after_redemption(visitor, point, now)

    def destination(self, visitor, leads):
        zones = self.layout.get('zones', [])
        if visitor['accessible'] and self.categories[visitor['category']].get('admission') == 'standing':
            return next((z['id'] for z in zones if z.get('wheelchair_places')), None)
        exact = 'zone_' + visitor['category']
        if any(z['id'] == exact for z in zones):
            return exact
        return next((z for z in leads if any(zone['id'] == z and zone.get('type') in ('seating', 'standing') for zone in zones)), None)

    def help_complete(self, visitor, point, now):
        step = self.resources['steps'].get('help_desk_resolution', {})
        probability = step.get('results', {}).get('resolved_percent', 100) / 100
        if visitor['help_resolved_draw'] < probability:
            self.support['help_resolved'] += visitor['weight']
            self.after_redemption(visitor, point, now)
        else:
            self.support['help_refused'] += visitor['weight']
            self.refuse(visitor, now, visitor.get('exception_reason', 'help_desk_unresolved'), point)

    def locker_complete(self, visitor, point, now):
        visitor['locker_done'] = True
        visitor['locker_reserved'] = False
        self.route_gate(visitor, point, now)

    def join_point(self, visitor, point, now):
        if visitor.get('accessible') and not visitor.get('escorted') and point == self.priority:
            duty = self.group_for(visitor, point, True)
            if duty:
                self.join(visitor, duty, now)
                return
        gid = self.group_for(visitor, point)
        if gid is None:
            visitor['state'] = 'no_eligible_lane'
            return
        if point == self.locker_point and not visitor.get('locker_reserved'):
            self.support['locker_demand'] += visitor['weight']
            if self.locker_used + visitor['weight'] > self.locker_stock:
                self.locker_reject(visitor, point, now)
                return
            self.locker_used += visitor['weight']
            visitor['locker_reserved'] = True
            if self.locker_used >= self.locker_stock and self.locker_full_at is None:
                self.locker_full_at = now
        if point == self.help_point:
            self.support['help_cases'] += visitor['weight']
        self.join(visitor, gid, now)

    def locker_reject(self, visitor, point, now):
        self.support['locker_turned_away'] += visitor['weight']
        visitor.update(locker_done=True, state='item_removal')
        self.zone(visitor, None, now)
        self.push(now + visitor['locker_remove_seconds'], 1, 'locker_removed', (visitor, point), visitor['id'])

    def observe_join(self, visitor, gid, now):
        visitor.update(queue_join=now, current_group=gid, state='queued')
        self.zone(visitor, self.resources['points'][self.groups[gid]['point']].get('queue_zone'), now)
        self.joins[gid].append((now, visitor['weight'], visitor['category'], visitor['id']))

    def observe_start(self, visitor, gid, now):
        group = self.groups[gid]
        wait = max(0, now - max(visitor['queue_join'], group['opens']))
        hold = max(0, min(now, group['opens']) - visitor['queue_join'])
        visitor['wait_seconds'] = visitor.get('wait_seconds', 0) + wait
        visitor['opening_hold_seconds'] = visitor.get('opening_hold_seconds', 0) + hold
        visitor.setdefault('point_waits', {})[group['point']] = visitor.get('point_waits', {}).get(group['point'], 0) + wait
        self.starts[gid].append((now, visitor['weight'], wait, hold, visitor['category'], visitor['id'], visitor['queue_join']))
        visitor['state'] = 'service'
        self.zone(visitor, self.resources['points'][group['point']].get('zone'), now)

    def dispatch_route(self, now, kind, payload):
        if kind == 'arrival':
            visitor = payload
            self.arrivals.append((now, visitor['weight'], visitor['category'], visitor.get('group'), visitor.get('group_size', 1)))
            self.walk(visitor, 'zone_drop_off', self.first, now)
        elif kind == 'join_point':
            self.join_point(*payload, now)
        elif kind == 'gate_join':
            self.join_point(*payload, now)
        elif kind == 'join_group':
            self.join(*payload, now)
        elif kind == 'walk_gate':
            visitor, origin, target = payload
            self.walk(visitor, origin, target, now, gate=True)
        elif kind == 'locker_removed':
            visitor, point = payload
            self.route_gate(visitor, point, now)
        elif kind == 'destination':
            self.zone(*payload, now)

    def result(self):
        admitted = sum(v['weight'] for v in self.terminal if v['state'] == 'admitted')
        refused = sum(v['weight'] for v in self.terminal if v['state'] == 'refused')
        unfinished = self.attendance - admitted - refused
        states = defaultdict(float)
        for visitor in self.visitors:
            if visitor.get('state') not in ('admitted', 'refused', 'split'):
                states[visitor.get('state', 'not_arrived')] += visitor['weight']
        return dict(attendance=self.attendance, admitted=admitted, refused=refused, unfinished=max(0, unfinished), unfinished_states=dict(states), visitors=self.visitors, terminal=self.terminal, joins=dict(self.joins), starts=dict(self.starts), finishes=dict(self.finishes), zone_events=dict(self.zone_events), work=dict(self.work), lane_busy=dict(self.lane_busy), exception_counts=dict(self.exception_counts), support=dict(self.support), arrivals=self.arrivals, locker_used=self.locker_used, locker_full_at=self.locker_full_at, horizon=self.horizon)


class DiscreteSimulation(Journey):
    def __init__(self, document, resources, seed, deadline):
        super().__init__(document, resources, deadline)
        self.rng = random.Random(int.from_bytes(hashlib.sha256(f'{seed}:service'.encode()).digest()[:8], 'big'))
        self.queues = {gid: deque() for gid in self.groups}
        self.lanes = {}
        self.lane_groups = {}
        for gid, group in self.groups.items():
            lanes = []
            for configuration in group['lanes']:
                def service(visitor, pos, server, now, gid=gid, config=configuration):
                    position = config['positions'][pos]
                    duration, outcome = sample_position(position, resources['steps'], visitor, self.rng)
                    worker = position['staff'][server]
                    self.work[worker].append((now, min(now + duration, self.horizon), gid))
                    visitor['service_seconds'] = visitor.get('service_seconds', 0) + min(duration, max(0, self.horizon - now))
                    return duration, outcome
                def schedule(at, lane, pos, server, gid=gid, index=configuration['index']):
                    self.push(at, 0, 'complete', (lane, pos, server, gid), f'{gid}/{index}/{pos}/{server}')
                def departed(visitor, now, outcome, gid=gid):
                    self.depart(visitor, gid, now, outcome)
                def released(visitor, now, start, gid=gid):
                    self.lane_busy[gid].append((start, min(now, self.horizon)))
                lane = Lane(configuration['positions'], schedule, service, departed, released)
                lanes.append((lane, configuration))
            self.lanes[gid] = lanes
            self.push(group['opens'], 2, 'open', gid, gid)
            for _, config in lanes:
                if config['available_from'] > group['opens']:
                    self.push(config['available_from'], 2, 'open', gid, gid)
            self.push(group['closes'], 3, 'close', gid, gid)
        self.visitors = generate_visitors(document, seed, deadline)
        self.group_members = defaultdict(list)
        self.group_waiters = defaultdict(dict)
        for visitor in self.visitors:
            self.group_members[visitor['group']].append(visitor)
        self.attendance = len(self.visitors)
        for visitor in self.visitors:
            self.push(visitor['arrival'], 1, 'arrival', visitor, visitor['id'])

    def route_gate(self, visitor, origin, now):
        if visitor.get('gate_synchronized'):
            return super().route_gate(visitor, origin, now)
        key = (visitor['group'], self.gate_target(visitor))
        visitor['state'] = 'group_holding'
        self.zone(visitor, 'zone_forecourt', now)
        self.group_waiters[key][visitor['id']] = (visitor, origin, now)
        self.release_group(key, now)

    def release_group(self, key, now):
        waiting = self.group_waiters.get(key)
        if not waiting:
            return
        expected = [v for v in self.group_members[key[0]] if self.gate_target(v) == key[1] and v.get('state') != 'refused' and not v.get('gate_synchronized')]
        if any(v['id'] not in waiting for v in expected):
            return
        records = list(self.group_waiters.pop(key).values())
        target = key[1]
        join_at = now
        for visitor, origin, ready in records:
            planned = visitor.get('planned_join')
            join = now if planned is None else max(planned, now + visitor['join_delay'])
            join = max(join, seconds(self.schedule.get('outer_area_open', '00:00')))
            join_at = max(join_at, join + self.paths.get((origin, target), 0))
        for visitor, origin, ready in records:
            duration = self.paths.get((origin, target), 0)
            visitor['gate_synchronized'] = True
            visitor['group_hold_seconds'] = visitor.get('group_hold_seconds', 0) + now - ready
            visitor['gate_join_hold_seconds'] = visitor.get('gate_join_hold_seconds', 0) + join_at - duration - now
            visitor['state'] = 'gate_join_holding'
            self.push(join_at - duration, 1, 'walk_gate', (visitor, origin, target), visitor['id'])

    def refuse(self, visitor, now, reason, point):
        super().refuse(visitor, now, reason, point)
        if hasattr(self, 'group_waiters'):
            for key in list(self.group_waiters):
                if key[0] == visitor.get('group'):
                    self.group_waiters[key].pop(visitor['id'], None)
                    self.release_group(key, now)

    def join(self, visitor, gid, now):
        group = self.groups[gid]
        if now >= group['closes']:
            self.refuse(visitor, now, 'last_entry_passed' if group['is_gate'] else 'redemption_closed' if group['point'] == self.first else 'point_closed', group['point'])
            return
        self.observe_join(visitor, gid, now)
        self.queues[gid].append(visitor)
        self.fill(gid, now)

    def fill(self, gid, now):
        group = self.groups[gid]
        if not group['opens'] <= now < group['closes']:
            return
        for lane, config in self.lanes[gid]:
            while self.queues[gid] and lane.free() and now >= config['available_from']:
                visitor = self.queues[gid].popleft()
                self.observe_start(visitor, gid, now)
                lane.start(visitor, now)

    def run(self):
        processed = 0
        while self.events:
            now, _, _, _, kind, payload = heapq.heappop(self.events)
            if now > self.horizon:
                break
            if processed % 256 == 0:
                check_deadline(self.deadline)
            processed += 1
            if kind == 'complete':
                lane, position, server, gid = payload
                lane.complete(position, server, now)
                self.fill(gid, now)
            elif kind == 'open':
                self.fill(payload, now)
            elif kind == 'close':
                group = self.groups[payload]
                while self.queues[payload]:
                    self.refuse(self.queues[payload].popleft(), now, 'last_entry_passed' if group['is_gate'] else 'redemption_closed' if group['point'] == self.first else 'point_closed', group['point'])
            else:
                self.dispatch_route(now, kind, payload)
        for gid, lanes in self.lanes.items():
            for lane, _ in lanes:
                for slot in lane.slots[0]:
                    if slot:
                        self.lane_busy[gid].append((slot[3], self.horizon))
        result = self.result()
        result['events_processed'] = processed
        return result


def simulate_des(document, resources, seed, deadline):
    return DiscreteSimulation(document, resources, seed, deadline).run()
