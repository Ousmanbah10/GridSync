# GridSync MongoDB structure

Database: `gridsync`. Run from the repository root:

```sh
backend/.venv/bin/python backend/manage.py setup_mongodb
```

The command creates four collections with JSON Schema validators and indexes. It is safe to rerun with the same schema. It does not import the spreadsheet, delete records, or replace existing collection validators. Schema changes need an explicit migration. Django's own admin/authentication tables remain in SQLite.

## Workbook inspected

`backend/OurGridFuture_PlannedTransmissionProjects_Jun2026.xlsx`

- `Planned Transmission Projects`: 707 records, 646 distinct Project IDs.
- `Study Concepts`: 15 records, 2 distinct Project IDs.
- `Substations in Planned Projects`: 1,083 populated rows, 1,082 distinct Substation IDs. Resolve the duplicate before deduplicating or linking substations automatically.
- `About` and `Field definitions`: attribution and field meanings.

Counts use populated records, not the workbook's saved filter range, which excludes some substation rows.

## Collections

| Collection | Document meaning |
| --- | --- |
| `sources` | Dataset or source document, including filename, citation, publisher, publication date, and optional file hash |
| `projects` | One source record/segment. Several records may share a Project ID. `dataset_kind` distinguishes planned projects from study concepts |
| `substations` | One source substation row, preserving duplicate source IDs for review. MongoDB `_id` is the internal unique identity |
| `coordination_opportunities` | A future comparison involving at least two project record `_id` values, with calculations, AI outputs, and workflow status |

Source IDs are strings shared between `sources.source_id` and project/substation `source_id`. MongoDB does not enforce foreign keys; future import/API code must verify references. Preserve original cells in `raw_data` and the sheet/row in provenance. Repeated imports must use the unique source keys, not blind inserts.

## Field mapping

| Requested field / workbook column | MongoDB field |
| --- | --- |
| Record ID / Project ID / Segment | `projects.record_id`, `project_id`, `segment` |
| Project name | `projects.project_name` |
| Utility/owner / Owner | `projects.owner` (retain original text; do not split company names blindly) |
| Project type / Change type | `projects.project_type` |
| Line type / AC or DC | `projects.line_type`, `ac_dc` |
| Minimum / Maximum voltage (kV) | `projects.voltage_min_kv`, `voltage_max_kv` |
| Capacity (MW) | `projects.capacity_mw` |
| Status / Status last updated date | `projects.status`, `status_updated_at` |
| Origin / Destination substation | `projects.origin.name`, `destination.name`; optional internal `substation_id` and GeoJSON `location` on each endpoint |
| Related substations | `projects.related_substations` |
| Latitude / Longitude | `substations.location`: GeoJSON Point, coordinates **[longitude, latitude]** |
| Actual route | `projects.route`: optional GeoJSON LineString or MultiLineString, plus `route_source_url` |
| States intersected / abbreviated / RTO intersected | `projects.states`, `state_codes`, `rtos` arrays |
| Estimated in service year | `projects.in_service_year`; preserve uncertain/range text in `in_service_year_raw` |
| Construction dates | `projects.construction.start_date`, `end_date`, `source_url` |
| Project cost | `projects.project_cost.amount`, `currency`, `source_url`, `as_of` |
| Link 1 / Link 2 | `projects.source_urls` |
| Dataset/source document | `sources`, linked via `source_id`, plus `source_sheet`, `source_row`, `raw_data` |
| Federal / State permitting status | `projects.permitting.federal_status`, `state_status` |
| Last permitting update / simple statuses | `projects.permitting.updated_at`, `federal_simple_status`, `state_simple_status` |
| Alternative name | `projects.alternative_name` |
| Planning authority / process / Planning | `projects.planning_authority`, `planning_process`, `planning_portfolio` |
| Length (mi) / Length source | `projects.length_miles`, `length_source` (route length, not distance between projects) |
| Substation ID / name / HIFLD name / HIFLD ID | `substations.substation_id`, `name`, `hifld_name`, `hifld_id` |
| State / State (abbrv.) | `substations.state`, `state_code` |
| Current minimum / maximum voltage | `substations.voltage_min_kv`, `voltage_max_kv` |
| Planned project / voltage | `substations.planned_projects_raw`, `planned_voltage_kv` |
| Presence in HIFLD / Existing or new | `substations.hifld_presence`, `existing_or_new` |
| Closest distance | `coordination_opportunities.distance_km`, `distance_basis` |
| Timeline overlap | `coordination_opportunities.timeline_overlap`, `overlap_start`, `overlap_end` |
| Coordination score | `coordination_opportunities.coordination_score`, `score_method_version`, `calculated_at` |
| Shared resources | `coordination_opportunities.shared_resources`: resource, explanation, source |
| Potential savings | `coordination_opportunities.potential_savings`: low/high amounts, currency, assumptions, method version, estimate date |
| AI analysis / Coordination plan / Meeting agenda | `coordination_opportunities.ai_analysis`, `coordination_plan`, `meeting_agenda`: text, generated date, model, method version, source URLs |
| Status tracking | `coordination_opportunities.status`, `status_history` |

## Unknowns and future work

- Collections start empty. Importing the workbook is the next separate step.
- Blank/unknown values stay absent or null; never substitute zero or false. Numeric zeros already in the source require interpretation during import and must remain auditable in `raw_data`.
- Excel date serials must become BSON dates during import; do not mistake them for years.
- Substation coordinates are present, but route geometry, construction dates, and costs have no columns in this workbook. Add these only from identifiable supporting sources.
- Names alone are insufficient to link substations reliably. Preserve unresolved endpoint names; resolve with state and other source evidence.
- An in-service year alone does not establish a construction interval or timeline overlap.
- Scores, distance calculations, savings, and AI output fields are storage definitions only. No algorithms, score scale, or generated outputs have been implemented.
- Workflow states initially allow `detected`, `reviewing`, `contacted`, `coordinating`, `completed`, `dismissed`; refine after the product workflow is defined.
- Geospatial indexes validate stored geometry. Keep unknown geometry absent/null; never create an invented straight-line route.
- Validators enforce field types, not all business relationships (e.g. date ordering, minimum vs maximum, or reference existence). Future write services must enforce those rules.

Schema validation follows the [MongoDB JSON Schema documentation](https://www.mongodb.com/docs/manual/core/schema-validation/specify-json-schema/).
