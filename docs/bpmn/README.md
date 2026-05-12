# BPMN diagrams (R10)

Every workflow in the pipeline must be a BPMN diagram in the report.
Source files in this directory are BPMN 2.0 XML, exportable from
[bpmn.io](https://bpmn.io) or Camunda Modeler.

| File | Workflow |
|---|---|
| `surge-stream.bpmn`         | Stream pipeline — recompute zone surge multiplier on each window |
| `nightly-aggregates.bpmn`   | Batch pipeline — refresh materialised views and emit CSV at 03:00 |
| `trip-lifecycle.bpmn`       | The trip itself, from `requested` to terminal state, including cancellation paths |

## Authoring guidance

Use a *single* pool per diagram with one swimlane per actor / service.
Common actors:

- **Rider** (human task)
- **Driver** (human task)
- **API**, **Matcher**, **Ingestor**, **WS Gateway** (service tasks)
- **Postgres**, **Redis**, **Redpanda** (data stores — render as data objects, not lanes)

Embed the rendered SVG of each BPMN file in the PDF report's *Pipeline*
section. Don't paste screenshots of the editor — the BPMN renderer's clean
SVG export looks much better in print.
