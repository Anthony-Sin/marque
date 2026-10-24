#!/usr/bin/env python3
"""Local image generation service for marque — stabilityai/sd-turbo on the GPU.

POST /generate {"prompt": str, "width": int, "height": int, "steps": int, "seed": int,
                "negative": str, "upscale": 2}  ->  image/png bytes
GET  /health                                  ->  {"ok": true, "model": ..., "vram_mb": ...}

Runs offline from the HF cache (HF_HUB_OFFLINE=1). Keep it single-process —
the pipeline stays resident so a request is ~1-3s on a 4070.
"""
import json, os, sys, time
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from diffusers import AutoPipelineForText2Image

MODEL = os.environ.get("LOCALGEN_MODEL", "stabilityai/sd-turbo")
HOST, PORT = "127.0.0.1", int(os.environ.get("LOCALGEN_PORT", "8807"))
# sd-turbo is an SD2.1-turbo: 512px-native, distillation model → guidance_scale 0
BASE = 512
NEG = "text, words, letters, typography, logo, watermark, caption, title, signature, label, font, writing, alphabet, numbers, newspaper, magazine, book, poster, packaging, signage, billboard, screen, menu, printed"

print(f"[localgen] loading {MODEL} ...", flush=True)
t0 = time.time()
pipe = AutoPipelineForText2Image.from_pretrained(
    MODEL, torch_dtype=torch.float16, variant="fp16",
)
pipe = pipe.to("cuda")
pipe.set_progress_bar_config(disable=True)
# keep VRAM tight on the 8GB card
try:
    pipe.enable_vae_tiling()
except Exception:
    pass
print(f"[localgen] ready in {time.time() - t0:.1f}s — listening on {HOST}:{PORT}", flush=True)

def snap8(n, lo=256, hi=896):
    return max(lo, min(hi, int(n // 8 * 8)))

def is_noise(img):
    # pure-static output slips past the byte-size check: gradient energy ~64 vs <=32 real
    import numpy as np
    a = np.asarray(img.convert("L").resize((64, 64)), dtype=np.float32)
    return abs(np.diff(a, axis=1)).mean() > 40 and abs(np.diff(a, axis=0)).mean() > 40

def gen(prompt, w, h, steps, seed, negative, upscale):
    w, h = snap8(w), snap8(h)
    out = None
    for attempt in range(2):
        s = int(seed) + attempt if seed is not None else None
        gen_device = torch.Generator("cuda").manual_seed(s) if s is not None else None
        out = pipe(
            prompt=prompt,
            negative_prompt=negative or None,
            width=w, height=h,
            num_inference_steps=max(1, min(8, int(steps or 4))),
            guidance_scale=0.0,
            generator=gen_device,
        ).images[0]
        if not is_noise(out):
            break
        print(f"[localgen] noise rejected (attempt {attempt + 1})", flush=True)
    if is_noise(out):
        raise RuntimeError("local output rejected as noise")
    if upscale and upscale > 1:
        out = out.resize((out.width * upscale, out.height * upscale), resample=2)  # LANCZOS
    import io
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            used = torch.cuda.memory_allocated() / 1e6 if torch.cuda.is_available() else 0
            return self._json(200, {"ok": True, "model": MODEL, "vram_mb": round(used)})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            return self._json(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            prompt = str(body.get("prompt", "")).strip()
            if not prompt:
                return self._json(400, {"error": "prompt required"})
            t0 = time.time()
            png = gen(
                prompt,
                body.get("width", BASE), body.get("height", BASE),
                body.get("steps", 4), body.get("seed"),
                body.get("negative", NEG), body.get("upscale", 2),
            )
            ms = round((time.time() - t0) * 1000)
            self.send_response(200)
            self.send_header("content-type", "image/png")
            self.send_header("x-gen-ms", str(ms))
            self.send_header("content-length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            print(f"[localgen] {body.get('width')}x{body.get('height')} {ms}ms", flush=True)
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})

ThreadingHTTPServer((HOST, PORT), H).serve_forever()
