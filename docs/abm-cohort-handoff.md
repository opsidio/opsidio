# V1 ABM cohort handoff

The complete input is `contracts/examples/coldplay-gbk-demo-plan.json`. The browser groups demand by ticket category, behavior segment and transport origin. Parameters are defined once per segment, and each generated journey inherits those parameters. The 76 authored category × behavior rows expand into 228 runtime cohorts when the three transport origins are declared, preserving all 70,000 people. Legacy plans without transport origins retain their 76 behavior cohorts.

All segment shares, arrival profiles, group sizes, speeds and local spawn offsets are fictional demo assumptions. Public category-to-entry routing is retained from the sourced admission scenario.

## Revision 8 staffing

| Entrance | Staffed lanes | Security | Scan | Help | Total staff |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plaza Tenggara | 8 | 8 | 8 | 1 | 17 |
| Plaza Barat | 4 | 4 | 4 | 1 | 9 |
| Pintu Kuning | 5 | 5 | 5 | 1 | 11 |
| Plaza Utara | 5 | 5 | 5 | 1 | 11 |
| Plaza Timur | 8 | 8 | 8 | 1 | 17 |
| **Total** | **30** | **30** | **30** | **5** | **65** |

The demo's wage estimate is Rp24.25 million for one shift per person. Meals add Rp2.925 million, for Rp27.175 million against the Rp30 million staff cap. Each staffed lane uses one scanner and one detector wand. The baseline allocates 20 units on hand and ten rentals per device type. Committed equipment costs of Rp5 million plus Rp2.5 million in rentals give Rp7.5 million against the Rp30 million equipment cap. These calculations use the fixture's fictional inputs.

## Behavior profiles

Arrival shares below correspond to 09:00–13:00, 13:00–15:30, 15:30–17:30 and 17:30–19:30 WIB.

| Segment | Arrival shares | Group size | Walking speed | Onsite spawn |
| --- | --- | --- | --- | --- |
| Early fan | 40 / 40 / 18 / 2% | 2 | 1.2 m/s | Main queue approach |
| Regular attendee | 5 / 25 / 50 / 20% | 2 | 1.2 m/s | Walking approach |
| Late arrival | 0 / 5 / 45 / 50% | 2 | 1.25 m/s | Drop-off approach |
| Package holder | 5 / 65 / 28 / 2% | 2 | 1.1 m/s | Package approach |
| Social group | 10 / 35 / 45 / 10% | 4 | 1.0 m/s | Group meeting approach |

Without transport origins, the onsite spawn labels above select the legacy per-entry approach nodes. With `spatial_context.arrival_origins`, visitors start at shared MRT, parking or taxi/ride-hailing origin nodes, follow the authored public approach network to their assigned entry forecourt, and continue through that entry's lanes. Origin positions and public routes carry their own provenance; mode shares remain fictional behavior assumptions.

| Segment | MRT | Parking | Taxi / ride-hailing |
| --- | --- | --- | --- |
| Early fan | 60% | 15% | 25% |
| Regular attendee | 45% | 25% | 30% |
| Late arrival | 20% | 10% | 70% |
| Package holder | 10% | 40% | 50% |
| Social group | 25% | 45% | 30% |

Each profile's `origin_share_percent` references every declared origin and sums to 100%. The adapter first applies native no-shows and category behavior shares using largest remainders. It then allocates whole groups to transport origins using largest remainders, with stable origin-ID tie breaks. If a behavior cohort has an incomplete final group, that single partial group goes to the origin furthest below its attendee target. Exact head counts are conserved; small cohorts may differ from their modal percentages by a group. Transport allocation does not change the profile arrival windows or their native category aggregate.

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

The runtime path is transport origin → public approach → assigned entry forecourt → help desk → security queue and screening → ticket scan and wristband → one-way category handover. Each entrance distributes arriving groups round-robin across its authored lanes. Each lane has its own scan and security checkpoint and bound operators. The local worker queues visitors FIFO, processes one visitor per operator, then continues the journey. It uses fixed typical times from the native process steps and native gate opening/closing clocks. Only groups selected by the editable `help_desk_visit_percent` stop at the help desk. The demo uses a fictional 1% in every profile.

Every ticket category has a named destination node. These are post-security category handover points at its assigned entry area. Category handovers are spaced around that area's admitted endpoint until internal routes are reviewed. `viewing_tier` records the eventual seated or standing sector. `final_zone_route_status` is `pending_venue_review`. Seat blocks, stairs, accessible routes and stage-specific field destinations still need venue mapping.

Groups spawn together with the same arrival timestamp and follow the cohort route and speed. The security pens follow the barrier layout. The panel reports the full queue and the number waiting off-scene when the pen fills. Visitors awaiting service at closing remain pending. Dynamic collision avoidance, shortest-queue choice, impatience and spontaneous route switching remain outside this demo model.

## JSON boundary

- Doni's native `event.ticket_categories` carries category inventory and gate IDs.
- Native `demand.arrival_windows_percent` is the weighted category aggregate of the behavior profiles.
- `behavior_context` uses `opsidio-behavior/0.1`, with profiles and category × segment cohort records.
- Each cohort references `category_id`, `segment_id`, `share_percent`, `arrival_node_id` and `destination_node_id`.
- Transport origins use `spatial_context.arrival_origins` with `id`, `label`, `mode`, `position_m`, `source_url` and `basis`. Each binds to a same-ID arrival node in `shared_origins`; public waypoints use `approach_network`.
- Compiled transport cohort IDs are `<behavior cohort ID>__<origin ID>`; `categoryId`, `segmentId` and `originId` retain their aggregation identities. `compiled.arrivalOrigins` exposes normalized positions and attendee totals for map pins.
- Serialized `expected_attendees_estimate` is informational. Runtime counts come from native sold/issued counts, no-show percentage and cohort shares, using deterministic largest-remainder rounding.
- `spatial_context` carries the positions, directed routes and staff/equipment bindings in the agreed local metre frame.

The adapter rejects missing route bindings, invalid coordinates, duplicate IDs, staffing-position mismatches, unknown origin references, and category, profile or modal shares that do not sum to 100%. It checks directed reachability through each category's own lane checkpoints and prevents a station from double counting an operator or checkpoint. It also rejects native category arrival curves that disagree with the behavior mixture. The worker validates the resolved routes again before generating journeys.

North editor projections retain public approach edges crossing into the editable area. Removing their bound North endpoint fails explicitly. Native queue-to-gate walking distance averages bounded samples across the North lane options, starting at the local `arrival` forecourt node. The external transport prefix and all queue/service time are excluded; full journey walking time still includes the transport approach.

V1 is local. Optimize sends the complete current plan snapshot to Doni's API. The API payload includes aggregate category demand and the spatial and behavior extensions. V2 candidates need matching layout bindings before local playback.

Rebuild the example with `node --experimental-strip-types tools/build-coldplay-demo.mjs`. The immutable earlier V1 is commit `21e36fd`; the new cohort revision adds these definitions.
