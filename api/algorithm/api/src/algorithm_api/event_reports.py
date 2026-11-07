"""Computed service reports, replication intervals, checks, and source templates."""

import math
import re
from collections import defaultdict
from statistics import mean

from .event_capacity import check_deadline, clock, seconds
from .event_des import demand_inputs


def percentile(values, share):
    if not values:
        return 0.0
    values = sorted(values)
    location = (len(values) - 1) * share / 100
    low = int(location)
    high = min(len(values) - 1, low + 1)
    return values[low] + (values[high] - values[low]) * (location - low)


def interval(values):
    return dict(mean=mean(values), p05=percentile(values, 5), p95=percentile(values, 95))


def weighted_percentile(values, share):
    if not values:
        return 0.0
    threshold = math.fsum(weight for _, weight in values) * share / 100
    cumulative = 0.0
    for value, weight in sorted(values):
        cumulative += weight
        if cumulative >= threshold - 1e-12:
            return value
    return max(value for value, _ in values)


def occupancy(events, horizon):
    deltas = defaultdict(float)
    for at, delta in events:
        if at <= horizon:
            deltas[at] += delta
    current = 0.0
    peak = 0.0
    peak_at = 0.0
    series = []
    for at, delta in sorted(deltas.items()):
        current += delta
        if abs(current) < 1e-9:
            current = 0.0
        series.append((at, current))
        if current > peak:
            peak, peak_at = current, at
    return dict(peak=peak, at=peak_at, series=series)


def overlaps(intervals, start, end):
    return math.fsum(max(0, min(b, end) - max(a, start)) for a, b, *_ in intervals)


def sample_metrics(document, resources, sample, method):
    categories = document['event']['ticket_categories']
    groups = resources['groups']
    horizon = sample['horizon']
    metric = dict(wait={}, queue={}, density={}, costs={}, starts=sample['starts'])
    for gid, group in groups.items():
        records = sample['starts'].get(gid, [])
        pairs = [(r[2] / 60, r[1]) for r in records]
        queue_events = [(r[0], r[1]) for r in sample['joins'].get(gid, [])] + [(r[0], -r[1]) for r in records]
        queue = occupancy(queue_events, horizon)
        queue['series'] = [(at, amount if at < group['closes'] else 0) for at, amount in queue['series']]
        joins_before = sum(r[1] for r in sample['joins'].get(gid, []) if r[0] < group['opens'])
        backlog_starts = [r[0] for r in records if r[6] < group['opens']]
        waits_late = [r[0] for r in records if r[0] >= queue['at'] and r[2] >= 300]
        metric['wait'][gid] = dict(p90=weighted_percentile(pairs, 90), maximum=max((x for x, _ in pairs), default=0), average=sum(x * w for x, w in pairs) / sum((w for _, w in pairs), 1e-300), pairs=pairs)
        metric['queue'][gid] = dict(**queue, backlog=joins_before, cleared_at=max(backlog_starts, default=group['opens']), clear_minutes=(max(backlog_starts, default=group['opens']) - group['opens']) / 60,
                                    wait_under_5_from=max(waits_late, default=queue['at']) + (60 if waits_late else 0))
    for zone in document['venue']['layout'].get('zones', []):
        metric['density'][zone['id']] = occupancy(sample['zone_events'].get(zone['id'], []), horizon)
    shift_cost = meals = packages = overtime = overtime_hours = 0
    role_costs = []
    for rid, role in resources['roles'].items():
        people = role['count']
        shift = 0 if role.get('cost_model') == 'package' else people * role.get('rate_idr_per_shift', 0)
        meal = 0 if role.get('meals_included_in_package') else people * document['staff'].get('meal_allowance_idr_per_person', 0)
        package = role.get('package_idr', 0) if role.get('cost_model') == 'package' else 0
        hours = 0
        for worker, person in resources['people'].items():
            if person['role'] == rid:
                last = max((b for _, b, _ in sample['work'].get(worker, [])), default=person['end'])
                hours += math.ceil(max(0, last - person['end']) / 3600)
        extra = hours * role.get('overtime_idr_per_hour', 0)
        role_costs.append(dict(role=rid, people=people, rate_idr_per_shift=role.get('rate_idr_per_shift', 0), shift_idr=shift, meal_idr=meal, package_idr=package, overtime_idr=extra, total_idr=shift + meal + package + extra))
        shift_cost += shift
        meals += meal
        packages += package
        overtime += extra
        overtime_hours += hours
    metric['costs'] = dict(total_idr=shift_cost + meals + packages + overtime, components_idr=dict(shift_rates=shift_cost, overtime=overtime, meal_allowance=meals, medical_package=packages), overtime_hours=overtime_hours, roles=role_costs)
    category_attendance = defaultdict(float)
    if method == 'des':
        for visitor in sample['visitors']:
            category_attendance[visitor['category']] += visitor['weight']
    else:
        for category in categories:
            category_attendance[category['id']] = (category.get('sold', 0) + category.get('issued', 0)) * (1 - document['event']['capacity'].get('no_show_percent_estimate', 0) / 100)
    metric['category_attendance'] = dict(category_attendance)
    metric['inside'] = {}
    metric['outside'] = {}
    for moment, value in document['event']['schedule'].items():
        if not isinstance(value, str) or not re.fullmatch(r'\d\d:\d\d', value):
            continue
        at = seconds(value)
        admitted = defaultdict(float)
        refused = defaultdict(float)
        arrived = defaultdict(float)
        for visitor in sample['terminal']:
            if visitor.get('admitted_at', math.inf) <= at:
                admitted[visitor['category']] += visitor['weight']
            if visitor.get('refused_at', math.inf) <= at:
                refused[visitor['category']] += visitor['weight']
        for time, amount, cid, *_ in sample['arrivals']:
            if time <= at:
                arrived[cid] += amount
        metric['inside'][moment] = dict(admitted)
        metric['outside'][moment] = {cid: max(0, arrived[cid] - admitted[cid] - refused[cid]) for cid in category_attendance}
    return metric


def get_path(document, path):
    current = [document]
    for part in re.split(r'\.(?![^\[]*\])', path):
        match = re.fullmatch(r'([^\[]+)(?:\[([^\]]+)\])?', part)
        if not match:
            return None
        name, selector = match.groups()
        values = []
        for item in current:
            value = item.get(name) if isinstance(item, dict) else None
            if selector and isinstance(value, list):
                if selector == '*':
                    values.extend(value)
                elif '=' in selector:
                    key, wanted = selector.split('=', 1)
                    values.extend(x for x in value if str(x.get(key)) == wanted)
            elif value is not None:
                values.append(value)
        current = values
    values = [x.get('mean', x) if isinstance(x, dict) else x for x in current]
    return values[0] if len(values) == 1 else values if values else None


def rules(document, resources):
    points = resources['points']
    groups = resources['groups']
    roles = resources['roles']
    results = []
    for rule in document['constraints'].get('rules', {}).get('items', []):
        rid = rule['id']
        status = 'not_tested'
        if rid == 'rule_same_gender_search':
            status = 'pass' if all(not g['definition'].get('visitor_gender') or all(person['gender'] == g['definition']['visitor_gender'] for lane in g['lanes'] for person in lane['staff'] if 'body_search' in person['can_do']) for g in groups.values() if 'body_search' in g['definition'].get('steps', [])) else 'fail'
        elif rid == 'rule_certified_security':
            status = 'pass' if all(person.get('certification') for g in groups.values() for lane in g['lanes'] for person in lane['staff'] if any(step in person['can_do'] and step in g['definition'].get('steps', []) for step in ('bag_check', 'body_search'))) else 'fail'
        elif rid == 'rule_id_check_all':
            first = next((f['point'] for f in document['venue']['layout'].get('visitor_flow', []) if f.get('required') and f['point'] != 'entry_gate_of_category'), None)
            status = 'pass' if all('ktp_name_match' in g['definition'].get('steps', []) for g in groups.values() if g['point'] == first) else 'fail'
        elif rid == 'rule_supervisor_per_gate':
            status = 'pass' if all(any('body_search' in role.get('can_do', []) and any(a.get('point') == pid and a.get('duty') == 'supervisor' and a.get('count', 0) > 0 for a in role.get('assignment', [])) for role in roles.values()) for pid, point in points.items() if point['is_gate']) else 'fail'
        elif rid == 'rule_priority_gate_open':
            priority = next((p for p in points.values() if p['is_gate'] and p.get('also_serves') == 'accessible_visitors'), None)
            status = 'pass' if priority and all(seconds(priority['opens']) <= seconds(p['opens']) and seconds(priority['closes']) >= seconds(p['closes']) for p in points.values() if p['is_gate']) else 'fail'
        elif rid == 'rule_friday_prayer':
            starts = [seconds(s['start']) for s in resources['shifts'].values()]
            briefing = document['event']['schedule'].get('crew_briefing')
            if briefing:
                starts.append(seconds(briefing))
            status = 'fail' if document['event'].get('day_of_week', '').lower() == 'friday' and any(seconds('11:30') <= t <= seconds('12:45') for t in starts) else 'pass'
        results.append(dict(rule=rid, status=status))
    return results


def build_report(document, resources, samples, settings, deadline, versions):
    """Construct source report sections from observed events without display rounding."""
    check_deadline(deadline)
    method = settings['simulation_method']
    metrics = [sample_metrics(document, resources, sample, method) for sample in samples]
    groups = resources['groups']
    points = resources['points']
    categories = document['event']['ticket_categories']
    zones = document['venue']['layout'].get('zones', [])
    mean_value = lambda values: mean(list(values))
    stat = lambda fn: interval([fn(s, m) for s, m in zip(samples, metrics)])
    first = next((f['point'] for f in document['venue']['layout'].get('visitor_flow', []) if f.get('required') and f['point'] != 'entry_gate_of_category'), None)
    output = dict(schema_version='0.1', meta=dict(document='opsidio_event_output', example=False, currency='IDR', timezone='Asia/Jakarta'), sources=document.get('sources', {}))
    output['run_manifest'] = dict(status='completed', plan=dict(document='opsidio_event_input', schema_version='0.1', event_id=document['event'].get('id'), plan_hash_rule='SHA-256 of canonical UTF-8 JSON with sorted keys and compact separators.'),
        model=dict(engine='opsidio-event-entry', engine_version=versions['engine'], capacity_model_version=versions['capacity'], method=method, simulated_window=dict(start=clock(min(g['opens'] for g in groups.values())), end=clock(samples[0]['horizon']))),
        replications=dict(count=settings['replications'], base_seed=settings['base_seed']), resolved_settings=settings,
        derived_inputs={cid: dict(basis=d['basis'], arrival_windows_percent={f'{clock(a)}-{clock(b)}': w * 100 for a, b, w in d['windows']}, gate_join_window=d['gate_join'] if isinstance(d['gate_join'], str) else '-'.join(clock(v) for v in d['gate_join'])) for cid, d in demand_inputs(document).items()},
        assumptions=['Step service uses capped lognormal distributions: median typical, P90 slow, cap three times slow.', 'Each intermediate position buffer holds one waiting visitor.', 'Floaters cover meal breaks; individual break schedules are not modeled.', 'Walking speed is 1.0 m/s on declared paths.', 'Gate-window holding uses zone_forecourt.', 'Destination holding lasts ten minutes.', 'A full locker causes ten to twenty minutes of item-removal delay.', 'Zone density assumes an even spatial distribution.', 'Each accessible standing-ticket visitor needs one wheelchair place.'],
        uncomputed_fields=['peak_density.open_air_exposure.with_rain_plan_persons', 'bottleneck_report.episodes[].moves_to'] + (['wait_time.by_category[].all_queues_p90_minutes'] if method == 'flow' else []),
        quality_checks=[dict(id='qc_visitor_balance', status='pass' if all(abs(s['attendance'] - s['admitted'] - s['refused'] - s['unfinished']) <= 1e-8 for s in samples) else 'fail')],
        resource_shortfalls=resources['shortages'])
    lane_rows = []
    clearance = []
    wait_groups = []
    for gid, group in groups.items():
        check_deadline(deadline)
        lane_rows.append(dict(lane_group=gid, requested_lanes=group['requested_lanes'], operational_lanes=group['operational_lanes'], lanes=group['operational_lanes'], max_persons=stat(lambda s, m: m['queue'][gid]['peak']), at=clock(mean_value(m['queue'][gid]['at'] for m in metrics)),
                              positions=[{k: p[k] for k in ('steps', 'roles', 'servers')} for p in group['lanes'][0]['positions']] if group['lanes'] else [],
                              capacity_per_lane_per_minute=samples[0].get('capacities', {}).get(gid, {}).get('visitors_per_minute')))
        clearance.append(dict(lane_group=gid, opens=clock(group['opens']), backlog_persons=stat(lambda s, m: m['queue'][gid]['backlog']), backlog_per_lane=mean_value(m['queue'][gid]['backlog'] for m in metrics) / group['operational_lanes'] if group['operational_lanes'] else None,
                              minutes=stat(lambda s, m: m['queue'][gid]['clear_minutes']), cleared_at=clock(mean_value(m['queue'][gid]['cleared_at'] for m in metrics)), wait_under_5_minutes_from=clock(mean_value(m['queue'][gid]['wait_under_5_from'] for m in metrics))))
        wait_groups.append(dict(lane_group=gid, p90_minutes=stat(lambda s, m: m['wait'][gid]['p90']), mean_minutes=mean_value(m['wait'][gid]['average'] for m in metrics), max_minutes=stat(lambda s, m: m['wait'][gid]['maximum'])))
    gate_backlogs = [r['backlog_per_lane'] for r in clearance if groups[r['lane_group']]['is_gate'] and not groups[r['lane_group']]['duty'] and r['backlog_per_lane'] is not None]
    output['time_to_clear'] = dict(basis='simulated', lane_groups=clearance, gate_balance=dict(imbalance_index=max(gate_backlogs, default=0) / mean(gate_backlogs) if gate_backlogs and mean(gate_backlogs) else 0))
    safety_limits = document['constraints'].get('safety', {}).get('max_density_persons_per_m2', {})
    zone_rows = []
    density_rows = []
    for zone in zones:
        zid = zone['id']
        area = zone.get('area_m2')
        limit = safety_limits.get('queue_zones' if zone.get('type') == 'queue' else 'standing_floor' if zone.get('type') == 'standing' else zid.removeprefix('zone_'))
        peak = stat(lambda s, m: m['density'][zid]['peak'])
        at = clock(mean_value(m['density'][zid]['at'] for m in metrics))
        holding_capacity = area * limit if area and limit else None
        zone_rows.append(dict(zone=zid, max_persons=peak, at=at, holding_capacity_persons=holding_capacity, fill_at_max_percent=peak['mean'] / holding_capacity * 100 if holding_capacity else None))
        if area:
            density = {key: value / area for key, value in peak.items()}
            above = []
            for sample, metric in zip(samples, metrics):
                series = metric['density'][zid]['series']
                above.append(sum(max(0, b[0] - a[0]) for a, b in zip(series, series[1:] + [(sample['horizon'], 0)]) if limit and a[1] / area > limit) / 60)
            level = next((label for ceiling, label in [(0.83, 'A'), (1.11, 'B'), (1.43, 'C'), (3.33, 'D'), (5, 'E'), (math.inf, 'F')] if density['mean'] <= ceiling), 'F')
            density_rows.append(dict(zone=zid, peak_persons_per_m2=density, at=at, limit_persons_per_m2=limit, share_of_limit_percent=density['mean'] / limit * 100 if limit else None, minutes_above_limit=mean(above), level_of_service=level))
    output['max_queue_length'] = dict(basis='simulated', lane_groups=lane_rows, zones=zone_rows)
    open_air_samples = []
    for sample in samples:
        events = []
        for zone in zones:
            factor = 1 - zone.get('covered_percent', 100 if zone.get('type') in ('standing', 'seating') else 0) / 100
            events.extend((at, amount * factor) for at, amount in sample['zone_events'].get(zone['id'], []))
        open_air_samples.append(occupancy(events, sample['horizon']))
    output['peak_density'] = dict(basis='simulated', limitation='Aggregate occupancy divided by declared area; no spatial crowd interactions are modeled.', zones=density_rows,
                                  open_air_exposure=dict(peak_persons=interval([x['peak'] for x in open_air_samples]), at=clock(mean(x['at'] for x in open_air_samples)), with_rain_plan_persons=None))
    wait_points = []
    for pid in points:
        values = []
        for sample, metric in zip(samples, metrics):
            if method == 'des':
                pairs = [(v.get('point_waits', {}).get(pid, 0) / 60, v['weight']) for v in sample['visitors'] if pid in v.get('point_waits', {})]
            else:
                pairs = [pair for gid in groups if groups[gid]['point'] == pid for pair in metric['wait'][gid]['pairs']]
            values.append(dict(p90=weighted_percentile(pairs, 90), max=max((x for x, _ in pairs), default=0), average=sum(x * w for x, w in pairs) / sum((w for _, w in pairs), 1e-300)))
        wait_points.append(dict(point=pid, p90_minutes=interval([v['p90'] for v in values]), mean_minutes=mean(v['average'] for v in values), max_minutes=interval([v['max'] for v in values])))
    wait_categories = []
    for category in categories:
        cid = category['id']
        redemption = []
        gate = []
        all_wait = []
        for sample in samples:
            rpairs = [(r[2] / 60, r[1]) for gid, records in sample['starts'].items() if groups[gid]['point'] == first for r in records if r[4] == cid]
            gpairs = [(r[2] / 60, r[1]) for gid, records in sample['starts'].items() if groups[gid]['is_gate'] for r in records if r[4] == cid]
            redemption.append(weighted_percentile(rpairs, 90))
            gate.append(weighted_percentile(gpairs, 90))
            all_wait.append(weighted_percentile([(v.get('wait_seconds', 0) / 60, v['weight']) for v in sample['visitors'] if v['category'] == cid], 90))
        wait_categories.append(dict(category=cid, redemption_p90_minutes=interval(redemption), gate_p90_minutes=interval(gate), all_queues_p90_minutes=interval(all_wait) if method == 'des' else None))
    holds = [[(r[3] / 60, r[1], groups[gid]['point']) for gid, rows in s['starts'].items() for r in rows] for s in samples]
    most_hold_point = max(points, key=lambda pid: sum(w for rows in holds for t, w, point in rows if point == pid and t > 60), default=None)
    output['wait_time'] = dict(basis='simulated', by_point=wait_points, by_lane_group=wait_groups, by_category=wait_categories,
        pre_open_holding=dict(zone=points[most_hold_point].get('queue_zone') if most_hold_point else None, p90_minutes=interval([weighted_percentile([(t, w) for t, w, _ in rows], 90) for rows in holds]), over_60_minutes_persons=mean(sum(w for t, w, _ in rows if t > 60) for rows in holds)),
        gate_join_holding=dict(person_minutes=mean(sum(v.get('gate_join_hold_seconds', 0) / 60 * v['weight'] for v in s['visitors']) for s in samples)),
        walking=dict(person_minutes=mean(sum(v.get('walking_seconds', 0) / 60 * v['weight'] for v in s['visitors']) for s in samples)),
        service=dict(person_minutes=mean(sum(v.get('service_seconds', 0) / 60 * v['weight'] for v in s['visitors']) for s in samples)))
    outcomes = dict(basis='simulated', attendance_persons=stat(lambda s, m: s['attendance']), admitted_persons=stat(lambda s, m: s['admitted']), refused_persons=mean(s['refused'] for s in samples), still_outside_at_end_persons=mean(s['unfinished'] for s in samples), unfinished_states={key: mean(s['unfinished_states'].get(key, 0) for s in samples) for key in sorted(set().union(*(s['unfinished_states'] for s in samples)))}, inside_at=[], on_site_but_outside={}, by_category=[])
    for moment in ('opening_act', 'main_act'):
        if moment not in document['event']['schedule']:
            continue
        outcomes['inside_at'].append(dict(moment=moment, clock=document['event']['schedule'][moment], share_of_attendance_percent=stat(lambda s, m: sum(m['inside'][moment].values()) / s['attendance'] * 100 if s['attendance'] else 0)))
        outcomes['on_site_but_outside'][f'at_{moment}_persons'] = stat(lambda s, m: sum(m['outside'][moment].values()))
    main_time = seconds(document['event']['schedule']['main_act'])
    outcomes['arrived_after_main_act_persons'] = mean(sum(amount for at, amount, *_ in s['arrivals'] if at > main_time) for s in samples)
    reasons = sorted({v['reason'] for s in samples for v in s['terminal'] if v['state'] == 'refused'})
    outcomes['refused_by_reason'] = [dict(reason=reason, where=sorted({v['refused_where'] for s in samples for v in s['terminal'] if v.get('reason') == reason}), persons=mean(sum(v['weight'] for v in s['terminal'] if v.get('reason') == reason) for s in samples)) for reason in reasons]
    for category in categories:
        cid = category['id']
        outcomes['by_category'].append(dict(category=cid, attending_persons=mean(m['category_attendance'].get(cid, 0) for m in metrics), inside_at_main_act_percent=mean(m['inside']['main_act'].get(cid, 0) / m['category_attendance'].get(cid, 1) * 100 if m['category_attendance'].get(cid) else 0 for m in metrics), outside_on_site_at_main_act_persons=mean(m['outside']['main_act'].get(cid, 0) for m in metrics)))
    output['entry_outcomes'] = outcomes
    costs = [m['costs'] for m in metrics]
    cap = document['constraints'].get('budget', {}).get('staff_cap_idr')
    total = mean(c['total_idr'] for c in costs)
    admitted = mean(s['admitted'] for s in samples)
    gross = sum(c.get('sold', 0) * c.get('price_idr', 0) for c in categories)
    role_costs = [{key: mean(c['roles'][i][key] for c in costs) if isinstance(value, (int, float)) else value for key, value in costs[0]['roles'][i].items()} for i in range(len(costs[0]['roles']))]
    output['staffing_cost'] = dict(basis='computed', cap_idr=cap, total_idr=total, headroom_idr=cap - total if cap is not None else None, share_of_cap_percent=total / cap * 100 if cap else None,
        components_idr={key: mean(c['components_idr'][key] for c in costs) for key in costs[0]['components_idr']}, overtime=dict(hours=mean(c['overtime_hours'] for c in costs)), roles=role_costs,
        per_admitted_visitor_idr=round(total / admitted) if admitted else None, gross_ticket_sales_idr=gross, share_of_gross_ticket_sales_percent=total / gross * 100 if gross else None,
        providers=[dict(provider=provider, people=sum(r['count'] for r in resources['roles'].values() if r.get('provider') == provider), total_idr=sum(c['total_idr'] for c in role_costs if resources['roles'][c['role']].get('provider') == provider)) for provider in sorted({r.get('provider', '') for r in resources['roles'].values()})])
    utilization = []
    nonservice = []
    for rid, role in resources['roles'].items():
        assigned = {worker for sample in samples for worker in sample['work'] if resources['people'][worker]['role'] == rid}
        if not assigned:
            nonservice.append(rid)
        shift = resources['shifts'][role['shift']]
        paid = role['count'] * (seconds(shift['end']) - seconds(shift['start'])) / 3600
        serving = mean(sum(b - a for worker in assigned for a, b, _ in s['work'].get(worker, [])) / 3600 for s in samples)
        peak_values = []
        peak_times = []
        for sample in samples:
            intervals = [row for worker in assigned for row in sample['work'].get(worker, [])]
            values = [(overlaps(intervals, at, at + 3600) / (len(assigned) * 3600) * 100 if assigned else 0, at) for at in range(seconds(shift['start']), seconds(shift['end']), 900)]
            peak, at = max(values, default=(0, seconds(shift['start'])))
            peak_values.append(peak)
            peak_times.append(at)
        utilization.append(dict(role=rid, people=role['count'], people_on_lanes=len(assigned), paid_hours=paid, serving_hours=serving, serving_share_of_paid_hours_percent=serving / paid * 100 if paid else 0, peak_hour=dict(**{'from': clock(mean(peak_times)), 'to': clock(mean(peak_times) + 3600)}, serving_percent=mean(peak_values))))
    output['staff_utilization'] = dict(basis='simulated', roles=utilization, not_modeled_roles=nonservice, lane_groups=dict(slot_minutes=15, series=[]))
    episodes = []
    for gid, group in groups.items():
        slot_values = []
        slots = list(range(group['opens'], min(group['closes'], samples[0]['horizon']), 900))
        for start in slots:
            busy = mean(overlaps(s['lane_busy'].get(gid, []), start, start + 900) / (max(1, group['operational_lanes']) * 900) * 100 for s in samples)
            starts = [r for s in samples for r in s['starts'].get(gid, []) if start <= r[0] < start + 900]
            weight = sum(r[1] for r in starts)
            wait = sum(r[1] * r[2] / 60 for r in starts) / weight if weight else 0
            slot_values.append((start, busy, wait, weight / len(samples)))
        output['staff_utilization']['lane_groups']['series'].append(dict(lane_group=gid, lanes=group['operational_lanes'], **{'from': clock(group['opens'])}, lane_busy_percent=[r[1] for r in slot_values]))
        active = [i for i, (_, busy, wait, _) in enumerate(slot_values) if busy >= 85 and wait > 5]
        clusters = []
        for i in active:
            if not clusters or i - clusters[-1][-1] > 2:
                clusters.append([i])
            else:
                clusters[-1].append(i)
        for cluster in clusters:
            start, end = slots[cluster[0]], min(group['closes'], slots[cluster[-1]] + 900)
            rows = [r for s in samples for r in s['starts'].get(gid, []) if start <= r[0] < end]
            amount = sum(r[1] for r in rows) / len(samples)
            queue_minutes = sum(r[1] * r[2] / 60 for r in rows) / len(samples)
            positions = group['lanes'][0]['positions'] if group['lanes'] else []
            binding = max(positions, key=lambda p: p['mean_seconds'] / p['servers']) if positions else None
            episodes.append(dict(id=f'bn_{len(episodes) + 1:02d}', lane_group=gid, start=clock(start), end=clock(end), lane_busy_percent=mean(slot_values[i][1] for i in range(cluster[0], cluster[-1] + 1)), positions=[dict(steps=p['steps'], role=p['roles'][0], servers=p['servers']) for p in positions], binding_step=binding['steps'][0] if binding else None, visitors_served=amount, throughput_per_lane_per_hour=amount / ((end - start) / 3600) / max(1, group['operational_lanes']), queue_minutes=queue_minutes, mean_wait_minutes=queue_minutes / amount if amount else 0, max_queue_persons=mean(m['queue'][gid]['peak'] for m in metrics), moves_to=None))
    output['bottleneck_report'] = dict(basis='simulated', ranked_by='queue_minutes', episodes=sorted(episodes, key=lambda e: -e['queue_minutes']))
    def point_wait(pid):
        return next((row['p90_minutes'] for row in wait_points if row['point'] == pid), interval([0]))
    wheelchair = [sum(v['weight'] for v in s['visitors'] if v['accessible'] and next(c for c in categories if c['id'] == v['category']).get('admission') == 'standing') for s in samples]
    places = sum(z.get('wheelchair_places', 0) for z in zones)
    output['support_services'] = dict(basis='simulated', help_desk=dict(point=document['venue']['layout'].get('exceptions_go_to', 'help_desk'), cases=stat(lambda s, m: s['support'].get('help_cases', 0)), refused_persons=mean(s['support'].get('help_refused', 0) for s in samples), resolved_persons=mean(s['support'].get('help_resolved', 0) for s in samples), wait_p90_minutes=point_wait('help_desk')),
        locker=dict(point='locker_point', demand_persons=mean(s['support'].get('locker_demand', 0) for s in samples), turned_away_persons=stat(lambda s, m: s['support'].get('locker_turned_away', 0)), full_at=clock(mean(s['locker_full_at'] for s in samples if s['locker_full_at'] is not None)) if any(s['locker_full_at'] is not None for s in samples) else None, wait_p90_minutes=point_wait('locker_point')),
        accessible_entry=dict(point=next((p['id'] for p in points.values() if p.get('also_serves') == 'accessible_visitors' and p['is_gate']), None), escorted_visitors=mean(s['support'].get('escorted_visitors', 0) for s in samples), wheelchair_places_needed=interval(wheelchair), wheelchair_places_available=places, replications_over_capacity=sum(v > places for v in wheelchair)))
    stock = []
    for eid, item in resources['equipment'].items():
        available = item.get('available', 0) + item.get('extra_rented', 0)
        used = resources['equipment_used'].get(eid, 0)
        if eid == 'locker_unit':
            used = mean(s['locker_used'] for s in samples)
        elif eid == 'wristband':
            used = mean(sum(v['weight'] for v in s['visitors'] if v.get('redeemed_at') is not None) + s['exception_counts'].get('wristband_broken_while_fitting', 0) for s in samples)
        elif eid == 'crowd_barricade_m':
            used = sum(z.get('barricade_m', 0) for z in zones)
        stock.append(dict(item=eid, available=available, used=used, spare=available - used, extra_rentable=item.get('extra_rentable', 0)))
    equipment_cost = sum(e.get('committed_cost_idr', 0) + e.get('extra_rented', 0) * e.get('extra_cost_idr_per_unit', 0) for e in resources['equipment'].values())
    output['stock_check'] = dict(items=stock, equipment_cost_idr=equipment_cost)
    start = math.floor(min((a[0] for s in samples for a in s['arrivals']), default=min(g['opens'] for g in groups.values())) / 900) * 900
    end = max((a[0] for s in samples for a in s['arrivals']), default=start)
    arrival_slots = list(range(start, int(end) + 1, 900))
    arrivals = [mean(sum(a[1] for a in s['arrivals'] if at <= a[0] < at + 900) for s in samples) for at in arrival_slots]
    peak_index = max(range(len(arrivals)), key=lambda i: arrivals[i])
    group_sizes = document.get('demand', {}).get('group_size_share_percent', {'1': 55, '2': 15, '3': 20, '4': 10})
    average_group = sum(int(k) * value for k, value in group_sizes.items()) / sum(group_sizes.values())
    modes = document['event']['audience_profile'].get('arrival_mode_percent', {})
    scanner_points = []
    for pid in points:
        values = [(mean(sum(r[1] for gid, rows in s['starts'].items() if groups[gid]['point'] == pid for r in rows if at <= r[0] < at + 900) / 15 for s in samples), at) for at in range(min(g['opens'] for g in groups.values()), samples[0]['horizon'], 900)]
        value, at = max(values, default=(0, start))
        scanner_points.append(dict(point=pid, visitors_per_minute=value, slot_start=clock(at)))
    output['arrival_and_access'] = dict(basis='simulated', arrivals_per_15min=dict(**{'from': clock(start)}, persons=arrivals, peak_at=clock(arrival_slots[peak_index]), peak_persons=arrivals[peak_index]),
        redeemed_before_doors_open_percent=mean(sum(v['weight'] for v in s['visitors'] if v.get('redeemed_at') is not None and v['redeemed_at'] < seconds(document['event']['schedule']['doors_open'])) / s['attendance'] * 100 if s['attendance'] else 0 for s in samples),
        drop_off=dict(zone='zone_drop_off', peak_vehicles_per_15min=arrivals[peak_index] / average_group * modes.get('ride_hailing_drop_off', 0) / 100, peak_at=clock(arrival_slots[peak_index])),
        private_car_groups=mean(s['attendance'] for s in samples) / average_group * modes.get('private_car', 0) / 100,
        scanner_outage_exposure=dict(points=scanner_points), outer_area_opening=dict(opens=document['event']['schedule'].get('outer_area_open'), waiting_outside_persons=stat(lambda s, m: sum(v['weight'] for v in s['visitors'] if v.get('redeemed_at') is not None and v['redeemed_at'] < seconds(document['event']['schedule'].get('outer_area_open', '00:00'))))))
    checks = []
    def add_check(cid, target_ref, name, target, values, kind, unit):
        successes = sum(v <= target if kind == 'max' else v >= target for v in values)
        average = mean(values)
        average_ok = average <= target if kind == 'max' else average >= target
        status = 'met' if successes / len(values) >= .95 else 'at_risk' if average_ok else 'missed'
        checks.append(dict(id=cid, target_ref='constraints.' + target_ref, metric=name, **{f'target_{unit}_{kind}': target, f'result_{unit}': interval(values)}, replications_met=successes, status=status, shortfall=0 if status == 'met' else max(0, (average - target if kind == 'max' else target - average) / target) if target else float(average != 0)))
    targets = document['constraints'].get('service_targets', {})
    for key, target in targets.items():
        if key in ('redemption_wait', 'gate_wait') and isinstance(target, dict):
            values = [weighted_percentile([pair for gid in groups if (groups[gid]['point'] == first if key == 'redemption_wait' else groups[gid]['is_gate']) for pair in m['wait'][gid]['pairs']], target.get('for_share_of_visitors_percent', 90)) for m in metrics]
            add_check('chk_' + key, 'service_targets.' + key, key.replace('_', ' '), target['max_minutes'], values, 'max', 'minutes')
        elif key == 'longest_acceptable_wait_minutes':
            add_check('chk_longest_wait', 'service_targets.' + key, 'Longest wait at one point', target, [max((w['maximum'] for w in m['wait'].values()), default=0) for m in metrics], 'max', 'minutes')
        elif '_inside_before_' in key or key.startswith('inside_before_'):
            if not key.endswith('_percent'):
                continue
            category, moment = ('', key.removeprefix('inside_before_').removesuffix('_percent')) if key.startswith('inside_before_') else key.removesuffix('_percent').split('_inside_before_', 1)
            if moment not in metrics[0]['inside'] or category and category not in metrics[0]['category_attendance']:
                continue
            values = [(m['inside'][moment].get(category, 0) / m['category_attendance'].get(category, 1) * 100 if m['category_attendance'].get(category) else 0) if category else sum(m['inside'][moment].values()) / s['attendance'] * 100 if s['attendance'] else 0 for s, m in zip(samples, metrics)]
            add_check(f'chk_{category + "_" if category else "inside_"}before_{moment}', 'service_targets.' + key, key.removesuffix('_percent').replace('_', ' '), target, values, 'min', 'percent')
    for key, target in safety_limits.items():
        selected = [z for z in zones if z.get('area_m2') and (z.get('type') == 'queue' if key == 'queue_zones' else z.get('type') == 'standing' if key == 'standing_floor' else z['id'] == 'zone_' + key)]
        if selected:
            add_check('chk_density_' + key, 'safety.max_density_persons_per_m2.' + key, 'Peak density in ' + key.replace('_', ' '), target, [max(m['density'][z['id']]['peak'] / z['area_m2'] for z in selected) for m in metrics], 'max', 'persons_per_m2')
    budget = document['constraints'].get('budget', {})
    if 'staff_cap_idr' in budget:
        add_check('chk_staff_budget', 'budget.staff_cap_idr', 'Staffing cost', budget['staff_cap_idr'], [m['costs']['total_idr'] for m in metrics], 'max', 'idr')
    if 'equipment_cap_idr' in budget:
        add_check('chk_equipment_budget', 'budget.equipment_cap_idr', 'Equipment cost', budget['equipment_cap_idr'], [equipment_cost] * len(samples), 'max', 'idr')
    missed = [c['metric'] for c in checks if c['status'] == 'missed']
    risky = [c['metric'] for c in checks if c['status'] == 'at_risk']
    summary = (f"The plan misses {len(missed)} of {len(checks)} checks: {', '.join(missed)}. " if missed else '') + (f"{len(risky)} checks are at risk: {', '.join(risky)}." if risky else '')
    output['scorecard'] = dict(basis='simulated', summary=summary.strip() or f'The plan meets all {len(checks)} checks.', checks=checks, rule_checks=dict(basis='computed', rules=rules(document, resources)))
    known = []
    for problem in document['venue'].get('known_problems', []):
        linked = [c for c in checks if c['id'] in problem.get('linked_checks', [])]
        condition_met = False
        for condition in problem.get('conditions', []):
            value = get_path(output, condition['metric'])
            if isinstance(value, list):
                numeric = [x for x in value if isinstance(x, (int, float))]
                value = {'max': max, 'min': min, 'sum': sum, 'mean': mean}.get(condition.get('aggregate', 'max'), max)(numeric) if numeric else None
            if isinstance(value, (int, float)):
                target = condition['value']
                condition_met |= {'gt': value > target, 'gte': value >= target, 'lt': value < target, 'lte': value <= target, 'eq': value == target}.get(condition['operator'], False)
        risk = 'high' if any(c['status'] == 'missed' for c in linked) else 'medium' if condition_met or any(c['status'] == 'at_risk' for c in linked) else 'low'
        def replace(match):
            value = get_path(output, match.group(1))
            return str(round(value, 3)) if isinstance(value, (int, float)) else str(value) if value is not None else 'unavailable'
        known.append(dict(id=problem['id'], past_event=problem.get('past_event'), problem=problem.get('problem'), metrics=problem.get('metrics', []), linked_checks=problem.get('linked_checks', []), risk=risk, result=re.sub(r'\{([^}]+)\}', replace, problem.get('result_template', '')), sources=problem.get('sources', []), not_covered=problem.get('not_covered')))
    output['known_problem_checks'] = dict(checks=known)
    if method == 'flow':
        curves = []
        sample = samples[0]
        for gid, group in groups.items():
            begin = int(sample['grid_start'])
            arrivals_at = defaultdict(float)
            starts_at = defaultdict(float)
            for at, amount, *_ in sample['joins'].get(gid, []):
                arrivals_at[int(at // 60) * 60] += amount
            for at, amount, *_ in sample['starts'].get(gid, []):
                starts_at[int(at // 60) * 60] += amount
            a = s = 0.0
            rows = []
            for at in range(begin, sample['horizon'] + 1, 60):
                a += arrivals_at[at]
                s += starts_at[at]
                rows.append(dict(time=clock(at), arrivals=a, service_starts=s, queued=max(0, a - s) if at < group['closes'] else 0))
            curves.append(dict(lane_group=gid, interval_minutes=1, series=rows))
        output['arrival_and_access']['flow_curves'] = curves
    check_deadline(deadline)
    return output
