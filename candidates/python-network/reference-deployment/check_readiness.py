#!/usr/bin/env python3
import json,os
from pathlib import Path
config=json.loads((Path(__file__).parent/'config.json').read_text())
missing=[name for name in config['required_secret_references'] if not os.environ.get(name)]
print(json.dumps({'designation':config['designation'],'interface_defined':True,'implemented_local':True,'transport_connected':False if missing else 'not_verified','destination_connected':False,'reconciliation_connected':False,'production_authorized':False,'blocked':bool(missing),'blockers':[f'missing secret reference: {name}' for name in missing]},indent=2))
raise SystemExit(2 if missing else 0)
