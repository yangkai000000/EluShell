"""Python 3.6+ unified release gate: Windows, both Mac architectures and guide.

Versioned assets are immutable. Uploads are validated before public pointers move.
A failed pointer switch restores the preceding landing page and Windows feed.
"""
import argparse, base64, hashlib, json, os, re, shutil, time
from pathlib import Path
POINTERS=('index.html','windows/x64/latest.yml')

def digest(file, algorithm='sha256'):
    h=hashlib.new(algorithm)
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def within(root,relative):
    assert not Path(relative).is_absolute() and '..' not in Path(relative).parts,'Unsafe relative path'
    result=(root/relative).resolve()
    assert root in result.parents,'Path outside release directory'
    return result

def preflight(stage,mac,site):
    m=json.loads((stage/'manifest.json').read_text(encoding='utf8'));v=m['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+',v),'Invalid version'
    assert re.fullmatch(r'\d+\.\d+\.\d+',m['guideVersion']),'Invalid guide version'
    assert m['guideVersion']==v or m.get('guideUnchanged') is True,'Guide reuse must be explicit'
    files=m['files'];paths={f['path'] for f in files}
    assert len(paths)==len(files),'Duplicate release path'
    required=set(POINTERS)|{
        'windows/x64/EluShell-Setup-'+v+'-x64.exe',
        'macos/arm64/EluShell-'+v+'-macos-arm64-preview.zip',
        'macos/x64/EluShell-'+v+'-macos-x64-preview.zip',
        'guide/'+m['guideVersion']+'/index.html','guide/'+m['guideVersion']+'/EluShell-Guide-'+m['guideVersion']+'.docx',
        'guide/'+m['guideVersion']+'/EluShell-Guide-'+m['guideVersion']+'.pdf'}
    assert required<=paths,'Incomplete platforms or guide'
    assert {r['arch'] for r in m['macReports']}=={'arm64','x64'},'Both Mac architectures required'
    for r in m['macReports']:
        assert r['version']==v,'Mac version mismatch'
        assert r['archiveIntegrity']=='PASS' and r['offlineSignatureIntegrity']['resourceAndNestedSeals']=='PASS','Unverified Mac package'
        item=next(f for f in files if f['path']=='macos/'+r['arch']+'/'+r['file'])
        assert item['sha256']==r['sha256'] and item['size']==r['size'],'Mac report checksum mismatch'
    for entry in files:
        assert entry['kind'] in ('stage','mac')
        source=within(mac if entry['kind']=='mac' else stage,entry['source'])
        target=within(site,entry['path'])
        assert source.is_file(),'Missing artifact: '+entry['path']
        assert source.stat().st_size==entry['size'] and digest(source)==entry['sha256'],'Artifact integrity failed: '+entry['path']
        if m.get('guideUnchanged') and entry['path'].startswith('guide/'):
            assert target.is_file(),'Retained guide must already be published'
        if target.exists() and entry['path'] not in POINTERS:
            assert digest(target)==entry['sha256'],'Refusing to overwrite published version: '+entry['path']
    feed=json.loads((stage/'site/windows/x64/latest.yml').read_text(encoding='utf8'))
    assert feed['version']==v
    installer=stage/'site/windows/x64'/feed['path']
    assert installer.name=='EluShell-Setup-'+v+'-x64.exe'
    assert base64.b64encode(bytes.fromhex(digest(installer,'sha512'))).decode()==feed['sha512']
    assert feed['files'][0]['size']==installer.stat().st_size
    for name in ['index.html','guide/'+m['guideVersion']+'/index.html']:
        page=(stage/'site'/name).read_text(encoding='utf8')
        assert 'name="elushell-version" content="'+(m['guideVersion'] if name.startswith('guide/') else v)+'"' in page
        assert '联系开发人员反馈：杨凯' in page
    archive=stage/('site/releases/downloads-'+v+'.json')
    if archive.exists():
        for entry in json.loads(archive.read_text(encoding='utf8'))['files']:
            if entry['path'] in paths: continue
            previous=within(site,entry['path'])
            assert previous.is_file() and previous.stat().st_size==entry['size'] and digest(previous)==entry['sha256'],'Missing or changed historical package: '+entry['path']
    return m

def atomic_copy(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+'.publishing-'+str(os.getpid()))
    shutil.copyfile(str(source),str(temporary))
    with temporary.open('rb') as stream:os.fsync(stream.fileno())
    os.replace(str(temporary),str(target))

def publish(stage,mac,site,check_only=False):
    stage,mac,site=stage.resolve(),mac.resolve(),site.resolve()
    assert site.is_dir(),'Specify existing dedicated EluShell site directory'
    m=preflight(stage,mac,site)
    if check_only:return {'result':'PREFLIGHT PASS','version':m['version'],'files':len(m['files'])}
    lock=site.parent/('.'+site.name+'.publish-lock');lock.mkdir()
    changed=[];backups={}
    try:
        preflight(stage,mac,site)
        backup=stage/('previous-pointers-'+str(int(time.time()*1000000)));backup.mkdir()
        for relative in POINTERS:
            target=within(site,relative)
            if target.exists():
                saved=within(backup,relative);saved.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(str(target),str(saved));backups[relative]=saved
            else:backups[relative]=None
        for entry in m['files']:
            if entry['path'] in POINTERS:continue
            source=within(mac if entry['kind']=='mac' else stage,entry['source']);target=within(site,entry['path'])
            if not target.exists():atomic_copy(source,target)
            assert digest(target)==entry['sha256'],'Public artifact checksum mismatch'
        public={'version':m['version'],'guideVersion':m['guideVersion'],'notes':m['notes'],'files':[{k:f[k] for k in ('path','size','sha256')} for f in m['files']]}
        record=stage/'public-manifest.json';record.write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
        public_target=within(site,'releases/'+m['version']+'.json')
        if public_target.exists():assert digest(public_target)==digest(record),'Published manifest is immutable'
        else:atomic_copy(record,public_target)
        for relative in POINTERS:
            atomic_copy(within(stage,'site/'+relative),within(site,relative));changed.append(relative)
        return {'result':'PUBLISHED','version':m['version'],'files':len(m['files']),'backup':str(backup)}
    except BaseException:
        for relative in reversed(changed):
            if backups[relative]:atomic_copy(backups[relative],within(site,relative))
            else:within(site,relative).unlink()
        raise
    finally:lock.rmdir()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--mac-build',type=Path,required=True)
    parser.add_argument('--site',type=Path,required=True)
    parser.add_argument('--check-only',action='store_true')
    args=parser.parse_args()
    print(json.dumps(publish(args.stage,args.mac_build,args.site,args.check_only),ensure_ascii=False))
