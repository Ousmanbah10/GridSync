from coordination.geometry import coordinate


def substations_geojson(rows):
    features, skipped = [], 0
    for row in rows:
        geometry = row.get('location') or {}
        try:
            if geometry.get('type') != 'Point':
                raise ValueError('Missing point')
            lon, lat = coordinate(geometry.get('coordinates'))
        except (ValueError, AttributeError):
            skipped += 1
            continue
        features.append({
            'type': 'Feature', 'id': str(row['_id']),
            'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
            'properties': {
                'name': row.get('name') or 'Unnamed substation',
                'substation_id': row.get('substation_id'), 'state_code': row.get('state_code'),
                'voltage_max_kv': row.get('voltage_max_kv'), 'existing_or_new': row.get('existing_or_new'),
                'source_id': row.get('source_id'), 'source_sheet': row.get('source_sheet'),
                'source_row': row.get('source_row'),
            },
        })
    return {'type': 'FeatureCollection', 'features': features, 'skipped_coordinates': skipped}
