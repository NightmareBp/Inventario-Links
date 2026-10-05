#!/usr/bin/env python3
"""Compara los archivos del servidor con la versión base y la entrega. No modifica nada."""
from pathlib import Path
import hashlib,json,sys
if len(sys.argv)!=2:
    raise SystemExit('Uso: python3 scripts/verificar_base.py /ruta/del/proyecto')
package=Path(__file__).resolve().parent.parent
target=Path(sys.argv[1]).resolve()
manifest=json.loads((package/'MANIFIESTO.json').read_text())
if not (target/'package.json').is_file(): raise SystemExit('La ruta no contiene package.json. No se realizó ningún cambio.')
issues=[]
for item in manifest['archivos']:
    if not item['ruta'].startswith(('src/','package')): continue
    path=target/item['ruta']
    if not path.exists():
        if item['sha256_original']: issues.append(item['ruta']+' (falta un archivo original)')
        continue
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if digest not in [item['sha256_original'],item['sha256_nuevo']]: issues.append(item['ruta']+' (tiene cambios distintos)')
if issues:
    print('REVISAR antes de reemplazar. Estos archivos difieren de la base y de la entrega:')
    for issue in issues: print(' - '+issue)
    raise SystemExit(1)
print('OK: los archivos coinciden con la base revisada o con esta entrega. No se modificó nada.')
