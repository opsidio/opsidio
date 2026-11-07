"""Exercise corridor populations and lane counts above the former fixed limits."""

import json
from pathlib import Path

import pytest


def document(count, lanes, capacity=None):
    plan = json.loads((Path(__file__).resolve().parents[2] / 'examples/corridor-plan.json').read_text())
    plan['arrivals']['count'] = count
    capacity = lanes if capacity is None else capacity
    plan['scan'].update(lanes=lanes, physical_slots=capacity, available_staff=capacity, available_scanners=capacity)
    plan['budget']['amount'] = f'{150 * capacity}.00'
    return plan


@pytest.mark.parametrize(('count', 'lanes'), [(501, 1), (16500, 9)])
def test_create_and_simulate_above_former_limits(service, count, lanes):
    client, _, _ = service
    headers = {'X-API-Key': 'test-key'}
    body = document(count, lanes)
    body['scan']['service_seconds'] = 0
    created = client.post('/v3/plans', json=body, headers=headers)
    assert created.status_code == 201, created.text
    plan = created.json()
    assert client.get(f"/v3/plans/{plan['id']}", headers=headers).json()['document'] == body
    response = client.post(f"/v3/plans/{plan['id']}/simulate", json={}, headers=headers)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run['output']['population']['total'] == count
    assert run['output']['population']['admitted'] == count
    assert run['output']['scan']['lanes'] == lanes
    assert client.get(f"/v3/runs/{run['id']}", headers=headers).json() == run


def test_optimize_and_read_candidate_above_eight_lanes(service):
    client, _, _ = service
    headers = {'X-API-Key': 'test-key'}
    created = client.post('/v3/plans', json=document(10, 1, capacity=10), headers=headers)
    assert created.status_code == 201, created.text
    plan = created.json()
    response = client.post(f"/v3/plans/{plan['id']}/optimize", json={}, headers=headers)
    assert response.status_code == 200, response.text
    optimization = response.json()
    assert optimization['improved'] is True
    assert len(optimization['evaluations']) == 10
    best = client.get(f"/v3/runs/{optimization['best_run_id']}", headers=headers).json()
    candidate = client.get(f"/v3/plans/{optimization['candidate_plan_id']}", headers=headers).json()
    assert best['output']['scan']['lanes'] == 10
    assert best['output']['scan']['peak_queue'] == 0
    assert best['output']['population']['admitted'] == 10
    assert candidate['document']['scan']['lanes'] == 10
