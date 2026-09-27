import json
from pathlib import Path
from bson import json_util
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError
from coordination.engine import rank_projects
from coordination.repository import load_snapshot, save_results
from database.mongo import get_database, close_connection


class Command(BaseCommand):
    help = 'Rank spatial coordination candidates. Read-only unless --save is supplied.'

    def add_arguments(self, parser):
        parser.add_argument('--source-id')
        parser.add_argument('--save', action='store_true', help='Upsert ranked opportunities into MongoDB.')
        parser.add_argument('--include-inactive', action='store_true')
        parser.add_argument('--include-concepts', action='store_true')
        parser.add_argument('--output', type=Path, help='Optional JSON report including evidence and unresolved locations.')

    def handle(self, *args, **options):
        try:
            db = get_database()
            source_id, projects, substations = load_snapshot(db, options['source_id'])
            result = rank_projects(projects, substations, include_inactive=options['include_inactive'],
                                   include_concepts=options['include_concepts'])
            result['source_id'] = source_id
            if options['save']:
                result['storage'] = save_results(db, source_id, result)
            if options['output']:
                options['output'].write_text(json_util.dumps(result, indent=2), encoding='utf-8')
            summary = result['summary']
            self.stdout.write(json.dumps({key: value for key, value in summary.items()
                                         if key not in ('skipped_records', 'location_issues')}, indent=2))
            self.stdout.write(f"Skipped records: {len(summary['skipped_records'])}; unresolved/invalid location entries: {len(summary['location_issues'])}")
            for row in result['opportunities'][:10]:
                self.stdout.write(f"{row['rank']}. {' / '.join(row['record_ids'])}: {row['distance_km']:.4f} km | {row['band']} | {row['distance_basis']}")
            self.stdout.write(self.style.SUCCESS('Results saved.' if options['save'] else 'Preview only. Use --save to store results.'))
        except (ValueError, ImproperlyConfigured, OSError) as exc:
            raise CommandError(str(exc)) from None
        except PyMongoError:
            raise CommandError('MongoDB request failed. Check connectivity and retry. A save may be partial; rerunning repairs it. Run only one ranking job at a time.') from None
        finally:
            close_connection()
