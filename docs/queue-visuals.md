# Operator queue annotations

Each operator receives a bar directly above their authored X/Z position. A thin
stem connects the annotation to the operator; staff and attendee positions remain
at ground level. Bars start 6 m above ground to clear the current canopies.

- **Height:** current waiting count, excluding the person being processed. A
  square-root scale adds up to 18 m of height at 5,000 queued people. Larger queues
  retain their exact counts; only the visual height is capped. An idle operator
  has a short neutral marker, and a processing operator with no queue is teal.
- **Color:** oldest current wait in that operator's queue. Fresh waits are yellow,
  5 minutes is orange, and 15 minutes is red. Colors interpolate continuously and
  stay red beyond 15 minutes. These are editable display assumptions, not reviewed
  operational alert thresholds.
- **People:** currently waiting bodies use the same gradient for each person's
  uninterrupted wait at their current station. Processing stays teal; walking
  stays yellow. Previous waits do not carry into the next queue's color.
- **Labels:** queue count and oldest wait in minutes appear when zoom permits.
  Offscreen and overlapping labels are hidden, with at most 16 shown at once.
  Bars remain visible without labels at map scale.

Queue counts and oldest waits come from binary searches over the full FIFO
timeline, including unserved people whose start/end times are null. They are
independent of the crowd preview's front-32-per-queue display cap. Help operators
without an authored service queue show zero; no exception demand is invented.

`prepareJourneySampler` should be called once per result and shared between
`CrowdPreview` and `OperatorQueueBars`. Queue annotation geometry uses instances
and reusable buffers; labels update at most five times per second. Visual
constants live in `web/src/simulation/abm/wait-visuals.ts`.

Focused checks:

```sh
node --experimental-strip-types --test web/src/simulation/abm/queue-visuals.test.mjs
cd web && npm run build
```
