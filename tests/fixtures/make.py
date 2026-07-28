import sys

def make(path, label, npages):
    objs = {}
    page_ids = [4 + 2 * i for i in range(npages)]
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    objs[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, npages)
    objs[3] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, pid in enumerate(page_ids):
        cid = pid + 1
        text = ("%s - page %d of %d" % (label, i + 1, npages)).encode()
        stream = (b"BT /F1 28 Tf 60 700 Td (" + text + b") Tj ET\n"
                  b"1 0 0 RG 4 w 40 40 m 555 40 l S\n")
        objs[pid] = (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                     b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % cid)
        objs[cid] = b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objs):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + objs[num] + b"\nendobj\n"
    xref = len(out)
    n = max(objs) + 1
    out += b"xref\n0 %d\n" % n
    out += b"0000000000 65535 f \n"
    for num in range(1, n):
        out += b"%010d 00000 n \n" % offsets.get(num, 0)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (n, xref)
    open(path, "wb").write(out)
    print("wrote", path, len(out), "bytes,", npages, "pages")

make(sys.argv[1], sys.argv[2], int(sys.argv[3]))
