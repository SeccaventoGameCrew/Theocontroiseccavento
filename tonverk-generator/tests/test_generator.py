import json
import os
import struct
import sys
import types

import pytest

from tvgen import composer, theory
from tvgen.export.midi import write_midi
from tvgen.export.songverk import songverk_json
from tvgen.generate import build_output
from tvgen.layout import default_layout
from tvgen.spec import Song, song_json_schema
from tvgen.tonverk import codec, db, fixture, inspect, project
from tvgen.tonverk import schema as s

B = s.BASE
LAYOUT = default_layout()


# ------------------------------------------------------------------ theory / spec
def test_parse_note():
    assert theory.parse_note("C4") == 60
    assert theory.parse_note("A4") == 69
    assert theory.parse_note("F#2") == 42
    assert theory.parse_note("Bb3") == 58
    assert theory.parse_note("la3") == 57
    assert theory.parse_note(36) == 36
    with pytest.raises(ValueError):
        theory.parse_note("H9")


def _mini_song():
    return {
        "title": "Prova", "bpm": 128, "swing": 50, "key": "A", "scale": "minor",
        "tracks": [],
        "patterns": [{
            "id": "A", "name": "uno", "bars": 2,
            "parts": [
                {"track": 1, "loop_steps": 16, "events": [{"step": 0, "notes": ["C4"], "vel": 100, "length": 1},
                                                          {"step": 8, "notes": ["C4"], "vel": 127, "length": 1}]},
                {"track": 6, "loop_steps": 32, "events": [{"step": 0, "notes": ["A3", "C4", "E4"], "vel": 90, "length": 16},
                                                          {"step": 40, "notes": ["A3"], "vel": 90, "length": 1}]},
                {"track": 7, "loop_steps": 32, "events": [{"step": 2.5, "notes": ["Z9"], "vel": 90, "length": 1}]},
            ]}],
        "arrangement": [{"pattern": "A", "repeats": 2, "label": "x", "mutes": [7]},
                        {"pattern": "missing", "repeats": 1, "label": "", "mutes": []}],
    }


def test_spec_lenient_and_tiling():
    song = Song.from_dict(_mini_song(), LAYOUT)
    p = song.pattern("A")
    assert p.steps == 32
    kick = p.expanded(1)
    assert [e.step for e in kick] == [0, 8, 16, 24]
    assert len(p.expanded(6)) == 1               # step 40 is outside the 32-step loop
    assert p.part(7).events == []                # invalid note dropped
    assert len(song.arrangement) == 1            # unknown pattern row dropped
    assert song.warnings
    assert song.tracks[0].track == 1 and len(song.tracks) == 8
    again = Song.from_dict(json.loads(song.to_json()), LAYOUT)
    assert again.to_dict() == song.to_dict()


def test_schema_is_strict():
    sc = song_json_schema()

    def walk(node):
        if node.get("type") == "object":
            assert node["additionalProperties"] is False
            assert set(node["required"]) == set(node["properties"])
            for v in node["properties"].values():
                walk(v)
        if node.get("type") == "array":
            walk(node["items"])
    walk(sc)


@pytest.mark.parametrize("prompt", [
    "techno ipnotica 130 bpm in la minore",
    "lofi hip hop malinconico",
    "pop solare in sol maggiore 3 minuti",
    "drum and bass liquid",
    "ambient cinematografica",
    "trap scura",
    "reggaeton",
    "synthwave anni 80",
])
def test_offline_composer(prompt):
    song = composer.compose(prompt, LAYOUT, seed=1)
    assert song.patterns and song.arrangement
    assert not song.warnings, song.warnings
    for p in song.patterns:
        for part in p.parts:
            slot = LAYOUT.slot(part.track)
            for e in part.events:
                assert 0 <= e.step < part.loop_steps
                if slot.kind == "melodic":
                    assert all(0 <= n <= 127 for n in e.notes)
    assert composer.compose(prompt, LAYOUT, seed=1).to_dict() == song.to_dict()


def test_prompt_hints():
    h = composer.read_hints('una canzone house in fa diesis minore a 124 bpm, "Luna", 4 minuti')
    assert (h.genre, h.bpm, h.key, h.scale, h.minutes, h.title) == ("house", 124, "F#", "minor", 4, "Luna")


# ------------------------------------------------------------------ project writer
@pytest.fixture
def template(tmp_path):
    return fixture.make_synthetic_template(str(tmp_path / "TEMPLATE"))


def test_build_keys(template):
    kv = db.read(template)
    song = Song.from_dict(_mini_song(), LAYOUT)
    final, rep = project.build(kv, song, LAYOUT)
    md = f"{s.pattern_prefix(0)}/data/metadata/data"
    assert codec.dec_bpm(final[f"{md}/bpm"]) == 128
    assert codec.dec_u32(final[f"{md}/pattern_length"]) == 32 * 120
    assert final[f"{md}/name"] == b"UNO"
    # sequence ids are positional: pattern P, track t -> P*16+t
    for t in range(16):
        assert codec.dec_u16(final[f"{s.pattern_prefix(0)}/data/tracks/{t:05d}/data/sequence_id"]) == t
    # kick: 4 trigs at ticks 0, 960, 1920, 2880 with the template drum note
    sp = s.sequence_prefix(0)
    ticks = sorted(int(k.split("/")[-4]) for k in final
                   if k.startswith(f"{sp}/data/ticks/") and k.count("/data/events/") == 1 and k.split("/")[-2] == "events")
    assert ticks == [0, 960, 1920, 2880]
    vel = [v for k, v in final.items() if k.startswith(f"{sp}/data/events/") and k.endswith("/velocity/some")]
    assert sorted(x[0] for x in vel) == [201, 201, 255, 255]
    # chord: 3 events on one tick sharing a group
    sp6 = s.sequence_prefix(5)
    pitches = sorted(v[0] for k, v in final.items() if k.startswith(sp6) and k.endswith("/pitch/some"))
    assert pitches == [57, 60, 64]
    groups = {v for k, v in final.items() if k.startswith(sp6) and k.endswith("/group/some")}
    assert len(groups) == 1
    # the template trig on track 1 is gone, the kit was copied
    assert f"{sp}/data/events/0000000001/data/schedule" in final
    assert any(k.startswith(f"{s.kit_prefix(0)}/data/presets/00104/") for k in final)
    assert rep.trigs == 4 + 1 and rep.notes == 4 + 3
    # untouched categories are preserved byte for byte
    for k, v in kv.items():
        if "/samples/" in k or "/sample_mappings/" in k:
            assert final[k] == v


def test_multi_pattern_kits_and_cleanup(template):
    kv = db.read(template)
    song = composer.compose("techno 130 bpm", LAYOUT, seed=3)
    final, rep = project.build(kv, song, LAYOUT)
    n = len(song.patterns)
    pats = {int(k.split("/")[4]) for k in final if k.startswith(f"{B}/patterns/") and k.count("/") > 4}
    assert pats == set(range(n))
    for p in range(n):
        assert any(k.startswith(f"{s.kit_prefix(p)}/data/presets/") for k in final)
        assert codec.dec_u16(final[f"{s.pattern_prefix(p)}/data/tracks/00003/data/sequence_id"]) == p * 16 + 3
    assert not any(k.startswith(f"{s.kit_prefix(n)}/data/presets/") for k in final)
    assert codec.dec_u16(final[f"{B}/master_track/data/pattern_id"]) == 0


def test_write_project_roundtrip(template, tmp_path):
    before = {f: os.path.getmtime(os.path.join(template, f)) for f in os.listdir(template)}
    kv = db.read(template)
    assert before == {f: os.path.getmtime(os.path.join(template, f)) for f in os.listdir(template)}
    song = composer.compose("house in fa minore", LAYOUT, seed=2)
    final, _ = project.build(kv, song, LAYOUT)
    out = str(tmp_path / "OUT")
    stats = db.write_project(template, out, final)
    assert stats["keys"] == len(final)
    assert db.read(out) == final
    files = os.listdir(out)
    assert "rocksdict-config.json" not in files
    assert len([f for f in files if f.endswith(".sst")]) == 1
    sst = open(os.path.join(out, [f for f in files if f.endswith(".sst")][0]), "rb").read()
    assert struct.unpack("<Q", sst[-8:])[0] == 0x88E241B785F4CFF7   # block-based table
    assert struct.unpack("<I", sst[-12:-8])[0] == 5                  # format_version 5
    assert sst[-53] == 4                                             # kXXH3 checksum
    opts = [f for f in files if f.startswith("OPTIONS-")]
    tmpl = sorted(f for f in os.listdir(template) if f.startswith("OPTIONS-"))[-1]
    for o in opts:
        assert open(os.path.join(out, o), "rb").read() == open(os.path.join(template, tmpl), "rb").read()
    sm = inspect.summarize(db.read(out))
    assert [p["name"] for p in sm["patterns"]] == [p.name for p in song.patterns]


def test_widths_without_trigs(tmp_path):
    t = fixture.make_synthetic_template(str(tmp_path / "T"), with_trig=False)
    info = project.analyze(db.read(t))
    assert (info.event_w, info.tick_w, info.widths_detected) == (10, 10, False)


def test_widths_detected_from_template():
    kv = fixture.synthetic_template_kv()
    kv = {k.replace("/events/0000000001", "/events/00001").replace("/ticks/0000000000", "/ticks/00000"): v
          for k, v in kv.items()}
    info = project.analyze(kv)
    assert (info.event_w, info.tick_w, info.widths_detected) == (5, 5, True)
    song = Song.from_dict(_mini_song(), LAYOUT)
    final, _ = project.build(kv, song, LAYOUT)
    assert f"{s.sequence_prefix(0)}/data/ticks/00960/tag" in final


def test_rejects_active_db():
    with pytest.raises(project.TemplateError):
        project.analyze({"/project/tag": b"ActiveDbV2"})


def test_velocity_mapping():
    assert codec.velocity(100) == 201
    assert codec.velocity(127) == 255
    assert codec.dec_velocity(201) == 100


# ------------------------------------------------------------------ exports / pipeline
def test_exports(template, tmp_path):
    song = composer.compose("pop solare", LAYOUT, seed=5)
    out = build_output(song, LAYOUT, str(tmp_path / "out"), template)
    for f in out.files.values():
        assert os.path.getsize(f) > 0
    mid = open(out.files["preview"], "rb").read()
    assert mid[:4] == b"MThd" and struct.unpack(">H", mid[10:12])[0] == 9
    sv = songverk_json(song)
    assert len(sv["rows"]) == len(song.arrangement)
    assert sv["rows"][0]["len"] == song.pattern(song.arrangement[0].pattern).steps
    assert os.path.isdir(out.project)
    # a second run never overwrites the first one
    out2 = build_output(song, LAYOUT, str(tmp_path / "out"), template)
    assert out2.bundle != out.bundle


def test_midi_without_template(tmp_path):
    song = composer.compose("ambient", LAYOUT, seed=1)
    out = build_output(song, LAYOUT, str(tmp_path / "o"))
    assert out.project is None and os.path.exists(out.files["midi"])
    write_midi(song, LAYOUT, str(tmp_path / "x.mid"))


# ------------------------------------------------------------------ Claude (mocked)
class _Block:
    def __init__(self, text):
        self.type, self.text = "text", text


class _Msg:
    def __init__(self, text, stop="end_turn"):
        self.content, self.stop_reason = [_Block(text)], stop


def _fake_anthropic(monkeypatch, msg, seen):
    class Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get_final_message(self):
            return msg

    class Messages:
        def stream(self, **kw):
            seen.update(kw)
            return Stream()

    class Client:
        def __init__(self):
            self.beta = types.SimpleNamespace(messages=Messages())

    class Err(Exception):
        pass
    mod = types.SimpleNamespace(Anthropic=Client, AuthenticationError=Err, RateLimitError=Err,
                                BadRequestError=Err, APIStatusError=Err, APIConnectionError=Err)
    monkeypatch.setitem(sys.modules, "anthropic", mod)


def test_llm_request_and_parse(monkeypatch):
    from tvgen import llm
    seen = {}
    _fake_anthropic(monkeypatch, _Msg(json.dumps(_mini_song() | {"genre": "techno", "description": "d"})), seen)
    song = llm.compose("techno", LAYOUT)
    assert song.title == "PROVA"
    assert seen["model"] == "claude-opus-5-5"
    assert seen["output_config"]["format"]["type"] == "json_schema"
    assert seen["fallbacks"] == "default"
    assert "Track 5: bass" in seen["system"]


def test_llm_refusal(monkeypatch):
    from tvgen import llm
    _fake_anthropic(monkeypatch, _Msg("", stop="refusal"), {})
    with pytest.raises(llm.ComposerError):
        llm.compose("x", LAYOUT)


# ------------------------------------------------------------------ desktop app backend
def test_server_requires_token(template, tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    import threading
    import urllib.error
    import urllib.request
    from tvgen.web.server import make_server
    h = make_server("127.0.0.1", 0, str(tmp_path / "o"), template, app_mode=True)
    threading.Thread(target=h.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{h.app.port}"
    try:
        page = urllib.request.urlopen(base + "/").read().decode()
        assert h.app.token in page and "const APP = true" in page
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base + "/api/status")
        assert e.value.code == 403
        hdr = {"X-TVGen-Token": h.app.token, "Content-Type": "application/json"}
        st = json.loads(urllib.request.urlopen(urllib.request.Request(base + "/api/status", headers=hdr)).read())
        assert st["app"] is True
        body = json.dumps({"prompt": "techno 130 bpm", "engine": "offline", "template": template}).encode()
        r = json.loads(urllib.request.urlopen(urllib.request.Request(base + "/api/generate", body, hdr)).read())
        assert r["project"] and r["player"]["notes"] and r["player"]["sections"]
        assert abs(r["player"]["duration"] - r["duration"]) < 1
        hist = json.loads(urllib.request.urlopen(urllib.request.Request(base + "/api/history", headers=hdr)).read())
        assert hist["items"][0]["bundle"] == r["bundle"]
        bad = urllib.request.Request(base + "/api/load?bundle=../../etc", headers=hdr)
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(bad)
    finally:
        h.shutdown()


def test_copy_next_to_template(tmp_path):
    from tvgen import appsupport
    card = tmp_path / "card"
    (card / "TEMPLATE").mkdir(parents=True)
    proj = tmp_path / "out" / "SONG" / "SONG"
    proj.mkdir(parents=True)
    (proj / "CURRENT").write_text("x")
    d1 = appsupport.copy_next_to_template(str(proj), str(card / "TEMPLATE"))
    d2 = appsupport.copy_next_to_template(str(proj), str(card / "TEMPLATE"))
    assert os.path.basename(d1) == "SONG" and os.path.basename(d2) == "SONG-2"
    assert (card / "SONG" / "CURRENT").read_text() == "x"


def test_macapp_selftest():
    from tvgen import macapp
    assert macapp.selftest() == 0
