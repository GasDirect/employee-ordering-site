#!/usr/bin/env python3
import json, os, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'products.json')

with open(DATA, encoding='utf-8') as f:
    data = json.load(f)
products = data['products']

errors=[]
ids=[p.get('id') for p in products]
for pid,count in Counter(ids).items():
    if count != 1: errors.append(f'duplicate id: {pid}')

required=['retailer','category','brand','productName','packCount','priceDisplay','active','displayOrder']
for p in products:
    for key in required:
        if key not in p: errors.append(f"{p.get('id')}: missing {key}")
    if p.get('image') and not str(p['image']).startswith(('https://','http://')):
        path=os.path.join(ROOT,p['image'])
        if not os.path.isfile(path): errors.append(f"{p['id']}: missing image {p['image']}")

sig=Counter((p['retailer'],p['productName'],p.get('packCount',''),p.get('individualSize',''),p.get('variety','')) for p in products)
for key,count in sig.items():
    if count>1: errors.append(f'duplicate product signature x{count}: {key}')

print(f"Products: {len(products)}")
print('By retailer:', dict(Counter(p['retailer'] for p in products)))
print('By category:', dict(Counter(p['category'] for p in products)))
print('Photos:', sum(bool(p.get('image')) for p in products), 'Missing photos:', sum(not bool(p.get('image')) for p in products))
if errors:
    print('\nERRORS:')
    for e in errors: print('-',e)
    sys.exit(1)
print('Catalog validation: PASS')
