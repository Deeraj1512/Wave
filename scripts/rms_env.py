import re, collections

pairs = []
t = None
for line in open('/tmp/vframes/rms.txt'):
    fm = re.search(r'pts_time:([\d.]+)', line)
    if fm:
        t = float(fm.group(1))
        continue
    vm = re.search(r'RMS_level=(-?[\d.]+|-inf)', line)
    if vm and t is not None:
        v = vm.group(1)
        pairs.append((t, float(v) if v != '-inf' else -90.0))

sec = collections.defaultdict(list)
for tt, v in pairs:
    sec[int(tt)].append(v)

print('time  RMS(dB)   louder=more #')
for s in sorted(sec):
    avg = sum(sec[s]) / len(sec[s])
    bar = '#' * max(0, int((avg + 60) / 1.5))
    print(f'{s:3d}s {avg:7.1f}  {bar}')
