# EditmaskwithAI

A self-hosted, web-based AI photo editor. Paint over any object, describe what you want, and the AI replaces just that region — every pixel outside your selection stays untouched.

## Quick Start

### GPU machine (recommended — free inference, best quality)

```bash
git clone https://github.com/outis1one/editmaskwithai
cd editmaskwithai

# One-time setup: installs nvidia-container-toolkit, configures Docker,
# and sets up a permanent DNS fix so the container can download models.
chmod +x install-local-gpu.sh
./install-local-gpu.sh

# Start the app (run this each time):
chmod +x bring-up-local-gpu.sh
./bring-up-local-gpu.sh
```

Open **http://localhost:3080**

**First startup downloads the AI model for your GPU (~13 GB, one time).** Models are cached in `./data/hf_cache/` and survive rebuilds.

---

### Cloud API (no GPU required)

```bash
git clone https://github.com/outis1one/editmaskwithai
cd editmaskwithai
cp .env.example .env
# Edit .env: set AI_PROVIDER and your API key (see .env.example for options)
docker compose up -d --build
```

Open **http://localhost:3080**

---

### Updates (any machine)

```bash
git pull
# GPU:
./bring-up-local-gpu.sh
# or cloud (no GPU):
docker compose up -d --build
```

If pip packages seem stale after a pull (e.g., wrong diffusers version), force a pip layer rebuild without re-downloading the entire PyTorch base image:

```bash
BUILDID=$(date +%s) ./bring-up-local-gpu.sh
```

---

## AI Providers

| Provider | Setup | Cost | Quality |
|---|---|---|---|
| `local_gpu` | GPU machine + nvidia-container-toolkit | Free | Best (SDXL/FLUX auto-selected by VRAM) |
| `openai` | `OPENAI_API_KEY=sk-...` | ~$0.02–0.04/image | DALL-E 3 |
| `replicate` | `REPLICATE_API_KEY=r8_...` | ~$0.002–0.03/image | Multiple models |
| `invokeai` | InvokeAI running on another machine | Self-hosted | FLUX/SDXL |
| `comfyui` | ComfyUI running on another machine | Self-hosted | Any model |

You can also mix: set a default provider in `.env` and override per-operation in the **Image → AI Provider Settings** dialog inside the app.

---

## GPU Tier Auto-Selection

The app detects your GPU at startup and picks the best model it can run:

| Effective VRAM | Model selected | Notes |
|---|---|---|
| ≥ 24 GB | FLUX.1-schnell | Best quality, 4-step generation |
| 12–24 GB | SDXL | Excellent quality |
| 8–12 GB | SDXL + xformers | Good quality |
| 6–8 GB | SDXL + attention slicing | Good quality, slightly slower |
| 4–6 GB | SDXL + CPU offload | Good quality, slower (GTX 1060 6GB range) |
| 2–4 GB | SD 1.5 | Fast, lower detail |
| < 2 GB | SD 1.5 + CPU offload | Very slow — consider a cloud provider |

Override the auto-selected model with `HF_MODEL_TXT2IMG`, `HF_MODEL_INPAINT` in `.env`.

---

## What it can do

### Selection
- **Smart Select (SAM brush)** — paint over an object, AI detects its exact boundaries
- **Smart Select (click)** — click any object, SAM selects it
- **Rectangle / Ellipse / Lasso** — classic selection tools

### After selecting
- **AI Edit** — describe what to change ("add a scar", "make it look aged")
- **Make less symmetrical** — AI adds natural organic variation
- **Replace with clipboard** — paste any image into the selection shape
- **Scale by %** — make the selected object bigger/smaller, AI fills the gap
- **Copy / Cut to layer** — non-destructive layer workflow
- **Erase** — remove the selected region with AI fill

### Image tools
- **Text → Image** — generate from a text description (GPU or cloud)
- **Upscale** — Real-ESRGAN AI upscaling (genuinely adds detail, not just resize)
- **Prepare for Print** — one-click: AI upscale to target DPI + fit to frame
- **Fit to Frame** — resize/crop/AI-extend to standard print sizes
- **Expand Canvas (Outpaint)** — AI extends the image in any direction
- **Remove Background** — one-click background removal

### Print presets
Frame sizes: 4×6, 5×7, 8×10, 11×14, 16×20, 18×24, 20×24, 24×36 (portrait + landscape)  
DPI options: 72, 150, 200, 300 — 200 DPI is fine for 18×24" and larger (viewed from distance)

---

## Progress bars

All AI operations show a real-time progress overlay. For local GPU inference, the bar advances step-by-step as the model denoises (e.g. "Step 14 / 30"). For cloud providers and upscale operations, it animates to indicate activity.

---

## Logs

```bash
# GPU container:
docker compose -f docker-compose.gpu.yml logs -f

# Standard container:
docker compose logs -f
```

---

## File structure

```
EditmaskwithAI/
├── backend/
│   ├── app/
│   │   ├── routers/         # API endpoints (ai_tools, print_tools, …)
│   │   ├── services/        # gpu_detect, local_diffusion, upscale, …
│   │   └── config.py
│   ├── requirements.txt
│   └── requirements.gpu.txt
├── frontend/
│   └── src/js/
│       ├── tools/           # brush_select (SAM paint), smart_select, …
│       ├── modules/
│       │   ├── generate/    # text_to_image, outpaint
│       │   └── image/       # upscale, frame_fit, print_prepare, …
│       └── libs/
│           └── progress_overlay.js
├── docker-compose.yml           # Cloud / no-GPU
├── docker-compose.gpu.yml       # NVIDIA GPU (recommended)
├── docker-compose.dev.yml       # Dev with hot reload
├── Dockerfile
├── Dockerfile.gpu
└── .env.example
```

---

## Troubleshooting

**GPU not detected in Docker**
```bash
# Check toolkit is installed and Docker restarted:
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
# If that fails, re-run: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
```

**Model download stalls or fails**
```bash
# Check logs for HuggingFace errors:
docker compose -f docker-compose.gpu.yml logs -f | grep -E "local_gpu|Error|Failed"
# If a private/gated model: add HF_TOKEN=hf_... to .env
```

**SAM model fails to download (DNS error / firewall blocking port 53)**

If the container can't reach `dl.fbaipublicfiles.com` (you'll see `Errno -3 Name or service not known` in the logs), download SAM directly on the host and let the bind mount make it visible to the container — no rebuild needed:

```bash
mkdir -p ./data/models
# sudo needed if ./data/ was created by Docker (root-owned):
sudo curl -L -o ./data/models/sam_vit_b_01ec64.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
```

The file is ~375 MB. Once it exists at `./data/models/sam_vit_b_01ec64.pth`, the container picks it up on the next startup (no rebuild required). Verify with:
```bash
docker compose -f docker-compose.gpu.yml logs | grep -i sam
# Should show: "SAM model loaded on cuda" (or cpu)
```

If Docker created `./data/` as root and you can't write there without `sudo`, you can also use root's curl as above — the container reads the file regardless of owner.

**AI models not downloading (container DNS blocked)**

If you ran `./install-local-gpu.sh`, this is already permanently fixed. Otherwise, the container's host firewall is blocking outbound DNS from the Docker bridge — apply the fix manually (does **not** affect container isolation):

```bash
sudo iptables -I DOCKER-USER -p udp --dport 53 -j ACCEPT
./bring-up-local-gpu.sh
```

The container will now resolve hostnames and download models automatically (~13 GB on first run, then cached). Watch progress:
```bash
docker compose -f docker-compose.gpu.yml logs -f | grep -E "local_gpu|Cached|failed"
```

**Alternative: download with a Docker helper container** (no iptables, no host Python needed):

```bash
# Inpainting model (~6.5 GB) — needed for AI Edit, Make less symmetrical, etc.
docker run --rm \
  -v "$(pwd)/data/hf_cache:/root/.cache/huggingface" \
  python:3.11-slim \
  bash -c "pip install -q huggingface-hub && \
    huggingface-cli download diffusers/stable-diffusion-xl-1.0-inpainting-0.1 \
      --exclude '*.msgpack' 'flax_*' 'tf_*'"

# Text-to-image model (~6.5 GB) — needed for Text → Image
docker run --rm \
  -v "$(pwd)/data/hf_cache:/root/.cache/huggingface" \
  python:3.11-slim \
  bash -c "pip install -q huggingface-hub && \
    huggingface-cli download stabilityai/stable-diffusion-xl-base-1.0 \
      --exclude '*.msgpack' 'flax_*' 'tf_*'"
```

Then restart: `docker compose -f docker-compose.gpu.yml restart`

**Out of VRAM during generation**
- Reduce `LOCAL_GPU_MAX_PIPELINES=1` in `.env` (default 2)
- Or override to a smaller model: `HF_MODEL_TXT2IMG=runwayml/stable-diffusion-v1-5`

**Settings saved locally only**
- The in-app AI Provider Settings dialog saves to localStorage for the session
- To make settings permanent: edit `.env` and rebuild

**Check API docs**
```
http://localhost:3080/api/docs
```
