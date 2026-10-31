"""Optional OpenAI-compatible OmniVoice service.

The service is opt-in: it only becomes healthy when an OmniVoice checkpoint is
present. VieNeu remains the default engine and fallback for existing projects.
"""
from __future__ import annotations

import base64
import binascii
import io
import os
import tempfile
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


class CloneRequest(BaseModel):
    # Text to speak in the cloned voice.
    input: str = Field(min_length=1, max_length=10_000)
    # The reference recording, base64-encoded. A short, clean clip (~10-30s) clones best.
    ref_audio_b64: str = Field(min_length=16)
    # File extension of the reference, so torchaudio/soundfile picks the right decoder.
    ref_audio_format: str = Field(default="wav", pattern=r"^[a-z0-9]{1,5}$")
    # Transcript of the reference clip. Optional: without it the ASR model auto-transcribes
    # (loaded on demand, uses more memory), so the UI asks for it to keep quality high and RAM low.
    ref_text: str | None = Field(default=None, max_length=2_000)
    speed: float | None = Field(default=None, ge=0.5, le=2.0)


_ASR_LOADED = False


def _ensure_asr(model) -> None:
    global _ASR_LOADED
    if _ASR_LOADED:
        return
    model.load_asr_model()
    _ASR_LOADED = True


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


@app.post("/v1/audio/clone")
def clone(request: CloneRequest):
    """Speak `input` in the voice of the supplied reference recording (zero-shot clone)."""
    model = _load_model()
    if model is None:
        raise HTTPException(status_code=503, detail=MODEL_ERROR or "OmniVoice chưa sẵn sàng")
    try:
        raw = base64.b64decode(request.ref_audio_b64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"Mẫu giọng base64 không hợp lệ: {str(error)[:120]}") from error
    if len(raw) < 1_000:
        raise HTTPException(status_code=400, detail="Mẫu giọng quá ngắn hoặc rỗng.")
    ref_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{request.ref_audio_format}", delete=False) as handle:
            handle.write(raw)
            ref_path = handle.name
        ref_text = (request.ref_text or "").strip() or None
        with LOCK:
            if ref_text is None:
                _ensure_asr(model)  # auto-transcribe the reference when the user gave no transcript
            prompt = model.create_voice_clone_prompt(ref_path, ref_text=ref_text)
            audio = model.generate(
                request.input,
                language="Vietnamese",
                voice_clone_prompt=prompt,
                speed=request.speed,
                normalize_text=False,
            )[0]
        buffer = io.BytesIO()
        sf.write(buffer, np.asarray(audio, dtype=np.float32), 24000, format="WAV", subtype="PCM_16")
        return Response(content=buffer.getvalue(), media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"OmniVoice clone failed: {str(error)[:300]}") from error
    finally:
        if ref_path:
            try:
                os.unlink(ref_path)
            except OSError:
                pass
