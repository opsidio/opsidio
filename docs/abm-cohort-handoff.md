# V1 ABM cohort handoff

The complete input is `contracts/examples/coldplay-gbk-demo-plan.json`. The browser groups demand by ticket category and behavior segment. Parameters are defined once per segment, and each generated journey inherits those parameters. Category and segment allocations conserve the 70,000-person population across 76 cohorts. Each entry has four active lanes.

All segment shares, arrival profiles, group sizes, speeds and local spawn offsets are fictional demo assumptions. Public category-to-entry routing is retained from the sourced admission scenario.

## Behavior profiles

Arrival shares below correspond to 09:00–13:00, 13:00–15:30, 15:30–17:30 and 17:30–19:30 WIB.

| Segment | Arrival shares | Group size | Walking speed | Onsite spawn |
| --- | --- | --- | --- | --- |
| Early fan | 40 / 40 / 18 / 2% | 2 | 1.2 m/s | Main queue approach |
| Regular attendee | 5 / 25 / 50 / 20% | 2 | 1.2 m/s | Walking approach |
| Late arrival | 0 / 5 / 45 / 50% | 2 | 1.25 m/s | Drop-off approach |
| Package holder | 5 / 65 / 28 / 2% | 2 | 1.1 m/s | Package approach |
| Social group | 10 / 35 / 45 / 10% | 4 | 1.0 m/s | Group meeting approach |

Spawn points are ground coordinates in `spatial_context.navigation.nodes`. The five entry areas each have these five onsite approaches. Walking, drop-off and package labels describe the scenario source. Offsite MRT, parking and vehicle paths still need mapping.

## Category allocation

| Category or product | Early fan | Regular | Late | Package | Social group | Assigned entry area |
| --- | --- | --- | --- | --- | --- | --- |
| Ultimate Experience / My Universe | 0% | 0% | 0% | 95% | 5% | Plaza Tenggara |
| Festival | 55% | 30% | 10% | 0% | 5% | Plaza Timur |
| CAT 1–2 | 10% | 65% | 20% | 0% | 5% | Plaza Tenggara |
| CAT 3 | 20% | 55% | 20% | 0% | 5% | Plaza Barat |
| CAT 4 | 20% | 55% | 20% | 0% | 5% | Pintu Kuning |
| CAT 5–8 | 35% | 45% | 15% | 0% | 5% | Plaza Utara |

Infinity retains its original 500 people and Plaza Tenggara arrival. Each of its nine viewing-tier allocations inherits the relevant tier's behavior mix.

## Spawning and destinations

The runtime path is onsite spawn → queue → ticket scan → security → category handover. Four directed lane routes per entry distribute arriving groups round-robin. Each lane has its own scan and security checkpoint and bound operators. The local worker queues visitors FIFO, processes one visitor per operator, then continues the journey. It uses fixed typical times from the native process steps and native gate opening/closing clocks. The help branch is authored, with exception demand still pending.

Every ticket category has a named destination node. These are post-security category handover points at its assigned entry area. Category handovers are spaced around that area's admitted endpoint until internal routes are reviewed. `viewing_tier` records the eventual seated or standing sector. `final_zone_route_status` is `pending_venue_review`. Seat blocks, stairs, accessible routes and stage-specific field destinations still need venue mapping.

Groups spawn together with the same arrival timestamp and follow the cohort route and speed. The front 32 waiting visitors per station are rendered, with full queue counts in the panel. Visitors awaiting service at closing remain pending. Dynamic collision avoidance, shortest-queue choice, impatience and spontaneous route switching remain outside this demo model.

## JSON boundary

- Doni's native `event.ticket_categories` carries category inventory and gate IDs.
- Native `demand.arrival_windows_percent` is the weighted category aggregate of the behavior profiles.
- `behavior_context` uses `opsidio-behavior/0.1`, with profiles and category × segment cohort records.
- Each cohort references `category_id`, `segment_id`, `share_percent`, `arrival_node_id` and `destination_node_id`.
- Serialized `expected_attendees_estimate` is informational. Runtime counts come from native sold/issued counts, no-show percentage and cohort shares, using deterministic largest-remainder rounding.
- `spatial_context` carries the positions, directed routes and staff/equipment bindings in the agreed local metre frame.

The adapter rejects missing route bindings, invalid coordinates, duplicate IDs, staffing-position mismatches, and category or profile shares that do not sum to 100%. It also rejects native category arrival curves that disagree with the behavior mixture. The worker rejects disconnected paths and cohorts without a required checkpoint.

V1 is local. Optimize sends the complete current plan snapshot to Doni's API. The API payload includes aggregate category demand and the spatial and behavior extensions. V2 candidates need matching layout bindings before local playback.

Rebuild the example with `node --experimental-strip-types tools/build-coldplay-demo.mjs`. The immutable earlier V1 is commit `21e36fd`; the new cohort revision adds these definitions.
