"""Strict corridor documents, saved resources, and exact cost helpers."""

import hashlib
import json
import math
from typing import Annotated, Literal, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictFloat, StrictInt, field_validator


def _finite(value: int | float) -> int | float:
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError('Value must be finite')
    return value

Number = Annotated[Union[StrictInt, StrictFloat], AfterValidator(_finite)]
Nonnegative = Annotated[Number, Field(ge=0)]
Positive = Annotated[Number, Field(gt=0)]
Count = Annotated[StrictInt, Field(ge=0)]
Capacity = Annotated[StrictInt, Field(ge=0, le=8)]


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Money(Model):
    amount: Annotated[str, Field(strict=True, pattern=r'^[0-9]+\.[0-9]{2}$')]
    currency: Literal['IDR']


class Position(Model):
    x: Number
    y: Number
    z: Number


class Node(Model):
    id: Annotated[str, Field(strict=True, min_length=1)]
    position: Position


class Route(Model):
    nodes: Annotated[list[Node], Field(min_length=3, max_length=32)]
    scan_node_id: Annotated[str, Field(strict=True, min_length=1)]

    @field_validator('nodes')
    @classmethod
    def validate_nodes(cls, nodes: list[Node]) -> list[Node]:
        if len({node.id for node in nodes}) != len(nodes):
            raise ValueError('Node IDs must be unique')
        if any(node.position.y != nodes[0].position.y for node in nodes):
            raise ValueError('Route nodes must have equal Y coordinates')
        return nodes

    @field_validator('scan_node_id')
    @classmethod
    def validate_scan(cls, value: str, info) -> str:
        nodes = info.data.get('nodes')
        if nodes is not None and value not in [node.id for node in nodes[1:-1]]:
            raise ValueError('Scan node must reference an internal route node')
        return value


class Arrivals(Model):
    count: Annotated[StrictInt, Field(ge=1, le=500)]
    start_seconds: Nonnegative
    end_seconds: Nonnegative

    @field_validator('end_seconds')
    @classmethod
    def validate_end(cls, value: int | float, info) -> int | float:
        if value < info.data.get('start_seconds', 0):
            raise ValueError('End must be at or after start')
        return value


class Scan(Model):
    lanes: Annotated[StrictInt, Field(ge=1, le=8)]
    physical_slots: Capacity
    available_staff: Capacity
    available_scanners: Capacity
    service_seconds: Nonnegative
    staff_cost_per_lane: Money
    scanner_cost_per_lane: Money

    @field_validator('physical_slots', 'available_staff', 'available_scanners')
    @classmethod
    def validate_capacity(cls, value: int, info) -> int:
        if value < info.data.get('lanes', 1):
            raise ValueError('Capacity must cover active lanes')
        return value


class Targets(Model):
    max_peak_scan_queue: Count


class PlanDocument(Model):
    schema_version: Literal['corridor-1']
    name: Annotated[str, Field(strict=True, min_length=1)]
    geometry_revision: Annotated[str, Field(strict=True, min_length=1)]
    route: Route
    arrivals: Arrivals
    walking_speed_mps: Positive
    scan: Scan
    targets: Targets
    budget: Money
    horizon_seconds: Annotated[Positive, Field(le=86400)]

    @field_validator('budget')
    @classmethod
    def validate_budget(cls, value: Money, info) -> Money:
        scan = info.data.get('scan')
        if scan is not None:
            cost = (_minor(scan.staff_cost_per_lane) + _minor(scan.scanner_cost_per_lane)) * scan.lanes
            if cost > _minor(value):
                raise ValueError('Budget must cover active lane costs')
        return value

    @field_validator('horizon_seconds')
    @classmethod
    def validate_horizon(cls, value: int | float, info) -> int | float:
        arrivals = info.data.get('arrivals')
        if arrivals is not None and value < arrivals.end_seconds:
            raise ValueError('Horizon must be at or after arrival end')
        return value


class UnfinishedByState(Model):
    walking_to_scan: Count
    queued: Count
    scanning: Count
    walking_to_admission: Count


class Population(Model):
    total: Count
    admitted: Count
    unfinished: Count
    unfinished_by_state: UnfinishedByState


class WalkingOutput(Model):
    route_distance_m: Nonnegative
    free_flow_seconds_per_visitor: Nonnegative
    total_observed_seconds: Nonnegative


class ScanOutput(Model):
    lanes: Annotated[StrictInt, Field(ge=1, le=8)]
    peak_queue: Count
    wait_p90_seconds: Nonnegative | None
    wait_sample_count: Count


class Costs(Model):
    staff: Money
    equipment: Money
    total: Money


class Checks(Model):
    queue_target_met: bool
    budget_met: bool
    all_admitted: bool


class RunOutput(Model):
    population: Population
    walking: WalkingOutput
    scan: ScanOutput
    costs: Costs
    checks: Checks


class PlanResource(Model):
    id: str
    parent_id: str | None
    document: PlanDocument
    snapshot_hash: str
    created_at: str


class RunResource(Model):
    id: str
    plan_id: str
    snapshot_hash: str
    created_at: str
    model_id: Literal['corridor_v1']
    engine_version: Literal['1.0.0']
    output: RunOutput
    limitations: list[str]


class Evaluation(Model):
    lanes: Annotated[StrictInt, Field(ge=1, le=8)]
    status: Literal['completed', 'excluded_budget']
    score: tuple[Count, Count, Count] | None


class OptimizationResource(Model):
    id: str
    plan_id: str
    created_at: str
    baseline_run_id: str
    best_run_id: str
    candidate_plan_id: str | None
    improved: bool
    stop_reason: Literal['completed', 'time_limit']
    evaluations: list[Evaluation]


def _minor(money: Money) -> int:
    return int(money.amount.replace('.', ''))


def lane_cost_minor(plan: PlanDocument, lanes: int) -> int:
    return (_minor(plan.scan.staff_cost_per_lane) + _minor(plan.scan.scanner_cost_per_lane)) * lanes


def money_from_minor(value: int) -> Money:
    return Money(amount=f'{value // 100}.{value % 100:02d}', currency='IDR')


def canonical_hash(value: object) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode='json')
    data = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(data.encode('utf-8')).hexdigest()
