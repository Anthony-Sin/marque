#!/usr/bin/env python3
"""Local image generation service for marque — stabilityai/sdxl-turbo on the GPU.

POST /generate {"prompt": str, "width": int, "height": int, "steps": int, "seed": int,
                "negative": str, "upscale": 2,
                "image": "/assets/x.png"|base64, "strength": 0.55}  ->  image/png bytes
GET  /health                                  ->  {"ok": true, "model": ..., "vram_mb": ...}
GET  /health?deep=1                           ->  + one real 256px 4-step gen; 503 if it fails
CLI  --selftest                               ->  load, run the deep check once, print JSON, exit

Runs offline from the HF cache (HF_HUB_OFFLINE=1). sdxl-turbo fp16 is ~7GB of
weights — too big to stay resident next to the desktop on an 8GB card — so the
pipeline runs under CPU offload. LOCALGEN_OFFLOAD=auto (default) tries
enable_model_cpu_offload first and falls back to enable_sequential_cpu_offload
if a full-size (1024px) warmup OOMs; "none" keeps everything resident (only
viable for small models like sd-turbo). Keep it single-process.
"""
import argparse, base64, gc, io, json, os, signal, sys, threading, time
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import torch
from PIL import Image, ImageFilter
from diffusers import AutoPipelineForText2Image, AutoPipelineForImage2Image

MODEL = os.environ.get("LOCALGEN_MODEL", "stabilityai/sdxl-turbo")
ap = argparse.ArgumentParser(description="local SDXL-Turbo image service")
ap.add_argument("--host", default=os.environ.get("LOCALGEN_HOST", "127.0.0.1"))
ap.add_argument("--port", type=int, default=int(os.environ.get("LOCALGEN_PORT", "8807")))
ap.add_argument("--selftest", action="store_true",
                help="after warmup run one 256px 4-step gen, print VRAM/latency JSON, exit")
ARGS = ap.parse_args()
HOST, PORT = ARGS.host, ARGS.port
OFFLOAD = os.environ.get("LOCALGEN_OFFLOAD", "auto").strip().lower()
# sdxl-turbo is an ADD-distilled SDXL: guidance_scale 0, 1-4 inference steps,
# 512px-native (512-768 is the detail sweet spot). Requests can go up to MAXPX.
BASE = int(os.environ.get("LOCALGEN_BASE", "512"))
STEPS = int(os.environ.get("LOCALGEN_STEPS", "4"))
MAXPX = int(os.environ.get("LOCALGEN_MAXPX", "1024"))
# img2img: /generate also accepts {"image": "/assets/x.png"|<base64|data-url>,
# "strength": 0..1} — denoise amount (0.55 keeps subject+palette, repaints
# composition). Refs resolve against the app's asset store, never arbitrary fs.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS_DIR = os.environ.get("LOCALGEN_ASSETS_DIR", os.path.join(ROOT, "data", "assets"))
STRENGTH = float(os.environ.get("LOCALGEN_STRENGTH", "0.55"))
NEG = "text, words, letters, typography, logo, watermark, caption, title, signature, label, font, writing, alphabet, numbers, newspaper, magazine, book, poster, packaging, signage, billboard, screen, menu, printed"


def build_pipe(mode):
    p = AutoPipelineForText2Image.from_pretrained(
        MODEL, torch_dtype=torch.float16, variant="fp16",
    )
    p.set_progress_bar_config(disable=True)
    # keep VAE peak down on the 8GB card
    for meth in ("enable_vae_slicing", "enable_vae_tiling"):
        try:
            getattr(p, meth)()
        except Exception:
            pass
    if mode == "sequential":
        p.enable_sequential_cpu_offload()
    elif mode == "model":
        p.enable_model_cpu_offload()
    elif mode == "none":
        p = p.to("cuda")
    else:
        raise ValueError(f"unknown offload mode {mode}")
    return p


def warmup(p, size):
    """Force allocation at the largest served size so an OOM picks the next mode."""
    with torch.inference_mode():
        p(
            prompt="studio product photograph of a ceramic cup on a stone counter",
            width=size, height=size, num_inference_steps=1,
            guidance_scale=0.0,
            generator=torch.Generator("cuda").manual_seed(0),
        ).images[0]


_ORDERS = {
    "auto": ["model", "sequential"],
    "model": ["model", "sequential"],
    "sequential": ["sequential"],
    "none": ["none", "sequential"],  # resident small models; fall back if OOM
}
# don't even attempt model-level offload unless the fp16 UNet (~5.1GB) plus
# activations plausibly fit — a doomed attempt leaves GBs stranded via the
# exception traceback until it's dropped, polluting the next try.
MIN_FREE_FOR_MODEL_MB = int(os.environ.get("LOCALGEN_MIN_FREE_MODEL_MB", "6400"))


def free_vram_mb():
    if not torch.cuda.is_available():
        return 0
    return torch.cuda.mem_get_info()[0] // 2 ** 20


print(f"[localgen] loading {MODEL} (offload={OFFLOAD}) ...", flush=True)
t0 = time.time()
pipe, ACTIVE_OFFLOAD = None, "none"
for mode in _ORDERS.get(OFFLOAD, _ORDERS["auto"]):
    if mode == "model" and free_vram_mb() < MIN_FREE_FOR_MODEL_MB:
        print(
            f"[localgen] skip offload=model — free VRAM {free_vram_mb()}MB "
            f"< {MIN_FREE_FOR_MODEL_MB}MB", flush=True,
        )
        continue
    err = None
    try:
        print(f"[localgen] trying offload={mode} ...", flush=True)
        pipe = build_pipe(mode)
        warmup(pipe, MAXPX)
    except Exception as e:
        err = str(e)[:200]
        pipe = None
    if pipe is not None:
        ACTIVE_OFFLOAD = mode
        break
    # `e` is released when the except block exits (traceback -> frames ->
    # pipeline gone) — reclaim VRAM only after that point.
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print(f"[localgen] offload={mode} failed: {err}", flush=True)
if pipe is None:
    sys.exit("[localgen] FATAL: no offload mode worked")
print(
    f"[localgen] ready in {time.time() - t0:.1f}s — offload={ACTIVE_OFFLOAD} "
    f"— listening on {HOST}:{PORT}", flush=True,
)


def snap8(n, lo=256, hi=None):
    hi = hi or MAXPX
    return max(lo, min(hi, int(n // 8 * 8)))


def is_noise(img):
    # pure-static output slips past the byte-size check: gradient energy ~64 vs <=32 real
    import numpy as np
    a = np.asarray(img.convert("L").resize((64, 64)), dtype=np.float32)
    return abs(np.diff(a, axis=1)).mean() > 40 and abs(np.diff(a, axis=0)).mean() > 40


# the pipeline/scheduler is not thread-safe — ThreadingHTTPServer would let
# concurrent /generate calls corrupt shared scheduler state. Serialize gen.
GEN_LOCK = threading.Lock()

# img2img shares every module with the txt2img pipe (from_pipe reuses
# components — the sequential-offload hooks live on the shared modules, so the
# second pipeline adds ~zero VRAM). Built lazily on first ref request inside
# GEN_LOCK: if that ever did double VRAM it would OOM on that one edit request
# rather than taking down txt2img startup.
i2i_pipe = None


def get_i2i():
    global i2i_pipe
    if i2i_pipe is None:
        t0 = time.time()
        i2i_pipe = AutoPipelineForImage2Image.from_pipe(pipe)
        i2i_pipe.set_progress_bar_config(disable=True)
        print(
            f"[localgen] img2img ready in {time.time() - t0:.1f}s (shared weights)"
            f" — vram {torch.cuda.memory_allocated() / 1e6:.0f}MB", flush=True,
        )
    return i2i_pipe


def load_ref_image(spec):
    """'image' field: /assets/x.png (resolved under ASSETS_DIR, basename only —
    no traversal), data URL, or raw base64."""
    spec = str(spec).strip()
    if spec.startswith("/assets/"):
        p = os.path.join(ASSETS_DIR, os.path.basename(spec))
        if not os.path.isfile(p):
            raise ValueError(f"ref not found: {spec}")
        return Image.open(p).convert("RGB")
    if spec.startswith("data:"):
        spec = spec.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(spec))).convert("RGB")


def reframe_canvas(img, w, h):
    """Compose a wxh init canvas for img2img. Same aspect → plain resize.
    Different aspect → contain-fit the source on its own blurred cover
    background: the subject stays undistorted and the pad regions carry
    plausible colors/context for the model to outpaint into."""
    img = img.convert("RGB")
    if abs(img.width * h - img.height * w) <= 0.02 * img.height * w:
        return img.resize((w, h), resample=Image.Resampling.LANCZOS)
    cover = max(w / img.width, h / img.height)
    bg = img.resize(
        (max(w, round(img.width * cover)), max(h, round(img.height * cover))),
        resample=Image.Resampling.LANCZOS,
    )
    left, top = (bg.width - w) // 2, (bg.height - h) // 2
    bg = bg.crop((left, top, left + w, top + h)).filter(
        ImageFilter.GaussianBlur(min(w, h) // 12)
    )
    fit = min(w / img.width, h / img.height)
    fg = img.resize(
        (max(8, round(img.width * fit)), max(8, round(img.height * fit))),
        resample=Image.Resampling.LANCZOS,
    )
    bg.paste(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    return bg


def _is_oom(e):
    s = str(e).lower()
    return isinstance(e, torch.cuda.OutOfMemoryError) or "out of memory" in s


def _run(prompt, w, h, n_steps, seed, negative, image, strength):
    gen_device = torch.Generator("cuda").manual_seed(seed) if seed is not None else None
    kw = dict(prompt=prompt, negative_prompt=negative or None,
              num_inference_steps=n_steps, guidance_scale=0.0, generator=gen_device)
    if image is not None:
        return get_i2i()(image=reframe_canvas(image, w, h), strength=strength, **kw).images[0]
    return pipe(width=w, height=h, **kw).images[0]


def gen(prompt, w, h, steps, seed, negative, upscale, image=None, strength=None):
    w, h = snap8(w), snap8(h)
    strength = max(0.05, min(0.95, float(strength if strength is not None else STRENGTH)))
    n_steps = max(1, min(8, int(steps or STEPS)))
    out = None
    noise_try, oom_retried = 0, False
    while True:
        s = int(seed) + noise_try if seed is not None else None
        try:
            with GEN_LOCK, torch.inference_mode():
                out = _run(prompt, w, h, n_steps, s, negative, image, strength)
        except Exception as e:
            # OOM mid-gen: flush the allocator cache and retry ONCE at half
            # steps — a degraded tile beats a 500 that cascades to cloud.
            if not oom_retried and _is_oom(e):
                oom_retried = True
                n_steps = max(1, n_steps // 2)
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                print(f"[localgen] OOM — cache flushed, retrying once at {n_steps} step(s)", flush=True)
                continue
            raise
        if not is_noise(out):
            break
        noise_try += 1
        if noise_try >= 2:
            break
        print(f"[localgen] noise rejected (attempt {noise_try})", flush=True)
    if is_noise(out):
        raise RuntimeError("local output rejected as noise")
    if upscale and upscale > 1:
        out = out.resize((out.width * upscale, out.height * upscale), resample=Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def deep_check():
    """One real 256px 4-step gen — proves weights+VRAM, not just the socket.
    Serialized behind GEN_LOCK so it queues behind any in-flight /generate."""
    t0, img, err = time.time(), None, None
    try:
        with GEN_LOCK, torch.inference_mode():
            img = pipe(
                prompt="a single red circle centered on a white background",
                width=256, height=256, num_inference_steps=4,
                guidance_scale=0.0,
                generator=torch.Generator("cuda").manual_seed(0),
            ).images[0]
    except Exception as e:
        err = str(e)[:200]
    d = {
        "ok": img is not None and not is_noise(img),
        "gen_ms": round((time.time() - t0) * 1000),
        "vram_mb": round(torch.cuda.memory_allocated() / 1e6) if torch.cuda.is_available() else 0,
        "vram_free_mb": free_vram_mb(),
    }
    if err:
        d["error"] = err
    return d


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
        u = urlparse(self.path)
        if u.path == "/health":
            used = torch.cuda.memory_allocated() / 1e6 if torch.cuda.is_available() else 0
            body = {"ok": True, "model": MODEL, "offload": ACTIVE_OFFLOAD,
                    "vram_mb": round(used), "pid": os.getpid()}
            if parse_qs(u.query).get("deep", [""])[0] in ("1", "true"):
                d = deep_check()
                body.update(d)
                return self._json(200 if d["ok"] else 503, body)
            return self._json(200, body)
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            return self._json(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            prompt = str(body.get("prompt", "")).strip()
            if not prompt:
                return self._json(400, {"error": "prompt required"})
            ref = load_ref_image(body["image"]) if body.get("image") else None
            t0 = time.time()
            png = gen(
                prompt,
                body.get("width", BASE), body.get("height", BASE),
                body.get("steps", STEPS), body.get("seed"),
                body.get("negative", NEG), body.get("upscale", 2),
                image=ref, strength=body.get("strength"),
            )
            ms = round((time.time() - t0) * 1000)
            self.send_response(200)
            self.send_header("content-type", "image/png")
            self.send_header("x-gen-ms", str(ms))
            self.send_header("content-length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
            print(
                f"[localgen] {body.get('width')}x{body.get('height')} {ms}ms"
                f"{' img2img s=' + str(body.get('strength') or STRENGTH) if ref else ''}",
                flush=True,
            )
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})


def unload_models():
    """Drop every pipeline ref and release cached VRAM so the next process
    starts on a clean card. Sequential-offload hooks forbid .to(), so drop
    references and let gc + empty_cache do the teardown."""
    global pipe, i2i_pipe
    print("[localgen] unloading models ...", flush=True)
    i2i_pipe = None
    pipe = None
    gc.collect()
    if torch.cuda.is_available():
        try:
            torch.cuda.synchronize()
        except Exception:
            pass
        torch.cuda.empty_cache()


if ARGS.selftest:
    d = deep_check()
    print(f"[localgen] selftest {json.dumps(d)}", flush=True)
    unload_models()
    sys.exit(0 if d["ok"] else 1)

server = ThreadingHTTPServer((HOST, PORT), H)


def _shutdown(sig, frame):
    # server.shutdown() deadlocks on the serve_forever thread — signal
    # handlers run there, so hand the call to a daemon thread.
    print(f"[localgen] signal {sig} — draining ...", flush=True)
    threading.Thread(target=server.shutdown, daemon=True).start()


signal.signal(signal.SIGTERM, _shutdown)
signal.signal(signal.SIGINT, _shutdown)

try:
    server.serve_forever()
finally:
    # Let an in-flight gen finish (handler threads are daemon anyway), then
    # free VRAM before exit — clean handoff to whoever restarts us.
    GEN_LOCK.acquire(timeout=30)
    try:
        unload_models()
    except Exception:
        pass
    server.server_close()
