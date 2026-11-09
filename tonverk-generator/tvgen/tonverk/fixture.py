"""A synthetic template project, built from the documented schema.

It is NOT a real Tonverk project (it was never produced by the machine): it exists
to test the generator end to end and to try the app without a Tonverk at hand.
Never load it on the machine - use a template saved by your own Tonverk instead.
"""
from __future__ import annotations

from . import codec as c
from . import db
from . import schema as s

B = s.BASE


def synthetic_template_kv(with_trig: bool = True) -> dict[str, bytes]:
    kv: dict[str, bytes] = {
        "/project/tag": c.tag("ProjectV12"),
        f"{B}/signal_flow_version": c.u32(33),
        f"{B}/kits": b"", f"{B}/patterns": b"", f"{B}/sequences": b"",
        f"{B}/samples": b"", f"{B}/sample_mappings": b"", f"{B}/node_to_kit": b"",
        f"{B}/tracks": b"", f"{B}/songs": b"", f"{B}/wavetables": b"",
        f"{B}/auto_channels": b"",
        f"{B}/auto_channels/00000/tag": c.tag("AutoChannelV1"),
        f"{B}/auto_channels/00000/data/tag": c.tag("Off"),
        f"{B}/global_parameters/tag": c.tag("GlobalParametersV1"),
        f"{B}/global_parameters/data/nodes": b"",
        f"{B}/master_track/tag": c.tag("MasterTrackV2"),
        f"{B}/master_track/data/pattern_id": c.u16(0),
        f"{B}/master_track/data/song_slot/none": b"",
        f"{B}/master_track/data/tempo_scale/tag": c.tag("ScaleV1"),
        f"{B}/master_track/data/tempo_scale/data/numer": c.u8(1),
        f"{B}/master_track/data/tempo_scale/data/denom": c.u8(1),
        f"{B}/master_track/data/transport_source_state/tag": c.tag("MasterTransportSourceV1"),
        f"{B}/master_track/data/transport_source_state/data/tag": c.tag("Internal"),
        f"{B}/master_track/data/transport_source_time/tag": c.tag("MasterTransportSourceV1"),
        f"{B}/master_track/data/transport_source_time/data/tag": c.tag("Internal"),
        f"{B}/master_track/data/transport_sync_mode/tag": c.tag("TransportSyncModeV1"),
        f"{B}/master_track/data/transport_sync_mode/data/tag": c.tag("Soft"),
        f"{B}/sequencer_live_recording/tag": c.tag("LiveRecordingV1"),
        f"{B}/sequencer_live_recording/data/note_quantization/some": c.u32(120),
        f"{B}/sequencer_live_recording/data/parameter_quantization/some": c.u32(120),
        f"{B}/sequencer_pre_roll_length/none": b"",
        f"{B}/ui_settings/tag": c.tag("UiSettingsV4"),
        f"{B}/ui_settings/data/edit_track": c.u16(0),
    }
    for k in range(128):
        kv[f"{s.kit_prefix(k)}/tag"] = c.tag("KitV2")
        kv[f"{s.kit_prefix(k)}/data/presets"] = b""
    # kit 0: one SRC preset per audio track (sub-node 04), sample mapping id in pid 136
    for t in range(8):
        node = (t + 1) * 100 + 4
        pp = f"{s.kit_prefix(0)}/data/presets/{node:05d}"
        kv[f"{pp}/tag"] = c.tag("NodePresetV1")
        kv[f"{pp}/data/parameters"] = b""
        for pid_, val in ((0, 0.0), (71, 0.5), (136, float(t))):
            q = f"{pp}/data/parameters/{pid_:05d}"
            kv[f"{q}/tag"] = c.tag("PresetParameterValueV1")
            kv[f"{q}/data/tag"] = c.tag("Value")
            kv[f"{q}/data/data"] = c.f32(val)
        # one sample per track
        sid = 8191 - t
        kv[f"{B}/samples/{sid:010d}/tag"] = c.tag("SampleV1")
        kv[f"{B}/samples/{sid:010d}/data/tag"] = c.tag("Sample")
        kv[f"{B}/samples/{sid:010d}/data/data"] = c.text(f"User/Template/T{t + 1}.wav")
        mp = f"{B}/sample_mappings/{t:010d}"
        kv[f"{mp}/tag"] = c.tag("SampleMappingV3")
        kv[f"{mp}/data/name"] = c.text(f"T{t + 1}")
        kv[f"{mp}/data/loaded_from/none"] = b""
        kv[f"{mp}/data/key_zones"] = b""
        kz = f"{mp}/data/key_zones/00000"
        kv[f"{kz}/tag"] = c.tag("KeyZoneV1")
        kv[f"{kz}/data/nominal_pitch"] = c.u8(60)
        kv[f"{kz}/data/pitch_keycenter"] = c.f32(60.0)
        kv[f"{kz}/data/velocity_layers"] = b""
        vl = f"{kz}/data/velocity_layers/00000"
        kv[f"{vl}/tag"] = c.tag("VelocityLayerV1")
        kv[f"{vl}/data/nominal_velocity"] = c.u8(255)
        kv[f"{vl}/data/sample_slots"] = b""
        kv[f"{vl}/data/sample_slots/00000/tag"] = c.tag("MappedSampleSelectionV2")
        kv[f"{vl}/data/sample_slots/00000/data/sample_slot"] = c.u32(sid)
        kv[f"{vl}/data/strategy/tag"] = c.tag("SampleSelectionAlgorithmV2")
        kv[f"{vl}/data/strategy/data/tag"] = c.tag("Forward")
    # node_to_kit (routing of the active pattern)
    for t in range(16):
        for sub in (0, 1, 2, 4, 5, 6, 7):
            kv[f"{B}/node_to_kit/{(t + 1) * 100 + sub:05d}"] = c.u16(0)
    # pattern 0 + its 16 sequences + global tracks
    kv.update(s.default_pattern(0, 0, 120.0, 1920, 50, ""))
    for t in range(16):
        sp = s.sequence_prefix(t)
        for rel, v in s.default_sequence_fields().items():
            kv[sp + rel] = v
        tp = f"{B}/tracks/{t:05d}"
        kv[f"{tp}/tag"] = c.tag("TrackV1")
        kv[f"{tp}/data/own_bpm"] = c.bpm(120)
        kv[f"{tp}/data/sequence_id"] = c.u16(t)
        kv[f"{tp}/data/muted"] = c.u8(0)
        kv[f"{tp}/data/muted_notes"] = bytes(32)
    if with_trig:
        kv.update(s.note_event(s.sequence_prefix(0), 1, 0, 0, 60, 201, 120))
    return kv


def make_synthetic_template(path: str, with_trig: bool = True) -> str:
    db.create_project(path, synthetic_template_kv(with_trig))
    return path
