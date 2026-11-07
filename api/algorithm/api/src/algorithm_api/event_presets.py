"""Read-only packaged venue and process-step presets."""

import json
from copy import deepcopy
from importlib.resources import files

from .event_documents import create_document, edit_item
from .event_models import EventInputError


def list_presets(kind: str) -> list[dict]:
    if kind not in ('venue', 'step'):
        raise ValueError('Unknown preset kind')
    root = files('algorithm_api').joinpath('presets')
    return [json.loads(path.read_text(encoding='utf-8')) for path in sorted(root.iterdir(), key=lambda p: p.name) if path.name.startswith(kind + '_') and path.name.endswith('.json')]


def get_preset(kind: str, preset_id: str) -> dict | None:
    return next((preset for preset in list_presets(kind) if preset['id'] == preset_id), None)


def apply_preset(document: dict, kind: str, preset_id: str) -> dict:
    preset = get_preset(kind, preset_id)
    if preset is None:
        raise EventInputError(404, 'not_found', 'Preset does not exist', [])
    if kind == 'step':
        return edit_item(document, 'steps', 'create', None, preset['step'])
    result = deepcopy(document)
    result['venue'] = preset['venue']
    result.setdefault('sources', {}).update(preset['sources'])
    return create_document(result)
