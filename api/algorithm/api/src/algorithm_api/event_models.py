"""Event-entry resources and boundary errors."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class EventInputError(Exception):
    def __init__(self, status: int, code: str, message: str, details: list[dict]):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class Issue(BaseModel):
    severity: Literal['error', 'warning']
    code: str
    field: str
    message: str


class ValidationResult(BaseModel):
    valid: bool
    issues: list[Issue]


class SimulationSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    simulation_method: Literal['flow', 'des']
    replications: Annotated[StrictInt, Field(ge=1, le=100)] | None = None
    base_seed: StrictInt | None = None


class EventPlanResource(BaseModel):
    id: str
    parent_plan_id: str | None = None
    optimization_id: str | None = None
    candidate_kind: str | None = None
    created_at: str
    updated_at: str
    document: dict


class EventRunResource(BaseModel):
    id: str
    plan_id: str
    purpose: Literal['plain'] = 'plain'
    created_at: str
    snapshot_hash: str
    snapshot_document: dict
    simulation_method: Literal['flow', 'des']
    request_settings: dict
    resolved_settings: dict
    engine_version: str
    runtime_ms: float
    output: dict
    limitations: list[str]
