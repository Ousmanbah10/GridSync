"""Spherical geodesic geometry. Public coordinates are (longitude, latitude)."""
from math import atan2, cos, isfinite, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0088
EPS = 1e-10  # Angular tolerance, about 0.64 mm on the model sphere.


def coordinate(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('Coordinates must be [longitude, latitude].')
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v) for v in value):
        raise ValueError('Coordinates must contain finite numbers.')
    lon, lat = value
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValueError('Coordinates are outside longitude/latitude bounds.')
    return float(lon), float(lat)


def haversine_km(a, b):
    lon1, lat1 = map(radians, coordinate(a))
    lon2, lat2 = map(radians, coordinate(b))
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    h = min(1.0, max(0.0, h))
    return 2 * EARTH_RADIUS_KM * atan2(sqrt(h), sqrt(1 - h))


def vector(point):
    lon, lat = map(radians, coordinate(point))
    return cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]


def norm(a):
    return sqrt(dot(a, a))


def unit(a):
    size = norm(a)
    if size < EPS:
        return None
    return tuple(v / size for v in a)


def angle(a, b):
    return atan2(norm(cross(a, b)), max(-1.0, min(1.0, dot(a, b))))


def on_arc(p, a, b):
    return abs(angle(a, p) + angle(p, b) - angle(a, b)) <= EPS


def point_arc_angle(p, a, b):
    best = min(angle(p, a), angle(p, b))
    normal = unit(cross(a, b))
    if normal is None:
        return best
    projection = unit(tuple(p[i] - dot(p, normal) * normal[i] for i in range(3)))
    if projection is not None:
        for candidate in (projection, tuple(-v for v in projection)):
            if on_arc(candidate, a, b):
                best = min(best, angle(p, candidate))
    return best


def arcs_intersect(a, b, c, d):
    n1, n2 = unit(cross(a, b)), unit(cross(c, d))
    if n1 is None or n2 is None:
        return min(point_arc_angle(a, c, d), point_arc_angle(c, a, b)) <= EPS
    axis = unit(cross(n1, n2))
    if axis is None:
        return any(on_arc(p, a, b) for p in (c, d)) or any(on_arc(p, c, d) for p in (a, b))
    return any(on_arc(p, a, b) and on_arc(p, c, d) for p in (axis, tuple(-v for v in axis)))


def route_segments(route):
    if not isinstance(route, dict) or route.get('type') not in ('LineString', 'MultiLineString'):
        raise ValueError('Route must be a GeoJSON LineString or MultiLineString.')
    lines = [route.get('coordinates')] if route['type'] == 'LineString' else route.get('coordinates')
    if not isinstance(lines, list) or not lines:
        raise ValueError('Route contains no lines.')
    segments = []
    for line in lines:
        if not isinstance(line, list) or len(line) < 2:
            raise ValueError('Each route line needs at least two vertices.')
        points = [vector(point) for point in line]
        for a, b in zip(points, points[1:]):
            if dot(a, b) < -1 + EPS:
                raise ValueError('Antipodal route vertices do not define a unique shortest arc.')
            segments.append((a, b))
    return segments


def route_distance(segments_a, segments_b):
    """Minimum spherical polyline distance; crossing means supplied geometries intersect."""
    best = float('inf')
    for a, b in segments_a:
        for c, d in segments_b:
            if arcs_intersect(a, b, c, d):
                return 0.0, True
            best = min(best, point_arc_angle(a, c, d), point_arc_angle(b, c, d),
                       point_arc_angle(c, a, b), point_arc_angle(d, a, b))
    return best * EARTH_RADIUS_KM, False
