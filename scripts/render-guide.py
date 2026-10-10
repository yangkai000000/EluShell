"""Render with the isolated LibreOffice runtime and document skill rasterizer.

An explicitly requested, fresh Word export can be used as a fallback.
No renderer package or managed skill files are modified.
"""
import importlib.util
from pathlib import Path
from pypdf import PdfReader
import json
import os
import shutil
import sys
root = Path(__file__).resolve().parents[1]
skill = Path('C:/Users/86185/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents/render_docx.py')
spec = importlib.util.spec_from_file_location('docx_renderer', skill)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
version = json.loads((root/'package.json').read_text(encoding='utf8'))['version']
pdf = root / 'artifacts/guide/rendered/guide.pdf'
document = root/f'artifacts/guide/EluShell操作指南-{version}.docx'
local_runtime = root/'test-results/document-runtime/libreoffice/program'
if (local_runtime/'soffice.exe').exists():
    os.environ['PATH'] = str(local_runtime) + os.pathsep + os.environ['PATH']
if shutil.which('soffice.exe') or shutil.which('soffice'):
    pages = renderer.rasterize(str(document), str(pdf.parent), 144, False, True)
    shutil.copyfile(pdf.parent/(document.stem+'.pdf'), pdf)
    method = 'LibreOffice 26.2.6 and document skill render_docx.py'
else:
    assert '--from-word' in sys.argv and pdf.exists() and pdf.stat().st_mtime >= document.stat().st_mtime, 'Render in Word first, then pass --from-word; stale PDFs are rejected'
    renderer.convert_to_pdf = lambda *args, **kwargs: (str(pdf), 'Rendered by installed Microsoft Word')
    pages = renderer.rasterize(str(document), str(pdf.parent), 144, False, False)
    method = 'Microsoft Word and document skill rasterizer'
(pdf.parent/'renderer.json').write_text(json.dumps({'method':method,'version':version}),encoding='utf8')
summary = [{'page': i+1, 'text': p.extract_text()} for i,p in enumerate(PdfReader(pdf).pages)]
(pdf.parent/'page-text.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
print('Rendered',len(pages),'pages using the document skill rasterizer')
for p in summary: print(p['page'], p['text'].replace('\n',' ')[:130])
