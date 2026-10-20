"""Optional OpenAI-compatible OmniVoice service.

The service is opt-in: it only becomes healthy when an OmniVoice checkpoint is
present. VieNeu remains the default engine and fallback for existing projects.
"""
from __future__ import annotations

import io
import os
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

MODEL_ID = os.getenv("OMNIVOICE_MODEL", str(Path.home() / "Developer" / "local-ai" / "models" / "omnivoice"))
DEVICE = os.getenv("OMNIVOICE_DEVICE", "mps" if torch.backends.mps.is_available() else "cpu")
MODEL = None
MODEL_ERROR: str | None = None
LOCK = threading.Lock()

app = FastAPI(title="Local OmniVoice TTS")


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=10_000)
    voice: str | None = None
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    direction: str | None = Field(default=None, max_length=500)


@app.on_event("startup")
def warm_model_on_startup():
    # Load once before the bridge probes the service. This avoids advertising
    # an engine that then times out while loading on its first request.
    _load_model()


def _is_remote_model() -> bool:
    return not Path(MODEL_ID).is_absolute() and "/" in MODEL_ID


def _load_model():
    global MODEL, MODEL_ERROR
    if MODEL is not None:
        return MODEL
    if not Path(MODEL_ID).exists() and not _is_remote_model():
        MODEL_ERROR = f"OmniVoice checkpoint chưa tồn tại: {MODEL_ID}"
        return None
    try:
        from omnivoice import OmniVoice
        dtype = torch.float16 if DEVICE != "cpu" else torch.float32
        MODEL = OmniVoice.from_pretrained(MODEL_ID, device_map=DEVICE, dtype=dtype, load_asr=False)
        MODEL_ERROR = None
        return MODEL
    except Exception as error:
        MODEL_ERROR = str(error)[:300]
        return None


def _instruct(request: SpeechRequest) -> str:
    # OmniVoice validates `instruct` against a small fixed vocabulary. Keep
    # language in the separate `language` argument and never pass VieNeu's
    # free-form emotion tags through to OmniVoice.
    female_presets = {"co-trang-nu", "tin-tuc-nu", "nang-dong-nu", "ke-chuyen-nu"}
    gender = "female" if request.voice in female_presets else "male"
    return f"{gender}, young adult, moderate pitch"


@app.get("/health")
def health():
    checkpoint = Path(MODEL_ID).exists() or _is_remote_model()
    ready = MODEL is not None
    return {
        "ok": ready,
        "engine": "omnivoice",
        "model": MODEL_ID,
        "device": DEVICE,
        "checkpoint": checkpoint,
        "detail": MODEL_ERROR or ("ready" if ready else "checkpoint chưa được nạp"),
        "sample_rate": 24000,
    }


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    model = _load_model()
    if model is None:
        raise HTTPException(status_code=503, detail=MODEL_ERROR or "OmniVoice chưa sẵn sàng")
    try:
        with LOCK:
            audio = model.generate(
                request.input,
                language="Vietnamese",
                instruct=_instruct(request),
                speed=request.speed,
                normalize_text=False,
            )[0]
        buffer = io.BytesIO()
        sf.write(buffer, np.asarray(audio, dtype=np.float32), 24000, format="WAV", subtype="PCM_16")
        return Response(content=buffer.getvalue(), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"OmniVoice synthesis failed: {str(error)[:300]}") from error
