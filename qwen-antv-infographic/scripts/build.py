"""Validate Qwen's parts/links content, auto-lay it out as an AntV dagre flow, and fail loudly with fix hints."""
import json, os, pathlib, re, shutil, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SKILL = HERE.parent
NODE_MODULES = SKILL / 'node_modules'
PALETTE = ['#0D9488', '#D97706', '#2563EB', '#DC2626', '#7C3AED']
PHONE_W, MIN_PHONE_TEXT = 390, 8.0  # smallest text, in px, when the PNG is shown 390 px wide
# One source of truth for card size and fonts: page.js draws with these, and the char limits below derive from them.
# Narrow, tall cards: the sheet width (= phone text size) is set by how many cards sit side by side, not by card height.
CARD = {'width': 180, 'pad': 10, 'lh': 1.3, 'labelFs': 20, 'descFs': 18, 'linkFs': 17, 'labelLines': 3, 'descLines': 5,
        'takeawayFs': 20, 'legendFs': 17}
_TEXT_W = CARD['width'] - 2 * CARD['pad'] - 5
_fit = lambda lines, fs, em: int(lines * _TEXT_W / (fs * em) * 0.85)  # chars that reliably word-wrap into `lines`
LIMITS = {'title': 50, 'subtitle': 100, 'takeaway': 140, 'label': _fit(CARD['labelLines'], CARD['labelFs'], 0.6),
          'detail': _fit(CARD['descLines'], CARD['descFs'], 0.53), 'link': 18}
# Layout variants the script tries itself (orientation, spacing); it keeps the cleanest, most phone-readable one.
VARIANTS = {'tb': ('TB', 28, 56), 'tb-wide': ('TB', 56, 80), 'lr': ('LR', 28, 64), 'lr-wide': ('LR', 56, 96)}


def check_content(d):
    errs = []
    for key in ('title', 'subtitle', 'takeaway'):
        v = d.get(key)
        if not isinstance(v, str) or not v.strip():
            errs.append(f'`{key}` missing: restore it from templates/content.json.')
        elif len(v) > LIMITS[key]:
            errs.append(f'`{key}` is {len(v)} chars: reword it to <= {LIMITS[key]}.')
    parts, links = d.get('parts'), d.get('links')
    if not isinstance(parts, list) or not 5 <= len(parts) <= 12:
        return errs + ['`parts` must list 5-12 parts.'], []
    if not isinstance(links, list) or not links:
        return errs + ['`links` missing: connect the parts with from/to links.'], []
    ids, labels = {}, set()
    for i, p in enumerate(parts):
        pid = p.get('id', '')
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,23}', str(pid)) or pid in ids:
            errs.append(f'part #{i + 1} id {pid!r}: use a unique short lowercase id like "pump".')
        for key, limit in (('label', LIMITS['label']), ('detail', LIMITS['detail']), ('group', 24)):
            v = p.get(key)
            if not isinstance(v, str) or not v.strip():
                errs.append(f'part {pid!r} `{key}` missing.')
            elif len(v) > limit:
                errs.append(f'part {pid!r} `{key}` is {len(v)} chars: reword it to <= {limit} (short words); keep the part.')
        label, detail = str(p.get('label', '')).strip().lower(), str(p.get('detail', '')).lower()
        if label and label in labels:
            errs.append(f'part {pid!r} repeats label {p["label"]!r}: each part must be a different thing.')
        if label and label in detail:
            errs.append(f'part {pid!r} detail restates its label: say what this part does or decides.')
        labels.add(label)
        ids[pid] = p
    groups = list(dict.fromkeys(p.get('group') for p in parts if p.get('group')))
    if not 2 <= len(groups) <= 5:
        errs.append(f'{len(groups)} groups: use 2-5 group names (subsystems, roles, phases) shared by several parts.')
    out_deg, in_deg, seen = {k: 0 for k in ids}, {k: 0 for k in ids}, set()
    for l in links:
        a, b, lab = l.get('from'), l.get('to'), l.get('label', '')
        if a not in ids or b not in ids or a == b:
            errs.append(f'link {a!r}->{b!r}: from/to must be two different part ids.')
            continue
        if (a, b) in seen:
            errs.append(f'link {a!r}->{b!r} is duplicated.')
        seen.add((a, b))
        if not isinstance(lab, str) or len(lab) > LIMITS['link']:
            errs.append(f'link {a!r}->{b!r} label: use <= {LIMITS["link"]} chars (a verb like "pressurizes").')
        out_deg[a] += 1
        in_deg[b] += 1
    lonely = [k for k in ids if out_deg[k] + in_deg[k] == 0]
    if lonely:
        errs.append(f'parts {lonely} have no link: link each to the part it feeds, controls or depends on.')
    if not errs and max(out_deg.values()) <= 1 and max(in_deg.values()) <= 1 and len(seen) == len(ids) - 1:
        errs.append('parts form one straight chain: add the real branch, feedback loop, or shared input '
                    '(a part linking to 2+ parts, 2+ parts feeding one, or a link back to an earlier part).')
    return errs, groups


def build_spec(d, groups):
    color = {g: PALETTE[i] for i, g in enumerate(groups)}
    data = {'title': d['title'], 'desc': d['subtitle'],
            'items': [{'id': p['id'], 'label': p['label'], 'desc': p['detail'], 'group': p['group']} for p in d['parts']],
            'relations': [{'from': l['from'], 'to': l['to'], **({'label': l['label']} if l.get('label') else {})} for l in d['links']]}
    options = {}
    label_w = max([len(l.get('label') or '') for l in d['links']]) * CARD['linkFs'] * 0.55 + 30  # left-right: labels sit between ranks
    for key, (rankdir, nodesep, ranksep) in VARIANTS.items():
        structure = {'type': 'relation-dagre-flow', 'rankdir': rankdir, 'edgeRouting': 'orth', 'edgeColorMode': 'gradient',
                     'showArrow': True, 'arrowType': 'triangle', 'colorMode': 'node', 'nodesep': nodesep,
                     'ranksep': max(ranksep, label_w + ranksep - 64) if rankdir == 'LR' else ranksep}
        options[key] = {'design': {'title': 'default', 'structure': structure, 'item': {'type': 'qwen-card'}},
                        'data': data, 'themeConfig': {'palette': PALETTE}}
    return {'options': options, 'card': CARD, 'takeaway': d['takeaway'],
            'links': [{'from': l['from'], 'to': l['to']} for l in d['links']],
            'groups': [{'name': g, 'color': color[g]} for g in groups]}


def phone_px(m):
    return m['minFont'] * PHONE_W / m['width']


def layout_errors(m, d):
    """One-line fix hints. Every hint rewords text; none asks to merge or drop a part, a link or a link label."""
    part = lambda idx: d['parts'][int(str(idx).split(',')[0])]['id'] if idx not in (None, '') else None
    errs = []
    for o in m['overflow']:
        pid = part(o.get('indexes'))
        kind = 'label' if 'label' in o['type'] else 'detail'
        where = f'part {pid!r} {kind}' if pid else repr(o['text'][:30])
        errs.append(f'{where} does not fit its box: reword it shorter (label <= {LIMITS["label"]} chars, detail <= '
                    f'{LIMITS["detail"]} chars, short words); keep the part.')
    seen = set()
    for c in m['collisions']:
        if (c['text'], c['other']) in seen or len(seen) >= 6:
            continue
        seen.add((c['text'], c['other']))
        if c['link']:
            errs.append(f'link label {c["text"]!r} on {c["link"]} overlaps {c["other"]}: reword that label in 1-3 shorter '
                        'words; keep the link and its label.')
        else:
            errs.append(f'{c["text"][:30]!r} overlaps {c["other"]}: reword the longer text shorter.')
    if phone_px(m) < MIN_PHONE_TEXT and m['titleSetsWidth']:
        errs.append(f'the title/subtitle line is wider than the diagram and shrinks all text on a phone '
                    f'({phone_px(m):.1f}px at {PHONE_W}px wide, need {MIN_PHONE_TEXT}): reword the subtitle shorter.')
    return errs


def main():
    src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
    d = json.loads(src.read_text())
    errs, groups = check_content(d)
    if errs:
        return fail(errs)
    out.mkdir(parents=True, exist_ok=True)
    if src.resolve() != out / 'content.json':
        shutil.copy(src, out / 'content.json')  # the content always lives next to the picture it made
    rt = out / 'qwen-runtime'
    shutil.rmtree(rt, ignore_errors=True)
    (rt / 'src').mkdir(parents=True)
    (rt / 'node_modules').symlink_to(NODE_MODULES, target_is_directory=True)
    spec = build_spec(d, groups)
    (rt / 'src/spec.json').write_text(json.dumps(spec))
    shutil.copy(HERE / 'page.js', rt / 'src/page.js')
    shutil.copy(HERE / 'render.mjs', rt / 'render.mjs')  # bare imports resolve via rt/node_modules
    (rt / 'index.html').write_text('<!doctype html><html><body style="margin:0;background:#fff">'
                                   '<script type="module" src="/src/page.js"></script></body></html>')
    env = {k: v for k, v in os.environ.items() if k not in ('DISPLAY', 'WAYLAND_DISPLAY')}
    run = subprocess.run(['node', str(rt / 'render.mjs'), str(rt)], cwd=SKILL, env=env, capture_output=True, text=True)
    if run.returncode:
        return fail([f'renderer failed: {(run.stderr or run.stdout).strip()[-4000:]}'])
    metrics = json.loads(run.stdout.strip().splitlines()[-1])
    # Prefer the variant with the fewest collisions, then the largest phone text (tall sheets count a bit smaller).
    score = lambda k: (len(metrics[k]['collisions']), -phone_px(metrics[k]) * min(1, 1.9 * metrics[k]['width'] / metrics[k]['height']))
    key = min(metrics, key=score)
    m = metrics[key]
    shutil.copy(rt / f'sheet-{key}.png', out / 'infographic.png')
    shutil.copy(rt / f'sheet-{key}.svg', out / 'infographic.svg')
    (out / 'render-spec.json').write_text(json.dumps(spec['options'][key], indent=1))
    shutil.rmtree(rt)
    errs = layout_errors(m, d)
    if errs:
        return fail(errs, png=str(out / 'infographic.png'))
    raw = (out / 'infographic.png').read_bytes()
    print(json.dumps({'ok': True, 'png': str(out / 'infographic.png'), 'svg': str(out / 'infographic.svg'),
                      'width': int.from_bytes(raw[16:20], 'big'), 'height': int.from_bytes(raw[20:24], 'big'),
                      'layout': key, 'parts': len(d['parts']), 'links': len(d['links']), 'groups': groups,
                      'phone_min_text_px': round(phone_px(m), 1),
                      'next': 'open the PNG; check every fact and arrow direction against the topic; fix content and rerun if wrong'}))


def fail(errs, **extra):
    print(json.dumps({'ok': False, 'errors': errs, **extra}))
    sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # malformed JSON or missing renderer: report, never crash silently
        fail([f'{type(e).__name__}: {e}'])
