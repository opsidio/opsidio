# Opsidio GBK demo implementation plan

## Demo scope

Build one editable admission corridor at Plaza Utara in a fresh checkout of `opsidio/opsidio`. Start on a prepared layout with a scan tent, covered security checkpoint, barrier rows, a separate ticket exception desk, and an arrival-to-concourse route. Show a saved scenario comparison, then let the audience change the layout and see the route update live. Keep the work within four hours.

The scenario is **Coldplay Jakarta 2023 · fictional operations scenario**. The concert date and venue are public. ANTARA's report on the promoter's guide places CAT 5–8 at Plaza Utara near Gate 10 and SPARK. The event placement of each tent, checkpoint, and row is a demo design. [Promoter announcement](https://www.pk-ent.com/news/coldplay-music-of-the-spheres-world-tour) · [Published entry guide](https://www.antaranews.com/berita/3823839/perhatikan-hal-penting-ini-sebelum-nonton-konser-coldplay)

Use the references for different kinds of evidence. Morning queues support including early arrivals. Reports about ticket scanning support a fictional scan-exception stress case. The account of people passing an outer gate describes another check before stadium admission, so keep those checkpoints distinct. Use the supplied photos to guide the appearance of pagoda roofs, long covered lanes, barriers, and signs. They provide visual context for the scene. [Morning queues](https://media.sindonews.com/video/play/88945/9/mengintip-suasana-gbk-jelang-konser-coldplay-penggemar-antri-sejak-pagi) · [Ticket scanning report](https://www.liputan6.com/tekno/read/5454710/viral-pemegang-tiket-resmi-tak-bisa-scan-barcode-gagal-nonton-konser-coldplay-jakarta) · [Outer-gate account](https://www.suara.com/entertainment/2023/11/16/123312/detik-detik-konser-coldplay-di-gbk-rusuh-kemal-palevi-ajak-kru-ngobrol-jebol-bro)

Keep a source and basis for scenario inputs. The fictional values include corridor attendance and arrival shares, staffing, lane assignments, service times, scan-exception rate, and any cost inputs. Label the scope as one corridor. Compare a stressed baseline with a candidate that adds one staffed scan lane within the tent, equipment, and staffing limits. Put ticket exceptions on the same separate help-desk branch in both versions so the comparison isolates the lane change.

## Operator decision

**During a scan slowdown at Plaza Utara, does one extra staffed scan lane reduce the peak scan queue enough to justify its crew and equipment cost?** Set a demo queue target in people and a budget in IDR before running the comparison. Record both as scenario assumptions.

Show physical lane positions, usable scanners, and lane capacity from eligible staff during the rush. A lane is available to run only when all three checks pass. The live demo should include a draft with space and crew for a fifth lane but only four available scanners. Show which resource blocks the fifth lane. Use a separately prepared, feasible candidate for the saved comparison.

## Equipment research gate

One GPT-6 Astra researcher completed the initial catalogue research. At kickoff, Faisal reviews the source and dimensions, then freezes the v1 catalogue before the equipment meshes and editor consume it. The sizes below describe selected supplier or manufacturer products. Exact Coldplay equipment and installation details remain unknown.

| Editable preset | Dimensions in metres | Reference |
| --- | --- | --- |
| Sarnafil pagoda tent, small | 3 × 3 plan, 2.60 eave, 4.10 peak | [Jakarta rental sizes](https://sewapagarbarikade.com/sewa/tenda-event/) · [Reference heights](https://yuntutent.com/product/pagoda-tent/) |
| Sarnafil pagoda tent, large | 5 × 5 plan, 2.60 eave, 5.25 peak | [Jakarta rental sizes](https://sewapagarbarikade.com/sewa/tenda-event/) · [Reference heights](https://yuntutent.com/product/pagoda-tent/) |
| Roder covered security tent | 10 m span × 10 m length for the demo, in two 5 m bays. 4 m eave and 5 m peak. | [Amira Tent](https://amiratent.id/produk/tenda-roder/) |
| Interlocking pedestrian rowing panel, demo default | 2.30 length × 0.46 foot depth × 1.10 height | [Securasite PB-23-EC-001](https://securasite.com/product/galvanised-pedestrian-barrier/) |
| Indonesian rowing variants | 2.00 or 2.50 length × 1.00 height. Foot depth requires a vendor measurement or a labeled user estimate. | [Deorama](https://deorama.id/product/barikade-rowing-pembatas-rowing-besi/) · [GBK rental precedent](https://sewapagarbarikade.com/sewa/pagar-barikade/) |
| Check-in or bag-check folding table | 1.83 × 0.76 plan, 0.74 high | [Lifetime 280857](https://www.lifetime.com/lifetime-280857-6-foot-fold-in-half-table-light-commercial) |
| Walk-through detector, if time allows | 0.90 width × 0.58 depth × 2.21 high. The 30-inch model has 0.76 m internal passage width. | [Garrett PD 6500i datasheet](https://garrett.com/sites/default/files/2019-11/1554400_pd6500i_rev_N_aug_2019.pdf) |

Use one catalogue for the meshes, top-down footprints, inspector, and JSON export. Store a preset ID, catalogue version, dimensions in metres, source references, and dimension basis. Store placements by preset ID, position, yaw, and discrete parameters such as bay or panel count. Let users add, remove, move, rotate, and switch presets. Let users enter a custom measured size as a separate variant.

Use the occupied ground footprint for collision. Tables and queue panels can sit under a canopy, with checks against tent posts and any modeled ballast. Treat ballast, tent anchors, staff working space, queue lane width, and installed panel spacing as separately editable planning parameters. A lane width shown on screen is clear space between the modeled feet. A 1.2 m example is a fictional planning input, and the editor reports geometric fit. Use pedestrian rowing panels for queues and keep pressure-rated front-of-stage barricades outside the demo catalogue.

## Dashboard integration

Make `/simulation` a standalone, full-screen venue scene with small camera controls. Wira owns the later dashboard overlay and navigation. Faisal's lane owns the renderer and coordinate foundation. Wira can compose `GbkCanvas` under the overlay through its scene props. Keep scene state and metre coordinates separate from overlay pixels. [Spatial and layout contract](spatial-layout-contract.md)

## Four-hour dispatch

Faisal integrates. Use up to three GPT-6 Astra agents at once, with one worktree per builder and one owner for shared types and dependencies. The four build lanes are separate so each can work from the same fixture.

| Time | Agent work and checkpoint |
| --- | --- |
| T+0–20 | Faisal freezes shared venue, kit, layout, and route types. Review the research in the first slot. Spatial and 3D agents can start the venue extract and the procedural stadium shell while equipment details are signed off. |
| T+20–65 | Release the research slot to the layout-editor agent. The 3D agent builds kit meshes from the frozen catalogue. The spatial agent delivers the offline GBK pack and documented Plaza Utara working area by T+65. In parallel, Doni and Faisal validate and run a minimal GBK baseline by T+60 and check that the engine consumes a supported lane-count change. Use the resulting capability check to lock the demo fallback. |
| T+65–130 | Release the spatial slot to the ABM waypoint agent. Resolve arrival, queue, scan, security, help-desk, and destination nodes against the accepted layout revision. Faisal stitches the scene, editor, and route preview. At T+130, move a preset and export a new revision in the app. |
| T+130–200 | Pre-run the comparison and bundle the saved results. Andre walks the route with a ticketing or venue ops reviewer and checks where failed scans go, one queue row, one staffing assignment, and the fictional arrival and service assumptions. Record feedback and fixes before freeze. Prioritize fit checks and the offline comparison ahead of optional meshes. |
| T+200–240 | Freeze features. Rehearse on the demo laptop with the simulation API unavailable. |

Spatial pack and editor use one metre frame centered at `106.80255 E, 6.21858 S`, with X east, Y up, and Z south. Build the recognisable bowl, roof, pitch, track, and ribs first. Use bounded, attributed map data and bundle it locally. If map retrieval misses the first milestone, use a clearly labeled schematic pack in the same frame. [OpenStreetMap attribution](https://osmfoundation.org/wiki/Attribution_Guidelines)

## Pre-run and live demo

- **Prepared comparison.** Save baseline and candidate layout revisions, source assumptions, and their route calculations. If Doni validates the compiled GBK plans, also run them before the demo with the same DES method, seed, and replication count. Save genuine output with the corresponding plan snapshot hash, layout revision, and engine settings. Lead with peak scan queue in people and show P90 gate wait, admissions before showtime, and staffing and equipment cost as supporting metrics. Show the change, the target and budget checks, and which revision the operator selected. Save the chosen revision with its assumptions and linked runs. If the GBK run or required metric is unavailable, show the layout and route comparison and mark the operational decision pending. [Simulation handoff](simulation-handoff.md)
- **Live edit.** Open the prepared baseline and move the scan tent or add a rowing panel. Show the changed dimensions, clear width, route, and JSON export immediately. Allow edits to the planned lane count. Show the limiting requirement and require feasibility before sending the draft for simulation or selecting it for operations. Keep the pre-run comparison separately labeled. A changed input gets a new revision with operational results pending until a corresponding run completes.
- **Acceptance.** From a clean browser, open and refresh the deployed `/simulation` deep link with the simulation API unreachable. Try a valid tent move, a panel that narrows the lane, a fifth lane with only four scanners, and an unreachable checkpoint. Check that compatible objects can sit under the canopy, obstacles use the modeled foot depth, invalid routes produce an error, and the exported geometry and checkpoints share the same revision.
