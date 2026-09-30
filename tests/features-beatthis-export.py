# Exports Beat This! small0 (official checkpoint) to ONNX and writes a reference for ACRUX's JS port:
#   beat-this-small0.onnx       input "spect" [1, T, 128] (T <= 1500), outputs "beat", "downbeat" logits [1, T]
#   reference.json              for a deterministic test signal that JS regenerates exactly (signal() below):
#                               mel at a few frames, logits for the whole piece (chunked as beat_this does),
#                               and beat_this's own beats/downbeats (minimal postprocessing)
import json, math
import numpy as np
import torch
import onnxruntime as ort
from beat_this.inference import load_model, split_predict_aggregate
from beat_this.preprocessing import LogMelSpect
from beat_this.model.postprocessor import Postprocessor

SR = 22050

def signal(seconds=40.0, bpm=132.0, per_bar=3):
    """A waltz-like test piece: a click on every beat (the first of each bar louder and lower), a chord that changes
    each bar, and quiet noise from a 31-bit LCG, so JS makes the same samples."""
    n = int(seconds * SR)
    x = np.zeros(n)
    beat = 60.0 / bpm
    seed = 1
    for i in range(n):
        seed = (seed * 16807) % 2147483647
        x[i] = 0.02 * (seed / 2147483647 * 2 - 1)
    chords = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [164.81, 207.65, 246.94]]
    k = 0
    while k * beat < seconds:
        t0 = k * beat
        down = k % per_bar == 0
        f, amp = (60.0, 0.9) if down else (1200.0, 0.35)
        s = int(round(t0 * SR))
        for i in range(int(0.12 * SR)):
            if s + i >= n: break
            t = i / SR
            x[s + i] += amp * math.sin(2 * math.pi * f * t) * math.exp(-35 * t)
        if down:
            ch = chords[(k // per_bar) % 4]
            for i in range(int(per_bar * beat * SR)):
                if s + i >= n: break
                t = i / SR
                x[s + i] += 0.08 * sum(math.sin(2 * math.pi * fr * t) for fr in ch) * math.exp(-1.5 * t)
        k += 1
    return x.astype(np.float32)

class Wrap(torch.nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, spect):
        out = self.m(spect)
        return out["beat"], out["downbeat"]

model = load_model("small0").eval()
wrapped = Wrap(model).eval()
dummy = torch.randn(1, 1500, 128)
torch.onnx.export(wrapped, (dummy,), "beat-this-small0.onnx", input_names=["spect"], output_names=["beat", "downbeat"],
                  dynamic_axes={"spect": {1: "frames"}, "beat": {1: "frames"}, "downbeat": {1: "frames"}}, opset_version=17,
                  dynamo=False)

x = signal()
spect = LogMelSpect()(torch.from_numpy(x))  # (T, 128)
with torch.inference_mode():
    pred = split_predict_aggregate(spect, 1500, 6, "keep_first", model)
beat, down = pred["beat"].numpy(), pred["downbeat"].numpy()
beats, downbeats = Postprocessor("minimal")(torch.from_numpy(beat), torch.from_numpy(down))

# ONNX vs PyTorch on a whole chunk and on a short one
sess = ort.InferenceSession("beat-this-small0.onnx")
for T in (1500, 437):
    s = spect[:T].unsqueeze(0)
    with torch.inference_mode():
        tb, td = wrapped(s)
    ob, od = sess.run(None, {"spect": s.numpy()})
    print(f"ONNX vs torch, {T} frames: max diff beat {np.abs(ob - tb.numpy()).max():.2e}, downbeat {np.abs(od - td.numpy()).max():.2e}")

pick = [0, 1, 2, 57, 300, 1499, 1500, len(spect) - 1]
json.dump({
    "signal": {"seconds": 40.0, "bpm": 132.0, "per_bar": 3},
    "frames": int(spect.shape[0]),
    "mel": {str(f): [round(float(v), 5) for v in spect[f]] for f in pick},
    "beatLogits": [round(float(v), 4) for v in beat],
    "downbeatLogits": [round(float(v), 4) for v in down],
    "beats": [round(float(t), 4) for t in beats],
    "downbeats": [round(float(t), 4) for t in downbeats],
}, open("reference.json", "w"))
print("frames", spect.shape[0], "beats", len(beats), "downbeats", len(downbeats))
print("beat interval", np.median(np.diff(beats)), "beats per bar", np.median(np.diff([np.argmin(np.abs(beats - d)) for d in downbeats])))
