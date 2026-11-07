"""Immutable event-entry document edits."""

from copy import deepcopy

from .event_models import EventInputError
from .event_validation import validate_shape


def _fail(code: str, field: str, message: str, status: int = 422):
    raise EventInputError(status, code, message, [{'field': field, 'message': message}])


def create_document(submitted: dict) -> dict:
    document = deepcopy(submitted)
    if not isinstance(document, dict):
        _fail('validation_failed', '', 'Document must be an object')
    document.setdefault('schema_version', '0.1')
    document.setdefault('meta', {})
    if isinstance(document['meta'], dict):
        document['meta'].setdefault('document', 'opsidio_event_input')
    return validate_shape(document)


def _merge(document: dict, patch: dict) -> dict:
    result = deepcopy(document)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict):
            result[key] = _merge(result.get(key, {}) if isinstance(result.get(key), dict) else {}, value)
        else:
            result[key] = deepcopy(value)
    return result


def merge_document(document: dict, patch: dict) -> dict:
    if not isinstance(patch, dict):
        _fail('validation_failed', '', 'Patch must be an object')
    for parent, collection in [('process_steps', 'steps'), ('staff', 'roles')]:
        if parent in patch and (not isinstance(patch[parent], dict) or collection in patch[parent]):
            _fail('use_item_endpoint', f'{parent}.{collection}', 'Use the dedicated item endpoint')
    if 'schema_version' in patch and patch['schema_version'] != '0.1':
        _fail('validation_failed', 'schema_version', 'Schema identity cannot change or be removed')
    if 'meta' in patch and (not isinstance(patch['meta'], dict) or ('document' in patch['meta'] and patch['meta']['document'] != 'opsidio_event_input')):
        _fail('validation_failed', 'meta.document', 'Document identity cannot change or be removed')
    return create_document(_merge(document, patch))


def edit_item(document: dict, collection: str, action: str, item_id: str | None, submitted: dict | None) -> dict:
    parent = {'steps': 'process_steps', 'roles': 'staff'}[collection]
    result = deepcopy(document)
    items = result.setdefault(parent, {}).setdefault(collection, [])
    index = next((i for i, item in enumerate(items) if item['id'] == item_id), None)
    field = f'{parent}.{collection}[{item_id}]'
    if action == 'create':
        if not isinstance(submitted, dict) or not isinstance(submitted.get('id'), str) or not submitted['id']:
            _fail('validation_failed', f'{parent}.{collection}.id', 'A nonempty item ID is required')
        if any(item['id'] == submitted['id'] for item in items):
            _fail('step_exists' if collection == 'steps' else 'role_exists', field, 'Item ID already exists', 409)
        items.append(deepcopy(submitted))
    else:
        if index is None:
            _fail('not_found', field, 'Item does not exist', 404)
        if action == 'delete':
            items.pop(index)
        elif action == 'update':
            if not isinstance(submitted, dict):
                _fail('validation_failed', field, 'Item patch must be an object')
            if 'id' in submitted and submitted['id'] != item_id:
                _fail('validation_failed', field + '.id', 'Item ID cannot change or be removed')
            items[index] = _merge(items[index], submitted)
        else:
            raise ValueError('Unknown item action')
    return create_document(result)
