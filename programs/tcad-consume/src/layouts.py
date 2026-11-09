"""Bounded, nonexecuting OOXML layout reader. Reads a workbook on stdin."""
import io,json,re,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(1048577)))
infos=z.infolist()
if len(infos)>256 or sum(i.file_size for i in infos)>32*1024**2: raise ValueError('workbook expansion cap')
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
strings=[''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
rels={r.attrib['Id']:r.attrib['Target'] for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
result=[]
for sheet in E.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns):
 target=rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
 path=target.lstrip('/') if target.startswith('/') else 'xl/'+target
 if '..' in path.split('/'): raise ValueError('unsafe workbook relationship')
 rows=[]
 for row in E.fromstring(z.read(path)).findall('.//m:row',ns):
  cells={}
  for c in row:
   v=c.find('m:v',ns); value=v.text if v is not None else ''
   if c.attrib.get('t')=='s' and value: value=strings[int(value)]
   elif c.attrib.get('t')=='inlineStr': value=''.join(c.find('m:is',ns).itertext())
   cells[re.sub(r'\d','',c.attrib['r'])]=value or ''
  rows.append(cells)
 text='\n'.join(r.get('A','') for r in rows)
 member=re.search(r'Short file name\s*\(([^)]+)\)',text,re.I)
 fields=[]
 tab='tab delimited' in text.lower()
 for r in rows:
  if not r.get('A') or not re.match(r'^(int|numeric|char|varchar|datetime|date|decimal|bit|text|json|filler)',r.get('B',''),re.I): continue
  if tab: fields.append({'name':r['A'],'kind':r['B'],'start':0,'end':0,'length':0})
  elif all(r.get(k,'').isdigit() for k in ['C','D','E']): fields.append({'name':r['A'],'kind':r['B'],'start':int(r['C']),'end':int(r['D']),'length':int(r['E'])})
 if member and fields:
  result.append({'member':member.group(1),'sheet':sheet.attrib['name'],'format':'tab' if tab else 'fixed','fields':fields,'width':fields[-1]['end']})
print(json.dumps(result))
