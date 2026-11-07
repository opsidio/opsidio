# Doni V3 corridor comparison

The full GBK simulation runs in the browser from the selected saved version or draft. Doni's deployed Phase 1 service runs a different, smaller model: one ordered corridor, up to 500 visitors, one ticket scan checkpoint, and up to eight scan lanes. It compares lane counts; it does not optimize venue-wide demand, security, help desks or gate clocks.

The workspace projects a busy wave from actual generated arrivals for the selected entrance. The corridor preserves one authored walking path, the observed release interval and sample walking speed, and the plan's typical ticket-scan and wristband time. V3 releases visitors uniformly across that interval. The pilot's queue results describe this corridor sample only.

## Run locally

Start the local Python bridge with `python3.11 -m api.simulation` and set `OPSIDIO_CORRIDOR_API_KEY` in its **server environment**. The default base is Doni's Opsidio Railway host; `OPSIDIO_CORRIDOR_API_URL` can override it for an authorized test environment. The browser calls same-origin `/api/simulation/corridor/health` and `/api/simulation/corridor/optimize`. Vite proxies these to the local bridge. The bridge sends the key as `X-API-Key` to Doni and never returns it to the browser. The legacy v1 bridge configuration stays separate.

## Enable on Vercel

The Vercel project with root directory `web` serves the two same-origin corridor routes from `web/api`. Add `OPSIDIO_CORRIDOR_API_KEY` as a sensitive server environment variable for the intended deployment environment and redeploy. The function sends the key only to Doni’s production Railway endpoint. Use Vercel Firewall to rate limit `/api/simulation/corridor/optimize` on a public demo deployment.

Check `/api/simulation/corridor/health` after deployment. `configured: true` confirms that the function has a key. A successful comparison verifies access to Doni’s API. Open `/simulation/workspace` for V3 comparisons. The original dashboard simulation uses the separate V1 API.

## Produce and review a second version

1. Open `/simulation/workspace` and select V1. For a trial with spare staffed positions, set Plaza Timur to six lanes in **Editor → Staffing & hours**. Keep this as a draft: its source still authors eight positions.
2. Open **Optimize**, enable **Include draft edits**, pick Plaza Timur, and select **Compare lanes with Doni**. The bridge creates a V3 corridor plan, runs the synchronous optimization and verifies that the returned runs and candidate belong to it.
3. Review baseline versus best scan metrics. If the candidate improves and fits the authored positions, choose **Save candidate as new version**. Opsidio applies the lane count to the full GBK plan, keeps the other gate settings and seed, and validates the result. With all authored lanes already active there is no add-lanes candidate to apply.
4. Select the saved candidate in **Version**, run the full local simulation, and compare **Report** at the same clock time and seed as the draft. Use the full run for admissions and queues across gates. Repeat with a different staffed draft or an explicitly authored capacity change; the pilot comparison alone does not establish the venue outcome.

See Doni's [Phase 1 deployment handoff](../api/algorithm/docs/deployments/2026-11-07-phase-1-railway.md) and [V3 API contract](../api/algorithm/api/openapi.yaml).

In the live Festival trial, Doni chose eight scan lanes over a six-lane draft for 500 visitors. The pilot peak scan queue was 224 → 132 and P90 wait was 298 → 133 seconds. Applying the candidate and replaying all 70,000 local arrivals with the same seed moved admissions by 21:00 WIB from 38,883 to 41,654. This restores the published V8 baseline's eight Festival lanes; it is an improvement over the six-lane draft.
