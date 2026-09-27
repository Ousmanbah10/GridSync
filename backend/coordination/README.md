# GridSync distance engine

Deterministic mathematics, independent of Gemini and the frontend. No new dependencies.

## Files

| File | Responsibility |
| --- | --- |
| `geometry.py` | Coordinate validation, Haversine distance, spherical route segment distance/intersection |
| `locations.py` | Resolve project endpoint/related-substation locations with explicit evidence |
| `rules.py` | Distance bands and proximity-only score |
| `engine.py` | Eligibility, pair comparison, ordering, and coverage diagnostics |
| `repository.py` | Read one MongoDB snapshot; optionally save candidates without resetting workflow |
| `views.py` | Paginated read-only API for the later frontend |
| `tests.py` | Geometry, boundaries, matching, ranking, and storage invariants |
| `../database/management/commands/rank_opportunities.py` | CLI entry point |

## Run

From `backend/` with the virtual environment active:

```sh
# Preview against imported MongoDB data; no writes:
python manage.py rank_opportunities

# Save the calculated opportunities:
python manage.py rank_opportunities --save

# Include the complete evidence and matching diagnostics in a JSON report:
python manage.py rank_opportunities --output /tmp/gridsync-distance-report.json

# Select a snapshot when more than one workbook version was imported:
python manage.py rank_opportunities --source-id 'xlsx:YOUR_FILE_HASH' --save

python manage.py test coordination database
```

If there are no imported projects, the command asks you to import first. It never silently imports the workbook. When multiple snapshots exist, it asks you to choose one rather than comparing duplicate versions.

The future frontend can read saved results from `GET /api/opportunities/?limit=50&offset=0`, optionally with `source_id`. The existing local-only API restriction applies. Default sorting is priority, then distance, then stable record ID. `rank` is within its source snapshot; use the source filter when displaying numbered ranks.

## Mathematics

For latitude φ and longitude λ in radians, Earth radius R = 6371.0088 km:

```
a = sin²((φ₂ − φ₁)/2) + cos(φ₁) cos(φ₂) sin²((λ₂ − λ₁)/2)
d = 2R atan2(√a, √(1 − a))
```

Clamp `a` into [0, 1] to handle floating-point rounding. This is Haversine surface distance, not road distance. For two projects with resolved point sets A and B:

```
project_distance = min(haversine(a, b) for a in A for b in B)
```

When both projects have valid supplied routes, use the minimum distance between their route segments. Each supplied segment is interpreted as the shortest great-circle arc between its vertices. Convert each vertex to a unit vector:

```
v = (cosφ cosλ, cosφ sinλ, sinφ)
angle(u, v) = atan2(|u × v|, u · v)
```

Intersect great-circle normals to find candidate crossing points, then check membership in both finite arcs. For disjoint arcs, test each endpoint against the other finite arc: project onto its great-circle plane, accept the projected foot if it lies within the arc, otherwise use the arc endpoints. Multiply the minimum angular distance by R. MultiLineString components remain separate; no lines are drawn across gaps. Antipodal vertices are rejected as ambiguous.

If only one project has a route, compare substation points only when both projects have them; otherwise report the pair as incomparable. This version does not calculate mixed point-to-route project distances.

## Distance bands (coordination-v3)

| Condition | Band | Meaning |
| --- | --- | --- |
| Supplied route geometries intersect | `touching_crossing` | Outage timing and crossing structures |
| Both projects connect at the same substation | `shared_substation` | Substation outage/switching plan, bay and yard space. Always kept regardless of distance. `distance_km` is the distance between the *other* ends (`other_endpoints`), or 0 when they are not mapped (`shared_substation_only`). |
| 0 ≤ d < 1.6 km | `shared_land` | Potential shared right-of-way, access roads, permits |
| 1.6 ≤ d < 8 km | `shared_logistics` | Potential shared laydown yards and deliveries |
| 8 ≤ d < 40 km | `shared_crews_equipment` | Potential shared crews and equipment |
| d ≥ 40 km | No candidate | Outside this screening radius |

For pairs without a shared substation, `d` is the smaller of the closest-substation distance and the
**approximate corridor** distance: a straight line between each project's origin and destination
substations (`distance_basis = approximate_corridor`, `corridor_crossing` when the straight lines cross).
This finds long lines that pass close mid-route. It is not the real route.

## Coordination score (0-100, itemized in `score_breakdown`)

Weights live in `rules.py`.

- **Proximity (50):** `50 × (1 − d/40)`. A shared substation earns 35 plus up to 15 more when the other ends are also close.
- **Timeline (30):** construction-date overlap when both projects have dates. Otherwise an **estimate** from in-service years: same year 30, 1 yr apart 22.5, 2 yr 15, 3 yr 7.5, more 0. Unknown 0.
- **Compatibility (20):** same max voltage 10, shared work type 10.

Results are sorted by coordination score, then band priority, then distance.

## Matching, eligibility and merging

1. Use valid explicit endpoint coordinates when supplied.
2. Otherwise use an explicit MongoDB substation reference.
3. Otherwise require exact normalized name, same source snapshot, and a state included in the project. No fuzzy matching.
4. Accept a name match only when exactly one substation row remains; unmatched or ambiguous entries are reported.

**Eligibility:** the two records must belong to **different utilities** (`eligibility.py`). Owner cells are split into
co-owners on commas/semicolons only ("Pacific Gas and Electric Company" is one name). Names are grouped by
`owners.py` (aliases, typos and subsidiaries → parent company, e.g. Dominion/Dominion Energy, Entergy LA/MS,
ITC/ITC Midwest, Xcel/Northern States Power). Edit `ALIASES`/`PREFIXES` there to change groupings. The same
company in different states is **not** eligible. Unknown owners are not eligible.

**Merging:** segments and alternative route options of the same two source projects collapse into one opportunity
(the best-scoring record pair). `segment_pairs` and `other_record_pairs` record what was merged. Saved IDs are keyed
on the source Project ID pair. Inactive records and study concepts are excluded by default (`--include-inactive`,
`--include-concepts`).

## Evidence, persistence, and limitations

- Each candidate carries the distance basis, matched location evidence, closest substation pair when applicable, method version, source snapshot, and suggested resources.
- Actual route data are needed to identify crossings. The current Excel workbook has substation points, not route geometry. A substation-based distance can miss routes that pass close together elsewhere; a pair outside 40 km at its substations may still have nearby routes.
- These are spatial screening candidates, not proven shared-land rights or feasible resource agreements. Crossing labels describe the supplied map geometries, subject to GIS accuracy and engineering review. They do not establish a legal requirement or physical elevation clearance.
- This uses a spherical Earth approximation, not a survey/ellipsoidal solution. Near a band boundary, verify using accurate GIS and ellipsoidal distances before making operational decisions. Input coordinate/route accuracy matters too. See the [Haversine reference](https://www.movable-type.co.uk/scripts/latlong.html) and [vector geodesy reference](https://www.movable-type.co.uk/scripts/latlong-vectors.html).
- Timeline overlap stays unknown; in-service years alone do not establish construction overlap. No savings, AI recommendations, or aggregate coordination score are fabricated.
- Saving uses deterministic IDs, updates only distance-engine fields, and preserves status/history, timeline analysis, and AI/plan/agenda fields. Unmatched old results from this engine and source become inactive only after new upserts finish. No records are deleted.
- Batch saves are resumable, not atomic: a failure may leave a partial refresh. Rerun to repair it. Run only one save job at a time. Recalculate after importing/enriching a source; there is no automatic background job.
- Existing MongoDB validation permits the added evidence/rank fields, so no destructive schema migration is needed.
- Pair search is exhaustive O(P²). Point comparison adds O(A×B) per pair; route comparison adds O(S₁×S₂). Suitable for the current workbook; large GIS datasets need spatial candidate indexing before this engine's exact comparisons.

## Workbook validation

The June 2026 workbook with default exclusions (coordination-v3, verified against MongoDB):

- 722 input records; 638 located. 48 inactive, 15 study concepts and 21 unlocated records skipped.
- 607 eligible record pairs, merged to **558 project-pair opportunities** (49 duplicate segment/route-option pairs).
- Bands: 88 shared substation, 41 under 1.6 km, 25 from 1.6 to under 8 km, 404 from 8 to under 40 km.
- Bases: 319 closest substation, 151 approximate corridor, 62 shared substation with other ends measured, 26 shared substation only.
- Previous version (v2): 699 record pairs, 117 of them "0 km" only because they shared a substation, and 72 pairs
  that paired Dominion with Dominion under a different spelling.

After changing the schema-validated fields, apply the validator explicitly once:

```sh
python manage.py setup_mongodb --update-schema coordination_opportunities
python manage.py rank_opportunities --save
```
