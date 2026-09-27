from datetime import datetime, timezone
from pathlib import Path
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from pymongo.errors import PyMongoError
from research.documents import (dominion_enrichment, georgia_enrichment, index_by_title, normalize_title,
                                parse_dominion, parse_georgia)
from database.mongo import get_database, close_connection

# Which document may describe which utility's projects.
FORMATS = {'dominion': (parse_dominion, dominion_enrichment, ('dominion',)),
           'georgia': (parse_georgia, georgia_enrichment, ('georgia power',))}


def pdf_pages(path):
    from pypdf import PdfReader
    return [page.extract_text() or '' for page in PdfReader(str(path)).pages]


class Command(BaseCommand):
    help = ('Fill construction window, cost, and scope from utility planning PDFs, with page citations. '
            'Matches projects by exact (punctuation-insensitive) title and owner. Never overwrites filled fields.')

    def add_arguments(self, parser):
        parser.add_argument('--source-id', required=True)
        parser.add_argument('--dominion', type=Path, help='DESC "$2M and above" project descriptions PDF')
        parser.add_argument('--georgia', type=Path, help='Georgia Power IRP Ten-Year Plan (public disclosure) PDF')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        try:
            db = get_database()
            projects = list(db.projects.find({'source_id': options['source_id']}, {'raw_data': 0}))
            if not projects:
                raise ValueError('No projects for that source ID.')
            matched = 0
            for name, (parse, enrich, owners) in FORMATS.items():
                path = options[name]
                if not path:
                    continue
                document = {'title': path.stem, 'filename': path.name}
                index = index_by_title(parse(pdf_pages(path), path.name))
                self.stdout.write(f'{path.name}: {len(index)} uniquely titled projects')
                for project in projects:
                    owner = (project.get('owner') or '').casefold()
                    entry = index.get(normalize_title(project.get('project_name')))
                    if not entry or not any(o in owner for o in owners):
                        continue
                    update, evidence = enrich(entry)
                    # Imported or reviewed values win; documents only fill what is empty.
                    update = {k: v for k, v in update.items() if project.get(k) in (None, '', {}, [])
                              or (k == 'construction' and not (project.get(k) or {}).get('start_date'))}
                    if not update:
                        continue
                    matched += 1
                    self.stdout.write(f"  {project['record_id']}: p.{entry['page']} -> {', '.join(sorted(update))}")
                    if not options['dry_run']:
                        now = datetime.now(timezone.utc)
                        db.projects.update_one({'_id': project['_id']}, {
                            '$set': update | {'updated_at': now},
                            '$push': {'document_evidence': {'$each': [e | {'extracted_at': now, 'document_title': document['title']}
                                                                      for e in evidence]}}})
            self.stdout.write(self.style.SUCCESS(f'{matched} projects enriched' + (' (dry run)' if options['dry_run'] else '')))
        except (ValueError, OSError, ImproperlyConfigured) as exc:
            raise CommandError(str(exc)) from None
        except PyMongoError:
            raise CommandError('MongoDB request failed. Rerunning is safe.') from None
        finally:
            close_connection()
