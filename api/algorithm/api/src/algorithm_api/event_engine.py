"""Process-callable event-entry simulation without HTTP or persistence state."""

from .event_capacity import CAPACITY_MODEL_VERSION, check_deadline, derive_resources
from .event_des import simulate_des
from .event_flow import simulate_flow
from .event_reports import build_report

ENGINE_VERSION = 'event_entry_v1'


def simulate_event(document: dict, resolved_settings: dict, *, deadline: float) -> dict:
    """Compute one full report while preserving the submitted document."""
    check_deadline(deadline)
    resources = derive_resources(document, deadline)
    if resolved_settings['simulation_method'] == 'flow':
        samples = [simulate_flow(document, resources, deadline)]
    else:
        samples = []
        for index in range(resolved_settings['replications']):
            check_deadline(deadline)
            samples.append(simulate_des(document, resources, resolved_settings['base_seed'] + index, deadline))
    report = build_report(document, resources, samples, resolved_settings, deadline, dict(engine=ENGINE_VERSION, capacity=CAPACITY_MODEL_VERSION))
    report['run_manifest']['engine_identity'] = dict(engine_version=ENGINE_VERSION, capacity_model_version=CAPACITY_MODEL_VERSION, resolved_settings=resolved_settings)
    check_deadline(deadline)
    return dict(output=report, limitations=['Density is aggregate occupancy divided by declared area and does not model spatial crowd interactions.', 'Meal breaks assume floater coverage; individual break schedules are not modeled.', 'Rain-plan exposure and optimization-only moves_to are not computed.'] + (['Flow does not compute individual all-queue P90 wait.'] if resolved_settings['simulation_method'] == 'flow' else []))
