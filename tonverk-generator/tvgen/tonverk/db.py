"""RocksDB access for Tonverk project folders.

A Tonverk project is a RocksDB database folder (CURRENT, MANIFEST-*, *.sst, OPTIONS-*).
Keys are text paths (`/project/data/...`), values raw little-endian bytes.

Writes use the table options of the firmware (RocksDB 8.1.1 on the machine):
format_version=5, kXXH3 checksums, Snappy, bytewise comparator, no filter policy,
4 KiB blocks. RocksDB keeps reading and writing that table format across versions;
after writing we compact into a single table and put back the template's original
OPTIONS file, exactly like a project saved by the machine.
"""
from __future__ import annotations

import os
import shutil
import tempfile

try:
    import rocksdict as _rd
except ImportError:  # pragma: no cover - reported to the user by require()
    _rd = None

KV = dict[str, bytes]

# files never copied from a template folder
_SKIP = {"LOCK", ".DS_Store", "rocksdict-config.json", "tvgen-layout.json"}


def require():
    if _rd is None:
        raise RuntimeError("manca il pacchetto 'rocksdict': pip install rocksdict")


def is_project_dir(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "CURRENT")) and any(
        f.startswith("MANIFEST-") for f in os.listdir(path))


def _options(create: bool = False):
    o = _rd.Options(raw_mode=True)
    o.create_if_missing(create)
    o.set_compression_type(_rd.DBCompressionType.snappy())
    b = _rd.BlockBasedOptions()
    b.set_format_version(5)
    b.set_checksum_type(_rd.ChecksumType.xxh3())
    b.set_block_size(4096)
    b.set_metadata_block_size(4096)
    b.set_block_restart_interval(16)
    b.set_index_block_restart_interval(1)
    o.set_block_based_table_factory(b)
    return o


def read(path: str) -> KV:
    """All key/values of a project folder.

    The folder is never touched: even a read-only open lets RocksDB write log files
    next to the database, so we read from a temporary copy.
    """
    require()
    if not is_project_dir(path):
        raise FileNotFoundError(f"{path} non è una cartella di progetto Tonverk (manca CURRENT/MANIFEST)")
    tmp = tempfile.mkdtemp(prefix="tvgen-read-")
    copy = os.path.join(tmp, "db")
    try:
        shutil.copytree(path, copy, ignore=_ignore)
        db = _rd.Rdict(copy, options=_rd.Options(raw_mode=True),
                       access_type=_rd.AccessType.read_only())
        try:
            return {k.decode("utf-8", "surrogateescape"): bytes(v) for k, v in db.items()}
        finally:
            db.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _cleanup(path: str, keep: set[str] | None):
    p = os.path.join(path, "rocksdict-config.json")
    if os.path.exists(p) and (keep is None or "rocksdict-config.json" not in keep):
        os.remove(p)


def _ignore(_dir, names):
    return [n for n in names if n in _SKIP or n.startswith("._")]


def write_project(template_dir: str, out_dir: str, final: KV) -> dict:
    """Copy the template folder to out_dir and make its content exactly `final`."""
    require()
    if os.path.exists(out_dir):
        raise FileExistsError(f"{out_dir} esiste già")
    shutil.copytree(template_dir, out_dir, ignore=_ignore)
    tmpl_options = sorted(f for f in os.listdir(template_dir) if f.startswith("OPTIONS-"))
    options_text = None
    if tmpl_options:
        with open(os.path.join(template_dir, tmpl_options[-1]), "rb") as f:
            options_text = f.read()

    db = _rd.Rdict(out_dir, options=_options(create=False))
    puts = dels = 0
    try:
        current = {k.decode("utf-8", "surrogateescape"): bytes(v) for k, v in db.items()}
        wb = _rd.WriteBatch(raw_mode=True)
        for k in current:
            if k not in final:
                wb.delete(k.encode("utf-8", "surrogateescape"))
                dels += 1
        for k, v in final.items():
            if current.get(k) != v:
                wb.put(k.encode("utf-8", "surrogateescape"), v)
                puts += 1
        db.write(wb)
        db.flush()
        db.compact_range(None, None)
    finally:
        db.close()
    _cleanup(out_dir, keep=None)

    # read back and compare byte for byte
    after = read(out_dir)
    if after != final:
        missing = [k for k in final if after.get(k) != final[k]][:5]
        extra = [k for k in after if k not in final][:5]
        raise RuntimeError(f"verifica fallita: diverse={missing} extra={extra}")

    if options_text is not None:
        for f in os.listdir(out_dir):
            if f.startswith("OPTIONS-"):
                with open(os.path.join(out_dir, f), "wb") as fh:
                    fh.write(options_text)
    for f in os.listdir(out_dir):
        if f.startswith("LOG.old."):
            os.remove(os.path.join(out_dir, f))
    return {"keys": len(final), "written": puts, "deleted": dels}


def create_project(out_dir: str, kv: KV):
    """Create a brand new project database (used for synthetic test fixtures)."""
    require()
    if os.path.exists(out_dir):
        raise FileExistsError(out_dir)
    db = _rd.Rdict(out_dir, options=_options(create=True))
    try:
        wb = _rd.WriteBatch(raw_mode=True)
        for k, v in kv.items():
            wb.put(k.encode("utf-8"), v)
        db.write(wb)
        db.flush()
        db.compact_range(None, None)
    finally:
        db.close()
    _cleanup(out_dir, keep=None)
