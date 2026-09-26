"""Bounded, read-only XLSX extraction. Never executes formulas or external links."""
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 10 * 1024 * 1024
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def read_workbook(content):
    if not content or len(content) > MAX_FILE_BYTES:
        raise ValueError('Choose an .xlsx file smaller than 10 MB.')
    try:
        with ZipFile(BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 60 * 1024 * 1024:
                raise ValueError('The expanded workbook is too large (60 MB maximum).')
            def xml(path):
                data = archive.read(path)
                if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                    raise ValueError('XML entities are not supported.')
                return ET.fromstring(data)
            strings = []
            if 'xl/sharedStrings.xml' in archive.namelist():
                strings = [''.join(t.text or '' for t in node.findall('.//s:t', NS))
                           for node in xml('xl/sharedStrings.xml').findall('s:si', NS)]
            workbook = xml('xl/workbook.xml')
            props = workbook.find('s:workbookPr', NS)
            date1904 = props is not None and props.get('date1904') in ('1', 'true')
            relations = {r.get('Id'): r.get('Target') for r in xml('xl/_rels/workbook.xml.rels')
                         if r.get('TargetMode') != 'External'}
            sheets = []
            total_rows = 0
            for sheet in workbook.findall('s:sheets/s:sheet', NS):
                target = relations.get(sheet.get(f'{{{REL}}}id'), '')
                path = target.lstrip('/') if target.startswith('/') else str(PurePosixPath('xl') / target)
                if '..' in PurePosixPath(path).parts or not path.startswith('xl/worksheets/'):
                    raise ValueError('Unsupported worksheet reference.')
                rows = []
                formulas = 0
                for row in xml(path).findall('s:sheetData/s:row', NS):
                    cells = {}
                    for cell in row.findall('s:c', NS):
                        column = ''.join(c for c in cell.get('r', '') if c.isalpha())
                        if not column or len(column) > 2:
                            raise ValueError('Workbook exceeds the supported column range.')
                        value = cell.find('s:v', NS)
                        text = value.text if value is not None and value.text is not None else ''
                        kind = cell.get('t')
                        if kind == 's' and text:
                            text = strings[int(text)]
                        elif kind == 'inlineStr':
                            text = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                        if cell.find('s:f', NS) is not None:
                            formulas += 1
                        if text.strip():
                            cells[column] = text.strip()
                    if cells:
                        rows.append((int(row.get('r')), cells))
                        total_rows += 1
                        if total_rows > 12000:
                            raise ValueError('Workbook exceeds 12,000 populated rows.')
                sheets.append({'name': sheet.get('name'), 'rows': rows, 'formulas': formulas})
            return sheets, date1904
    except (BadZipFile, KeyError, IndexError, ET.ParseError, TypeError) as exc:
        raise ValueError('This file is not a readable .xlsx workbook.') from exc
