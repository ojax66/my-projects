import gzip, struct, io

def _r(fmt, f, le):
    fmt = ('<' if le else '>') + fmt
    n = struct.calcsize(fmt)
    return struct.unpack(fmt, f.read(n))[0]

def read_payload(t, f, le):
    if t == 1: return _r('b', f, le)
    if t == 2: return _r('h', f, le)
    if t == 3: return _r('i', f, le)
    if t == 4: return _r('q', f, le)
    if t == 5: return _r('f', f, le)
    if t == 6: return _r('d', f, le)
    if t == 7:
        n = _r('i', f, le); return list(f.read(n))
    if t == 8:
        n = _r('H', f, le); return f.read(n).decode('utf-8')
    if t == 9:
        et = _r('b', f, le); n = _r('i', f, le)
        return [read_payload(et, f, le) for _ in range(n)]
    if t == 10:
        d = {}
        while True:
            ct = _r('b', f, le)
            if ct == 0: return d
            nl = _r('H', f, le); name = f.read(nl).decode('utf-8')
            d[name] = read_payload(ct, f, le)
    if t == 11:
        n = _r('i', f, le); return [_r('i', f, le) for _ in range(n)]
    if t == 12:
        n = _r('i', f, le); return [_r('q', f, le) for _ in range(n)]
    raise ValueError(t)

def load_java(path):
    data = open(path, 'rb').read()
    try: data = gzip.decompress(data)
    except OSError: pass
    f = io.BytesIO(data)
    t = _r('b', f, False); nl = _r('H', f, False); f.read(nl)
    return read_payload(t, f, False)

# ---- Bedrock little-endian writer with explicit types ----
class T:
    def __init__(self, t, v): self.t, self.v = t, v
def Byte(v): return T(1, v)
def Short(v): return T(2, v)
def Int(v): return T(3, v)
def Long(v): return T(4, v)
def Float(v): return T(5, v)
def Str(v): return T(8, v)
def List_(et, items): return T(9, (et, items))
def Comp(d): return T(10, d)

def _w(fmt, v): return struct.pack('<' + fmt, v)

def write_payload(tag):
    t, v = tag.t, tag.v
    if t == 1: return _w('b', v)
    if t == 2: return _w('h', v)
    if t == 3: return _w('i', v)
    if t == 4: return _w('q', v)
    if t == 5: return _w('f', v)
    if t == 8:
        b = v.encode('utf-8'); return _w('H', len(b)) + b
    if t == 9:
        et, items = v
        out = _w('b', et) + _w('i', len(items))
        for it in items: out += write_payload(it)
        return out
    if t == 10:
        out = b''
        for k, sub in v.items():
            kb = k.encode('utf-8')
            out += _w('b', sub.t) + _w('H', len(kb)) + kb + write_payload(sub)
        return out + b'\x00'
    raise ValueError(t)

def dump_bedrock(root, path):
    with open(path, 'wb') as f:
        f.write(b'\x0a' + _w('H', 0) + write_payload(root))
