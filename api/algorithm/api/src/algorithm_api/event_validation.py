"""Shape checks and deferred readiness rules for event-entry plans."""

import math
import re
from copy import deepcopy
from datetime import date

from pydantic import ValidationError

from .event_models import EventInputError, Issue, SimulationSettings, ValidationResult

_SCHEMA = {'schema_version': 'string',
 'meta': {'document': 'string',
          'example': 'bool',
          'description': 'string',
          'masking': 'string',
          'prepared_by_role': 'string',
          'currency': 'string',
          'timezone': 'string',
          'conventions': ['string'],
          'basis_values': {'confirmed': 'string',
                           'policy': 'string',
                           'estimate': 'string',
                           'public_source': 'string'},
          'excludes': ['string']},
 'event': {'id': 'string',
           'name': 'string',
           'artist': 'string',
           'genre': 'string',
           'format': 'string',
           'promoter': 'string',
           'ticket_sales_channel': 'string',
           'venue': 'string',
           'date': 'string',
           'day_of_week': 'string',
           'public_holiday': 'bool',
           'schedule': {'basis': 'string',
                        'supervisor_call': 'string',
                        'crew_briefing': 'string',
                        'redemption_open': 'string',
                        'outer_area_open': 'string',
                        'priority_gate_open': 'string',
                        'doors_open': 'string',
                        'opening_act': 'string',
                        'main_act': 'string',
                        'show_end_estimate': 'string',
                        'redemption_close': 'string',
                        'last_entry': 'string'},
           'capacity': {'basis': 'string',
                        'venue_full_capacity': 'int',
                        'configured_capacity': 'int',
                        'tickets_on_sale': 'int',
                        'guest_invitations': 'int',
                        'tickets_sold': 'int',
                        'tickets_sold_as_of': 'string',
                        'no_show_percent_estimate': 'int'},
           'pricing': {'basis': 'string', 'prices_exclude_entertainment_tax_percent': 'int'},
           'ticket_categories': [{'id': 'string',
                                  'name': 'string',
                                  'admission': 'string',
                                  'area': 'string',
                                  'seat_assignment': 'string',
                                  'price_idr': 'int',
                                  'quota': 'int',
                                  'sold': 'int',
                                  'entry_gate': 'string',
                                  'wristband_color': 'string',
                                  'entry_waves': 'bool',
                                  'notes': 'string',
                                  'complimentary': 'bool',
                                  'issued': 'int'}],
           'entry_policy': {'basis': 'string',
                            'id_required': 'bool',
                            'id_types_accepted': ['string'],
                            'id_must_be_original': 'bool',
                            'id_not_accepted': ['string'],
                            'name_must_match_ticket': 'bool',
                            'proxy_redemption': {'allowed': 'bool', 'documents_required': ['string']},
                            'ticket_format': 'string',
                            'screenshots_accepted': 'bool',
                            'qr_active_from': 'string',
                            'max_tickets_per_account': 'int',
                            're_entry_allowed': 'bool',
                            'age_rules': {'minimum_age': 'int',
                                          'companion_required_below_age': 'int',
                                          'companion_rule': 'string'},
                            'bag_rules': {'max_bag_size': 'string', 'remove_plastic_bottle_caps': 'bool'},
                            'prohibited_items': ['string'],
                            'lockers': {'available': 'bool',
                                        'fee_idr_per_item': 'int',
                                        'payment': ['string'],
                                        'first_come_first_served': 'bool'}},
           'audience_profile': {'basis': 'string',
                                'core_age_min': 'int',
                                'core_age_max': 'int',
                                'female_percent': 'int',
                                'typical_group_size': 'int',
                                'arrive_in_groups_percent': 'int',
                                'visitors_with_bag_percent': 'int',
                                'visitors_using_locker_percent': 'int',
                                'accessible_visitors_percent': 'number',
                                'arrival_mode_percent': {'mrt': 'int',
                                                         'ride_hailing_drop_off': 'int',
                                                         'private_car': 'int',
                                                         'transjakarta_or_krl': 'int'},
                                'arrival_notes': ['string']},
           'nearby_events_same_day': {'basis': 'string',
                                      'events': [{'venue': 'string',
                                                  'type': 'string',
                                                  'doors_open': 'string',
                                                  'show_start': 'string',
                                                  'expected_audience': 'int',
                                                  'impact': 'string'}]}},
 'venue': {'id': 'string',
           'name': 'string',
           'official_name': 'string',
           'operator': 'string',
           'address': 'string',
           'building': {'basis': 'string',
                        'sources': ['string'],
                        'type': 'string',
                        'opened_year': 'int',
                        'roof': 'string',
                        'renovation': 'string',
                        'past_uses': ['string'],
                        'facilities': ['string'],
                        'capacity_reports': [{'figure': 'string', 'source': 'string'}],
                        'capacity_note': 'string'},
           'venue_rules': {'basis': 'string', 'sources': ['string'], 'rules': ['string']},
           'access': {'basis': 'string',
                      'sources': ['string'],
                      'drop_off': 'string',
                      'complex_gates_recommended': ['string'],
                      'transit': [{'mode': 'string',
                                   'stop': 'string',
                                   'walk_minutes_min': 'int',
                                   'walk_minutes_max': 'int',
                                   'route': 'string',
                                   'last_mile': 'string'}],
                      'parking': [{'name': 'string', 'use': 'string'}]},
           'neighbors': {'basis': 'string',
                         'sources': ['string'],
                         'venues_in_complex': ['string'],
                         'malls_nearby': ['string']},
           'layout': {'basis': 'string',
                      'verify_with': 'string',
                      'pattern': 'string',
                      'pattern_source': 'string',
                      'stage': 'string',
                      'seating': 'string',
                      'zones': [{'id': 'string',
                                 'name': 'string',
                                 'type': 'string',
                                 'length_m': 'int',
                                 'covered_percent': 'int',
                                 'area_m2': 'int',
                                 'barricade_m': 'int',
                                 'switchback_rows': 'int',
                                 'risk': 'string',
                                 'seats': 'int',
                                 'wheelchair_places': 'int'}],
                      'service_points': [{'id': 'string',
                                          'name': 'string',
                                          'zone': 'string',
                                          'queue_zone': 'string',
                                          'opens': 'string',
                                          'closes': 'string',
                                          'max_lanes': 'int',
                                          'lanes': [{'group': 'string',
                                                     'count': 'int',
                                                     'serves_categories': ['string'],
                                                     'steps': ['string'],
                                                     'equipment_per_lane': {'handheld_scanner': 'int'},
                                                     'also_serves': 'string'}]}],
                      'gates': [{'id': 'string',
                                 'name': 'string',
                                 'queue_zone': 'string',
                                 'leads_to': ['string'],
                                 'opens': 'string',
                                 'closes': 'string',
                                 'frontage_m': 'int',
                                 'max_lanes': 'int',
                                 'serves_categories': ['string'],
                                 'lanes': [{'group': 'string',
                                            'count': 'int',
                                            'visitor_gender': 'string',
                                            'steps': ['string'],
                                            'equipment_per_lane': {'metal_detector_wand': 'int',
                                                                   'handheld_scanner': 'int',
                                                                   'bag_check_table': 'int'}}],
                                 'also_serves': 'string'}],
                      'walking_paths': [{'from': 'string', 'to': 'string', 'distance_m': 'int'}],
                      'visitor_flow': [{'order': 'int',
                                        'point': 'string',
                                        'required': 'bool',
                                        'when': 'string',
                                        'exception': 'string'}],
                      'exceptions_go_to': 'string'},
           'known_problems': [{'id': 'string',
                               'past_event': 'string',
                               'problem': 'string',
                               'metrics': ['string'],
                               'linked_checks': ['string'],
                               'conditions': [{'metric': 'string',
                                               'operator': 'string',
                                               'value': 'number',
                                               'aggregate': 'string'}],
                               'result_template': 'string',
                               'not_covered': 'any',
                               'sources': ['string']}]},
 'process_steps': {'basis': 'string',
                   'applies_to_values': {'all_visitors': 'string',
                                         'visitors_with_bag': 'string',
                                         'visitors_using_locker': 'string',
                                         'accessible_visitors': 'string',
                                         'visitors_with_exception': 'string'},
                   'outcome_values': {'continue': 'string',
                                      'step_aside_and_return': 'string',
                                      'secondary_check': 'string',
                                      'help_desk': 'string',
                                      'locker_point': 'string',
                                      'redirect_to_correct_gate': 'string',
                                      'back_to_redemption': 'string',
                                      'refuse_entry': 'string'},
                   'field_notes': {'typical': 'string',
                                   'slow': 'string',
                                   'share_percent': 'string',
                                   'extra_minutes': 'string'},
                   'steps': [{'id': 'string',
                              'name': 'string',
                              'what_happens': 'string',
                              'done_by': ['string'],
                              'equipment': ['string'],
                              'applies_to': 'string',
                              'time_per_person_seconds': {'typical': 'int', 'slow': 'int'},
                              'slow_when': ['string'],
                              'exceptions': [{'id': 'string',
                                              'what': 'string',
                                              'share_percent': 'number',
                                              'outcome': 'string',
                                              'extra_minutes': 'int'}],
                              'rules': ['string'],
                              'results': {'resolved_percent': 'int', 'refused_percent': 'int'},
                              'after_resolution': 'string'}]},
 'staff': {'basis': 'string',
           'meal_allowance_idr_per_person': 'int',
           'shifts': [{'id': 'string', 'start': 'string', 'end': 'string', 'meal_break_minutes': 'int'}],
           'roles': [{'id': 'string',
                      'name': 'string',
                      'provider': 'string',
                      'processing_role': 'bool',
                      'count': 'int',
                      'gender': {'female': 'int', 'male': 'int'},
                      'shift': 'string',
                      'can_do': ['string'],
                      'rate_idr_per_shift': 'int',
                      'overtime_idr_per_hour': 'int',
                      'pool_limit_total': 'int',
                      'extra_staff_lead_time_days': 'int',
                      'assignment': [{'point': 'string',
                                      'lane_group': 'string',
                                      'per_lane': 'int',
                                      'count': 'int',
                                      'duty': 'string'}],
                      'certification': 'string',
                      'pool_limit_by_gender': {'female': 'int', 'male': 'int'},
                      'duties': ['string'],
                      'cost_model': 'string',
                      'package_idr': 'int',
                      'meals_included_in_package': 'bool'}]},
 'constraints': {'budget': {'basis': 'string',
                            'staff_cap_idr': 'int',
                            'equipment_cap_idr': 'int',
                            'on_the_day_contingency_idr': 'int',
                            'contingency_approved_by': 'string',
                            'staff_cap_includes': ['string'],
                            'not_in_budget': ['string']},
                 'service_targets': {'basis': 'string',
                                     'redemption_wait': {'max_minutes': 'int',
                                                         'for_share_of_visitors_percent': 'int'},
                                     'gate_wait': {'max_minutes': 'int',
                                                   'for_share_of_visitors_percent': 'int'},
                                     'longest_acceptable_wait_minutes': 'int',
                                     'inside_before_main_act_percent': 'int',
                                     'festival_a_inside_before_opening_act_percent': 'int'},
                 'safety': {'basis': 'string',
                            'max_density_persons_per_m2': {'queue_zones': 'number',
                                                           'inner_concourse': 'number',
                                                           'standing_floor': 'number'},
                            'queues_must_stay_inside_queue_zones': 'bool',
                            'emergency_lane_width_m': 'int',
                            'keep_clear': ['string'],
                            'rain_plan': 'string',
                            'lightning_plan': 'string'},
                 'rules': {'basis': 'string', 'items': [{'id': 'string', 'rule': 'string'}]},
                 'lane_staffing': {'basis': 'string',
                                   'redemption_counter': {'min_per_lane': 'int', 'max_per_lane': 'int'},
                                   'help_desk': {'min_per_lane': 'int', 'max_per_lane': 'int'},
                                   'locker_counter': {'min_per_lane': 'int', 'max_per_lane': 'int'},
                                   'gate_security': {'min_per_lane': 'int', 'max_per_lane': 'int'},
                                   'gate_door_scan': {'min_per_lane': 'int', 'max_per_lane': 'int'}},
                 'equipment': {'basis': 'string',
                               'items': [{'id': 'string',
                                          'name': 'string',
                                          'owner': 'string',
                                          'available': 'int',
                                          'committed_cost_idr': 'int',
                                          'extra_rentable': 'int',
                                          'extra_cost_idr_per_unit': 'int',
                                          'lead_time_days': 'int'}]},
                 'timing': {'basis': 'string',
                            'redemption_open_earliest': 'string',
                            'redemption_close_latest': 'string',
                            'outer_area_open_earliest': 'string',
                            'doors_open_earliest': 'string',
                            'doors_open_earlier_needs_approval_from': 'string',
                            'last_entry_latest': 'string',
                            'venue_slot_end': 'string'},
                 'staffing_changes': {'basis': 'string',
                                      'confirm_extra_crew_by': 'string',
                                      'same_day_extra_max_people': 'int',
                                      'same_day_rate_multiplier': 'number'},
                 'levers': {'basis': 'string', 'allowed_changes': ['string'], 'not_allowed': ['string']},
                 'permits': {'basis': 'string',
                             'sources': ['string'],
                             'crowd_permit': {'regulations': ['string'],
                                              'status': 'string',
                                              'permitted_audience_max': 'int',
                                              'application_lead_time_days': 'int',
                                              'application_lead_time_note': 'string'},
                             'external_security': 'string'}},
 'sources': {'gbk_venue': {'title': 'string', 'url': 'string'},
             'gbk_terms': {'title': 'string', 'url': 'string'},
             'setkab_2018': {'title': 'string', 'url': 'string'},
             'wikipedia_gbk': {'title': 'string', 'url': 'string'},
             'detik_travel_2023': {'title': 'string', 'url': 'string'},
             'aia_guide_2025': {'title': 'string', 'url': 'string'},
             'permit_rules': {'title': 'string', 'url': 'string'},
             'gbk_problems': {'title': 'string', 'path': 'string'},
             'kompas_2025_pintu5': {'title': 'string', 'url': 'string'},
             'cnn_2024_garuda_id': {'title': 'string', 'url': 'string'},
             'idx_2023_blackpink': {'title': 'string', 'url': 'string'},
             'sgsa_heat': {'title': 'string', 'url': 'string'},
             'casey_review': {'title': 'string', 'url': 'string'}},
 'demand': {'basis': 'string',
            'arrival_windows_percent': {'festival_a': {'14:30-15:30': 'int',
                                                       '15:30-16:30': 'int',
                                                       '16:30-17:30': 'int',
                                                       '17:30-18:30': 'int',
                                                       '18:30-19:30': 'int'}},
            'gate_join_windows': {'festival_a': 'string', 'festival_b': 'string'},
            'group_size_share_percent': {'1': 'int', '2': 'int', '3': 'int', '4': 'int'}}}

_CLOCK = re.compile(r'^(?:[01]\d|2[0-3]):[0-5]\d$')
_WINDOW = re.compile(r'^((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$')
_OUTCOMES = {'continue', 'secondary_check', 'step_aside_and_return', 'help_desk', 'locker_point', 'redirect_to_correct_gate', 'back_to_redemption', 'refuse_entry'}
_APPLIES = {'all_visitors', 'visitors_with_bag', 'visitors_using_locker', 'accessible_visitors', 'visitors_with_exception'}


def _path(path, key):
    return f'{path}.{key}' if path else str(key)


def validate_shape(document: dict) -> dict:
    errors = []

    def fail(path, message):
        errors.append({'field': path, 'message': message})

    def walk(value, expected, path='', key=''):
        if isinstance(value, float) and not math.isfinite(value):
            fail(path, 'Number must be finite')
            return
        if value is None:
            if expected != 'any':
                fail(path, 'Null is not a supplied field value')
            return
        if isinstance(expected, dict):
            if not isinstance(value, dict):
                fail(path, 'Must be an object')
                return
        elif isinstance(expected, list):
            if not isinstance(value, list):
                fail(path, 'Must be an array')
                return
        elif expected in ('int', 'number'):
            if expected == 'int' and (key.endswith(('_seconds', '_minutes', '_m', '_m2', '_percent', '_estimate')) or key in ('typical', 'slow', 'frontage_m', 'same_day_rate_multiplier')):
                expected = 'number'
            if isinstance(value, bool) or not isinstance(value, (int, float)) or (expected == 'int' and not isinstance(value, int)):
                fail(path, 'Must be an integer' if expected == 'int' else 'Must be a number')
                return
        elif expected == 'string' and not isinstance(value, str):
            fail(path, 'Must be a string')
            return
        elif expected == 'bool' and not isinstance(value, bool):
            fail(path, 'Must be a boolean')
            return
        if isinstance(value, dict):
            for start, end in [('opens', 'closes'), ('start', 'end'), ('doors_open', 'main_act')]:
                if isinstance(value.get(start), str) and isinstance(value.get(end), str) and _CLOCK.fullmatch(value[start]) and _CLOCK.fullmatch(value[end]) and value[start] >= value[end]:
                    fail(_path(path, end), f'{end} must follow {start}')
            if 'typical' in value and 'slow' in value and isinstance(value['typical'], (int, float)) and isinstance(value['slow'], (int, float)) and value['typical'] > value['slow']:
                fail(_path(path, 'slow'), 'Slow time must be at least typical time')
            for name, child in value.items():
                child_schema = expected.get(name, 'any') if isinstance(expected, dict) else 'any'
                if child_schema == 'any' and name in ('serves_categories', 'can_do', 'leads_to'):
                    child_schema = ['string']
                if child_schema == 'any' and name in ('zone', 'queue_zone', 'also_serves', 'serves', 'lane_group', 'visitor_gender'):
                    child_schema = 'string'
                if path == 'sources':
                    child_schema = {'title': 'string', 'url': 'string', 'path': 'string'}
                if path.endswith(('arrival_mode_percent', 'max_density_persons_per_m2')):
                    child_schema = 'number'
                if path.endswith(('equipment_per_lane', 'pool_limit_by_gender')) or name == 'extra_rented':
                    child_schema = 'int'
                if path.endswith(('arrival_windows_percent', 'gate_join_windows')):
                    child_schema = {} if path.endswith('arrival_windows_percent') else 'string'
                if path.endswith('group_size_share_percent') or '.arrival_windows_percent.' in path:
                    child_schema = 'number'
                walk(child, child_schema, _path(path, name), name)
        elif isinstance(value, list):
            seen = set()
            for index, child in enumerate(value):
                identity = child.get('id', child.get('group', index)) if isinstance(child, dict) else index
                if isinstance(expected, list) and expected and isinstance(expected[0], dict):
                    identity_key = 'id' if 'id' in expected[0] else 'group' if 'group' in expected[0] else None
                    if identity_key and (not isinstance(child, dict) or not isinstance(child.get(identity_key), str) or not child.get(identity_key)):
                        fail(f'{path}[{index}].{identity_key}', 'A nonempty item identity is required')
                if not isinstance(identity, (str, int)):
                    identity = index
                child_path = f'{path}[{identity}]'
                if isinstance(child, dict) and ('id' in child or 'group' in child):
                    if identity in seen:
                        fail(child_path, 'Item identity must be unique')
                    seen.add(identity)
                walk(child, expected[0] if isinstance(expected, list) and expected else 'any', child_path)
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            if value < 0 and expected in ('int', 'number'):
                fail(path, 'Value must be nonnegative')
            if ('percent' in key or '.arrival_mode_percent.' in path or '.arrival_windows_percent.' in path or '.group_size_share_percent.' in path) and value > 100:
                fail(path, 'Percent must be between 0 and 100')
            if ('idr' in key or key in ('count', 'sold', 'issued', 'quota', 'available', 'extra_rented', 'extra_rentable', 'per_lane', 'max_lanes', 'female', 'male')) and not isinstance(value, int):
                fail(path, 'Count and IDR values must be integers')
        elif isinstance(value, str):
            if (path.startswith('event.schedule.') and key in _SCHEMA['event']['schedule'] and key != 'basis') or key in ('opens', 'closes', 'start', 'end') or (path.startswith('constraints.timing.') and key.endswith(('_earliest', '_latest', '_end'))):
                if not _CLOCK.fullmatch(value):
                    fail(path, 'Time must use HH:MM')
            if path == 'event.date' or path == 'event.capacity.tickets_sold_as_of':
                try:
                    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                        raise ValueError('Invalid date shape')
                    date.fromisoformat(value)
                except ValueError:
                    fail(path, 'Date must use YYYY-MM-DD')
            if key == 'outcome' and value not in _OUTCOMES:
                fail(path, 'Unsupported exception outcome')
            if key == 'applies_to' and value not in _APPLIES:
                fail(path, 'Unsupported visitor applicability')
            if key == 'visitor_gender' and value not in ('female', 'male', 'all'):
                fail(path, 'Unsupported visitor gender')

    if not isinstance(document, dict):
        raise EventInputError(422, 'validation_failed', 'Document must be an object', [{'field': '', 'message': 'Must be an object'}])
    walk(document, _SCHEMA)
    for key in ('spatial', 'participant_behavior'):
        if key in document:
            fail(key, 'Behavioral extension is not supported')
    if document.get('schema_version') != '0.1':
        fail('schema_version', 'Schema version must be 0.1')
    if not isinstance(document.get('meta'), dict) or document['meta'].get('document') != 'opsidio_event_input':
        fail('meta.document', 'Document identity must be opsidio_event_input')
    if isinstance(document.get('meta'), dict) and document['meta'].get('currency', 'IDR') != 'IDR':
        fail('meta.currency', 'Currency must be IDR')
    if isinstance(document.get('meta'), dict) and document['meta'].get('timezone', 'Asia/Jakarta') != 'Asia/Jakarta':
        fail('meta.timezone', 'Timezone must be Asia/Jakarta')
    if errors:
        raise EventInputError(422, 'validation_failed', 'Invalid event-entry document', errors)
    for size in document.get('demand', {}).get('group_size_share_percent', {}):
        if not str(size).isdigit() or int(size) < 1:
            fail('demand.group_size_share_percent.' + str(size), 'Group size must be a positive integer')
    for category, windows in document.get('demand', {}).get('arrival_windows_percent', {}).items():
        if isinstance(windows, dict):
            for window in windows:
                match = _WINDOW.fullmatch(window)
                if not match or match[1] >= match[2]:
                    fail(f'demand.arrival_windows_percent.{category}.{window}', 'Window must have ordered HH:MM endpoints')
    for category, window in document.get('demand', {}).get('gate_join_windows', {}).items():
        if isinstance(window, str) and window != 'after_redemption':
            match = _WINDOW.fullmatch(window)
            if not match or match[1] >= match[2]:
                fail(f'demand.gate_join_windows.{category}', 'Window must have ordered HH:MM endpoints')
    if errors:
        raise EventInputError(422, 'validation_failed', 'Invalid event-entry document', errors)
    return deepcopy(document)


def resolve_settings(document: dict, submitted: dict) -> dict:
    try:
        settings = SimulationSettings.model_validate(submitted)
    except ValidationError as exc:
        raise EventInputError(422, 'validation_failed', 'Invalid simulation settings', [{'field': '.'.join(map(str, error['loc'])), 'message': error['msg']} for error in exc.errors()]) from exc
    if settings.simulation_method == 'flow':
        return {'simulation_method': 'flow', 'replications': 1, 'base_seed': None}
    seed = settings.base_seed
    if seed is None:
        event_date = document.get('event', {}).get('date')
        try:
            seed = int(date.fromisoformat(event_date).strftime('%Y%m%d'))
        except (TypeError, ValueError):
            raise EventInputError(422, 'validation_failed', 'Event date is required for the default seed', [{'field': 'event.date', 'message': 'Supply a valid event date'}]) from None
    return {'simulation_method': 'des', 'replications': settings.replications or 20, 'base_seed': seed}


def validate_ready(document: dict) -> ValidationResult:
    issues = []

    def issue(code, field, message, severity='error'):
        issues.append(Issue(severity=severity, code=code, field=field, message=message))

    def reference(value, values, field):
        if value not in values:
            issue('unknown_reference', field, f'Unknown reference: {value}')

    event = document.get('event', {})
    layout = document.get('venue', {}).get('layout', {})
    staff = document.get('staff', {})
    constraints = document.get('constraints', {})
    for path, value in [('event', event), ('event.schedule', event.get('schedule')), ('event.capacity', event.get('capacity')), ('event.ticket_categories', event.get('ticket_categories')), ('event.audience_profile', event.get('audience_profile')), ('venue.layout', layout), ('process_steps', document.get('process_steps')), ('staff', staff), ('constraints', constraints)]:
        if not value:
            issue('missing_section', path, 'Section is required for simulation')
    for field in ('date',):
        if not event.get(field):
            issue('missing_section', f'event.{field}', 'Event date is required for simulation')
    steps = {s['id']: s for s in document.get('process_steps', {}).get('steps', [])}
    roles = {r['id']: r for r in staff.get('roles', [])}
    shifts = {s['id']: s for s in staff.get('shifts', [])}
    zones = {z['id']: z for z in layout.get('zones', [])}
    points = {p['id']: p for p in layout.get('service_points', []) + layout.get('gates', [])}
    gates = {g['id']: g for g in layout.get('gates', [])}
    categories = {c['id']: c for c in event.get('ticket_categories', [])}
    equipment = {e['id']: e for e in constraints.get('equipment', {}).get('items', [])}
    for role_id, role in roles.items():
        path = f'staff.roles[{role_id}]'
        reference(role.get('shift'), shifts, path + '.shift')
        for step in role.get('can_do', []):
            reference(step, steps, path + '.can_do')
        assignments = role.get('assignment', [])
        if sum(a.get('count', 0) for a in assignments) != role.get('count', 0):
            issue('count_mismatch', path + '.assignment', 'Assignment counts must equal the role count')
        if sum(role.get('gender', {}).values()) != role.get('count', 0):
            issue('count_mismatch', path + '.gender', 'Gender counts must equal the role count')
        if role.get('count', 0) > role.get('pool_limit_total', math.inf):
            issue('hard_limit_broken', path + '.pool_limit_total', 'Role exceeds its staff pool', 'warning')
        for gender, limit in role.get('pool_limit_by_gender', {}).items():
            if role.get('gender', {}).get(gender, 0) > limit:
                issue('hard_limit_broken', path + '.pool_limit_by_gender.' + gender, 'Role exceeds its gender pool', 'warning')
        for index, assignment in enumerate(assignments):
            apath = f'{path}.assignment[{index}]'
            point = assignment.get('point')
            reference(point, points | zones, apath + '.point')
            if 'lane_group' in assignment:
                groups = {g['group'] for g in points.get(point, {}).get('lanes', [])}
                reference(assignment['lane_group'], groups, apath + '.lane_group')
            shift = shifts.get(role.get('shift'), {})
            if point in points and shift.get('start', '') > points[point].get('opens', ''):
                issue('hard_limit_broken', apath, 'Point opens before the assigned shift starts', 'warning')
    for point_id, point in points.items():
        root = 'gates' if point_id in gates else 'service_points'
        path = f'venue.layout.{root}[{point_id}]'
        for zone_key in ('zone', 'queue_zone'):
            if zone_key in point:
                reference(point[zone_key], zones, path + '.' + zone_key)
        for zone in point.get('leads_to', []):
            reference(zone, zones, path + '.leads_to')
        if point.get('opens', '') >= point.get('closes', '24:00'):
            issue('bad_time_order', path + '.closes', 'Point must open before it closes')
        if sum(g.get('count', 0) for g in point.get('lanes', [])) > point.get('max_lanes', math.inf):
            issue('hard_limit_broken', path + '.max_lanes', 'Requested lanes exceed the physical limit', 'warning')
        for group in point.get('lanes', []):
            gpath = path + f'.lanes[{group["group"]}]'
            for step in group.get('steps', []):
                reference(step, steps, gpath + '.steps')
            for category in group.get('serves_categories', []):
                reference(category, categories, gpath + '.serves_categories')
            for item in group.get('equipment_per_lane', {}):
                reference(item, equipment, gpath + '.equipment_per_lane.' + item)
            capabilities = []
            for role in roles.values():
                for assignment in role.get('assignment', []):
                    if assignment.get('point') == point_id and assignment.get('lane_group') == group['group']:
                        capabilities.extend([set(role.get('can_do', []))] * assignment.get('per_lane', 0))
                    elif assignment.get('point') == point_id and assignment.get('duty') == 'escort' and 'assisted_entry' in role.get('can_do', []):
                        capabilities.append({'assisted_entry'})
            lane_steps = group.get('steps', [])
            if group.get('count', 0) and lane_steps and all(s in steps for s in lane_steps):
                if not _valid_split(lane_steps, capabilities):
                    issue('no_valid_position_split', gpath, 'Assigned staff cannot cover ordered service positions')
    for cid, category in categories.items():
        reference(category.get('entry_gate'), gates, f'event.ticket_categories[{cid}].entry_gate')
        if 'zone' in category:
            reference(category['zone'], zones, f'event.ticket_categories[{cid}].zone')
        redemption = next((f['point'] for f in sorted(layout.get('visitor_flow', []), key=lambda f: f.get('order', 0)) if f.get('required') and f.get('point') != 'entry_gate_of_category'), None)
        redemption_groups = points.get(redemption, {}).get('lanes', [])
        if not any(cid in g.get('serves_categories', []) and g.get('count', 0) > 0 for g in redemption_groups):
            issue('uncovered_category', f'event.ticket_categories[{cid}]', 'Category has no redemption lane group')
        gate = gates.get(category.get('entry_gate'), {})
        female_share = event.get('audience_profile', {}).get('female_percent', 50)
        for gender, share in [('female', female_share), ('male', 100 - female_share)]:
            if share and not any(g.get('count', 0) > 0 and g.get('visitor_gender', 'all') in (gender, 'all') and cid in g.get('serves_categories', gate.get('serves_categories', list(categories))) for g in gate.get('lanes', [])):
                issue('uncovered_category', f'event.ticket_categories[{cid}].entry_gate', f'Category has no {gender} gate lane group')
        windows = document.get('demand', {}).get('arrival_windows_percent', {}).get(cid)
        if windows is None:
            issue('default_demand', f'demand.arrival_windows_percent.{cid}', 'Category uses the default arrival curve', 'warning')
        elif not 99.5 <= sum(windows.values()) <= 100.5:
            issue('bad_window_total', f'demand.arrival_windows_percent.{cid}', 'Arrival shares must total 100 ± 0.5')
    schedule = event.get('schedule', {})
    if schedule.get('doors_open', '') >= schedule.get('main_act', '24:00'):
        issue('bad_time_order', 'event.schedule.main_act', 'Doors must open before the main act')
    for shift in shifts.values():
        if shift.get('start', '') >= shift.get('end', '24:00'):
            issue('bad_time_order', f'staff.shifts[{shift["id"]}].end', 'Shift must start before it ends')
    for index, path in enumerate(layout.get('walking_paths', [])):
        reference(path.get('from'), points | zones, f'venue.layout.walking_paths[{index}].from')
        reference(path.get('to'), points | zones, f'venue.layout.walking_paths[{index}].to')
    if layout.get('exceptions_go_to'):
        reference(layout['exceptions_go_to'], points, 'venue.layout.exceptions_go_to')
    paths = {frozenset((p['from'], p['to'])) for p in layout.get('walking_paths', [])}
    flow = sorted(layout.get('visitor_flow', []), key=lambda f: f.get('order', 0))
    for entry in flow:
        if entry.get('point') != 'entry_gate_of_category':
            reference(entry.get('point'), points, 'venue.layout.visitor_flow')
    concrete = [f['point'] for f in flow if f.get('point') in points]
    required_pairs = set()
    for left, right in zip(concrete, concrete[1:]):
        required_pairs.add((left, right))
    if concrete:
        for gate in gates:
            for point in concrete:
                required_pairs.add((point, gate))
    for left, right in sorted(required_pairs):
        if frozenset((left, right)) not in paths:
            issue('missing_walking_path', 'venue.layout.walking_paths', f'No walking path joins {left} and {right}')
    for key in constraints.get('service_targets', {}):
        if key != 'basis' and key not in ('redemption_wait', 'gate_wait', 'longest_acceptable_wait_minutes') and not _known_target(key, categories, schedule):
            issue('unknown_target', 'constraints.service_targets.' + key, 'Target is not in the check catalog', 'warning')
    safety_keys = {'basis', 'max_density_persons_per_m2', 'queues_must_stay_inside_queue_zones', 'emergency_lane_width_m', 'keep_clear', 'rain_plan', 'lightning_plan'}
    for key in constraints.get('safety', {}).get('max_density_persons_per_m2', {}):
        if key not in ('queue_zones', 'standing_floor') and 'zone_' + key not in zones:
            issue('unknown_target', 'constraints.safety.max_density_persons_per_m2.' + key, 'Density target has no matching zone', 'warning')
    group_shares = document.get('demand', {}).get('group_size_share_percent')
    if group_shares is not None and not 99.5 <= sum(group_shares.values()) <= 100.5:
        issue('bad_window_total', 'demand.group_size_share_percent', 'Group shares must total 100 ± 0.5')
    for key in constraints.get('safety', {}):
        if key not in safety_keys:
            issue('unknown_target', 'constraints.safety.' + key, 'Safety key is not in the check catalog', 'warning')
    known_rules = {'rule_same_gender_search', 'rule_certified_security', 'rule_id_check_all', 'rule_no_re_entry', 'rule_supervisor_per_gate', 'rule_priority_gate_open', 'rule_breaks', 'rule_no_break_peak', 'rule_friday_prayer'}
    for rule in constraints.get('rules', {}).get('items', []):
        if rule['id'] not in known_rules:
            issue('unknown_rule', f'constraints.rules.items[{rule["id"]}]', 'Rule is not in the rule catalog', 'warning')
    for key in constraints.get('lane_staffing', {}):
        if key not in {'basis', 'redemption_counter', 'help_desk', 'locker_counter', 'gate_security', 'gate_door_scan'}:
            issue('unknown_lane_staffing_key', 'constraints.lane_staffing.' + key, 'Staffing key is not in the catalog', 'warning')
    for eid, item in equipment.items():
        needed = sum(g.get('count', 0) * g.get('equipment_per_lane', {}).get(eid, 0) for p in points.values() for g in p.get('lanes', []))
        if needed > item.get('available', 0) + item.get('extra_rented', 0) or item.get('extra_rented', 0) > item.get('extra_rentable', 0):
            issue('hard_limit_broken', f'constraints.equipment.items[{eid}]', 'Equipment demand exceeds available supply or rental limit', 'warning')
    for key, opening, limit in [('redemption_open_earliest', 'redemption_open', 'min'), ('redemption_close_latest', 'redemption_close', 'max'), ('doors_open_earliest', 'doors_open', 'min'), ('last_entry_latest', 'last_entry', 'max')]:
        bound = constraints.get('timing', {}).get(key)
        actual = schedule.get(opening)
        if bound and actual and ((limit == 'min' and actual < bound) or (limit == 'max' and actual > bound)):
            issue('hard_limit_broken', 'event.schedule.' + opening, f'Timing violates {key}', 'warning')
    staff_cost = sum(r.get('package_idr', 0) if r.get('cost_model') == 'package' else r.get('count', 0) * r.get('rate_idr_per_shift', 0) for r in roles.values())
    staff_cost += sum(r.get('count', 0) * staff.get('meal_allowance_idr_per_person', 0) for r in roles.values() if not r.get('meals_included_in_package'))
    equipment_cost = sum(e.get('committed_cost_idr', 0) + e.get('extra_rented', 0) * e.get('extra_cost_idr_per_unit', 0) for e in equipment.values())
    for key, cost in [('staff_cap_idr', staff_cost), ('equipment_cap_idr', equipment_cost)]:
        if cost > constraints.get('budget', {}).get(key, math.inf):
            issue('hard_limit_broken', 'constraints.budget.' + key, 'Planned cost exceeds budget', 'warning')
    _static_rule_issues(document, issue)
    return ValidationResult(valid=not any(i.severity == 'error' for i in issues), issues=issues)


def _valid_split(steps: list[str], capabilities: list[set]) -> bool:
    def cover(index, remaining):
        if index == len(steps):
            return True
        seen = set()
        for staff_index, skills in enumerate(remaining):
            identity = frozenset(skills)
            if identity in seen:
                continue
            seen.add(identity)
            for end in range(index + 1, len(steps) + 1):
                if not set(steps[index:end]) <= skills:
                    break
                if cover(end, remaining[:staff_index] + remaining[staff_index + 1:]):
                    return True
        return False
    return cover(0, capabilities)


def _known_target(key, categories, schedule):
    if key.startswith('inside_before_') and key.endswith('_percent'):
        return key[len('inside_before_'):-len('_percent')] in schedule
    return any(key.startswith(cid + '_inside_before_') and key.endswith('_percent') and key[len(cid + '_inside_before_'):-len('_percent')] in schedule for cid in categories)


def _static_rule_issues(document, issue):
    layout = document.get('venue', {}).get('layout', {})
    constraints = document.get('constraints', {})
    roles = document.get('staff', {}).get('roles', [])
    gates = layout.get('gates', [])
    points = layout.get('service_points', []) + gates
    flow = sorted(layout.get('visitor_flow', []), key=lambda f: f.get('order', 0))
    first = next((f.get('point') for f in flow if f.get('required')), None)
    rules = {r['id'] for r in constraints.get('rules', {}).get('items', [])}

    def warn(field, message):
        issue('hard_limit_broken', field, message, 'warning')

    for point in points:
        gate = point in gates
        for group in point.get('lanes', []):
            per_lane = [(role, assignment) for role in roles for assignment in role.get('assignment', []) if assignment.get('point') == point['id'] and assignment.get('lane_group') == group['group']]
            kinds = {}
            if point['id'] == first:
                kinds['redemption_counter'] = sum(a.get('per_lane', 0) for _, a in per_lane)
            if point['id'] == layout.get('exceptions_go_to'):
                kinds['help_desk'] = sum(a.get('per_lane', 0) for _, a in per_lane)
            if 'locker_dropoff' in group.get('steps', []):
                kinds['locker_counter'] = sum(a.get('per_lane', 0) for _, a in per_lane)
            if gate:
                kinds['gate_security'] = sum(a.get('per_lane', 0) for r, a in per_lane if 'body_search' in r.get('can_do', []))
                kinds['gate_door_scan'] = sum(a.get('per_lane', 0) for r, a in per_lane if 'wristband_check' in r.get('can_do', []) and 'body_search' not in r.get('can_do', []))
            for kind, count in kinds.items():
                limit = constraints.get('lane_staffing', {}).get(kind)
                if limit and not limit.get('min_per_lane', 0) <= count <= limit.get('max_per_lane', math.inf):
                    warn('constraints.lane_staffing.' + kind, f'{point["id"]}/{group["group"]} violates its staff-per-lane limit')
            for role, assignment in per_lane:
                if 'body_search' in group.get('steps', []) and 'body_search' in role.get('can_do', []):
                    gender = group.get('visitor_gender')
                    if 'rule_same_gender_search' in rules and gender in ('female', 'male') and role.get('gender', {}).get(gender, 0) < assignment.get('count', 0):
                        warn(f'staff.roles[{role["id"]}].gender', 'Search assignment does not have sufficient staff of the visitor gender')
                if 'rule_certified_security' in rules and set(group.get('steps', [])) & set(role.get('can_do', [])) & {'bag_check', 'body_search'} and not role.get('certification'):
                    warn(f'staff.roles[{role["id"]}].certification', 'Security service requires certified staff')
            if 'rule_id_check_all' in rules and point['id'] == first and 'ktp_name_match' not in group.get('steps', []):
                warn('constraints.rules.items[rule_id_check_all]', 'A redemption lane omits the ID check')
    if 'rule_supervisor_per_gate' in rules:
        for gate in gates:
            if not any('body_search' in r.get('can_do', []) and any(a.get('point') == gate['id'] and a.get('duty') == 'supervisor' and a.get('count', 0) > 0 for a in r.get('assignment', [])) for r in roles):
                warn('constraints.rules.items[rule_supervisor_per_gate]', f'{gate["id"]} lacks a qualified security supervisor')
    if 'rule_priority_gate_open' in rules:
        priority = next((g for g in gates if g.get('also_serves') == 'accessible_visitors' or g['id'] == 'gate_priority'), None)
        if priority and any(priority.get('opens', '') > g.get('opens', '') or priority.get('closes', '') < g.get('closes', '') for g in gates):
            warn('constraints.rules.items[rule_priority_gate_open]', 'The priority gate does not cover every gate opening interval')
    event = document.get('event', {})
    if 'rule_friday_prayer' in rules:
        try:
            friday = date.fromisoformat(event.get('date', '')).weekday() == 4
        except ValueError:
            friday = event.get('day_of_week') == 'friday'
        times = [s.get('start', '') for s in document.get('staff', {}).get('shifts', [])]
        times.append(event.get('schedule', {}).get('crew_briefing', ''))
        if friday and any('11:30' <= t <= '12:45' for t in times):
            warn('constraints.rules.items[rule_friday_prayer]', 'A shift or briefing overlaps Friday prayer')
