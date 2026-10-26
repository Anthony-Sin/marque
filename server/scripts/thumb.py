#!/usr/bin/env python3
# thumb.py — resize one image to a max width for the /assets/thumb route.
# usage: thumb.py <src> <dst-prefix> <max-width>
# Picks the container: JPEG for opaque art, PNG when the source has alpha
# (JPEG would flatten transparency onto black and wreck transparent assets).
# Never upscales — sources narrower than <max-width> are re-encoded at native
# size. Prints the file it wrote on stdout.
import os
import sys
import tempfile
from PIL import Image

def main():
    src, dst_prefix, w = sys.argv[1], sys.argv[2], int(sys.argv[3])
    im = Image.open(src)
    im.load()
    if im.width > w:
        h = max(1, round(im.height * w / im.width))
        im = im.resize((w, h), Image.LANCZOS)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    if has_alpha:
        out = dst_prefix + '.png'
        im = im.convert('RGBA')
        fmt, kw = 'PNG', {'optimize': True}
    else:
        out = dst_prefix + '.jpg'
        im = im.convert('RGB')
        fmt, kw = 'JPEG', {'quality': 82, 'optimize': True, 'progressive': True}
    # write-then-rename in the same dir — concurrent requests can race the cache
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(out), suffix='.tmp')
    os.close(fd)
    try:
        im.save(tmp, fmt, **kw)
        os.replace(tmp, out)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    print(out)

if __name__ == '__main__':
    main()
