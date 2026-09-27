"""Initial MongoDB schema, based on the June 2026 Our Grid Future workbook.

One project document is one source record/segment, not one Project ID.
Unknown optional values may be omitted or null. No calculated values are invented.
"""
from pymongo import ASCENDING, GEOSPHERE, IndexModel


def optional(kind, **rules):
    return {"bsonType": [kind, "null"], **rules}


def obj(properties, required=()):
    schema = {"bsonType": "object", "properties": properties}
    if required:
        schema["required"] = list(required)
    return schema


def array(item, **rules):
    return {"bsonType": "array", "items": item, **rules}


TEXT = optional("string")
NUMBER = {"bsonType": ["double", "int", "long", "decimal", "null"], "minimum": 0}
DATE = optional("date")
STRINGS = array({"bsonType": "string"})
ID = {"bsonType": "string", "minLength": 1}
POINT = obj({
    "type": {"enum": ["Point"]},
    "coordinates": {
        "bsonType": "array", "minItems": 2, "maxItems": 2,
        "items": [
            {"bsonType": ["double", "int", "long"], "minimum": -180, "maximum": 180},
            {"bsonType": ["double", "int", "long"], "minimum": -90, "maximum": 90},
        ],
    },
}, ("type", "coordinates"))
ENDPOINT = obj({
    "name": TEXT,
    "substation_id": optional("objectId"),
    "location": {"anyOf": [POINT, {"bsonType": "null"}]},
})
MONEY = obj({"amount": NUMBER, "currency": TEXT, "source_url": TEXT, "as_of": DATE})
GENERATED = obj({
    "text": TEXT, "generated_at": DATE, "model": TEXT,
    "method_version": TEXT, "source_urls": STRINGS,
})
COMMON = {
    "_id": {"bsonType": "objectId"},
    "created_at": {"bsonType": "date"},
    "updated_at": {"bsonType": "date"},
}
PROVENANCE = {
    "source_id": ID,
    "source_sheet": ID,
    "source_row": {"bsonType": "int", "minimum": 2},
    "raw_data": {"bsonType": "object"},
}

SCHEMAS = {
    "sources": obj({
        **COMMON, "source_id": ID, "name": ID, "filename": TEXT,
        "publisher": TEXT, "citation": TEXT, "url": TEXT,
        "published_at": DATE, "imported_at": DATE, "file_sha256": TEXT,
    }, ("source_id", "name")),
    "projects": obj({
        **COMMON, **PROVENANCE,
        "record_id": ID, "project_id": ID, "project_name": ID,
        "dataset_kind": {"enum": ["planned_project", "study_concept"]},
        "segment": TEXT, "owner": TEXT, "status": TEXT,
        "status_updated_at": DATE, "project_type": TEXT,
        "line_type": TEXT, "voltage_min_kv": NUMBER, "voltage_max_kv": NUMBER,
        "ac_dc": TEXT, "capacity_mw": NUMBER,
        "in_service_year": optional("int", minimum=1900, maximum=2200),
        "in_service_year_raw": TEXT,
        "alternative_name": TEXT,
        "origin": ENDPOINT, "destination": ENDPOINT,
        "related_substations": STRINGS,
        "states": STRINGS, "state_codes": STRINGS, "rtos": STRINGS,
        "planning_authority": TEXT, "planning_process": TEXT,
        "planning_portfolio": TEXT,
        "length_miles": NUMBER, "length_source": TEXT,
        "source_urls": STRINGS,
        "permitting": obj({
            "federal_status": TEXT, "state_status": TEXT,
            "updated_at": DATE, "federal_simple_status": TEXT,
            "state_simple_status": TEXT,
        }),
        "construction": obj({"start_date": DATE, "end_date": DATE, "source_url": TEXT}),
        "project_cost": MONEY,
        "route": {"anyOf": [{"bsonType": "null"}, obj({
            "type": {"enum": ["LineString", "MultiLineString"]},
            "coordinates": {"bsonType": "array", "minItems": 1},
        }, ("type", "coordinates"))]},
        "route_source_url": TEXT,
    }, ("source_id", "source_sheet", "source_row", "record_id", "project_id", "project_name", "dataset_kind")),
    "substations": obj({
        **COMMON, **PROVENANCE,
        "substation_id": ID, "name": ID, "hifld_name": TEXT,
        "hifld_id": TEXT, "state_code": TEXT, "state": TEXT,
        "location": {"anyOf": [POINT, {"bsonType": "null"}]},
        "voltage_min_kv": NUMBER, "voltage_max_kv": NUMBER,
        "planned_projects_raw": TEXT, "planned_voltage_kv": NUMBER,
        "hifld_presence": TEXT, "existing_or_new": TEXT,
    }, ("source_id", "source_sheet", "source_row", "substation_id", "name")),
    "coordination_opportunities": obj({
        **COMMON,
        "project_record_ids": array({"bsonType": "objectId"}, minItems=2, uniqueItems=True),
        "distance_km": NUMBER,
        "distance_basis": {"enum": ["route", "substation", "approximate_corridor", "other_endpoints",
                                    "shared_substation_only", None]},
        "timeline_overlap": optional("bool"),
        "overlap_start": DATE, "overlap_end": DATE,
        "coordination_score": NUMBER,
        "score_method_version": TEXT, "calculated_at": DATE,
        "shared_resources": array(obj({"resource": ID, "explanation": TEXT, "source": TEXT}, ("resource",))),
        "potential_savings": obj({
            "low_amount": NUMBER, "high_amount": NUMBER, "currency": TEXT,
            "assumptions": STRINGS, "method_version": TEXT, "estimated_at": DATE,
        }),
        "ai_analysis": GENERATED, "coordination_plan": GENERATED,
        "meeting_agenda": GENERATED,
        "status": {"enum": ["detected", "reviewing", "contacted", "coordinating", "completed", "dismissed"]},
        "status_history": array(obj({
            "status": ID, "changed_at": {"bsonType": "date"}, "note": TEXT,
        }, ("status", "changed_at"))),
    }, ("project_record_ids", "status")),
}

INDEXES = {
    "sources": [IndexModel([("source_id", ASCENDING)], unique=True, name="source_id_unique")],
    "projects": [
        IndexModel([("source_id", ASCENDING), ("record_id", ASCENDING)], unique=True, name="source_record_unique"),
        IndexModel([("project_id", ASCENDING)], name="project_group"),
        IndexModel([("state_codes", ASCENDING)], name="project_states"),
        IndexModel([("rtos", ASCENDING)], name="project_rtos"),
        IndexModel([("status", ASCENDING), ("in_service_year", ASCENDING)], name="status_year"),
        IndexModel([("route", GEOSPHERE)], name="route_geo"),
    ],
    "substations": [
        # Preserve duplicate source IDs for review rather than losing source rows.
        IndexModel([("source_id", ASCENDING), ("source_sheet", ASCENDING), ("source_row", ASCENDING)], unique=True, name="source_row_unique"),
        IndexModel([("substation_id", ASCENDING)], name="source_substation_id"),
        IndexModel([("name", ASCENDING), ("state_code", ASCENDING)], name="name_state"),
        IndexModel([("location", GEOSPHERE)], name="location_geo"),
    ],
    "coordination_opportunities": [
        IndexModel([("project_record_ids", ASCENDING)], name="participating_projects"),
        IndexModel([("status", ASCENDING), ("coordination_score", -1)], name="status_priority"),
    ],
}


def setup_database(db):
    """Create missing collections/indexes; refuse implicit schema migrations."""
    existing = {item["name"]: item for item in db.list_collections()}
    # Check all existing schemas before creating anything.
    for name, schema in SCHEMAS.items():
        if name in existing:
            options = existing[name].get("options", {})
            if (options.get("validator") != {"$jsonSchema": schema}
                    or options.get("validationLevel", "strict") != "strict"
                    or options.get("validationAction", "error") != "error"):
                raise ValueError(f"Collection {name} has a different schema. An explicit migration is required.")
    for name, schema in SCHEMAS.items():
        if name not in existing:
            db.create_collection(name, validator={"$jsonSchema": schema},
                                 validationLevel="strict", validationAction="error")
        db[name].create_indexes(INDEXES[name])
        yield name


def update_schemas(db, names):
    """Explicit, opt-in validator update for existing collections. Documents are not rewritten."""
    existing = {item["name"] for item in db.list_collections()}
    for name in names:
        if name not in SCHEMAS:
            raise ValueError(f"Unknown collection {name}.")
        if name in existing:
            db.command("collMod", name, validator={"$jsonSchema": SCHEMAS[name]},
                       validationLevel="strict", validationAction="error")
            yield name
