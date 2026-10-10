"""Local OpenAI-style speech endpoint backed by VieNeu-TTS v3 Turbo ONNX/CPU."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from vieneu import Vieneu


app = FastAPI(title="Local Vietnamese VieNeu TTS")
tts = None
MODEL_ROOT = Path(os.getenv(
    "VIENEU_MODEL_DIR",
    str(Path.home() / "Developer" / "local-ai" / "models" / "vieneu-v3-turbo"),
))
CODEC_ROOT = Path(os.getenv(
    "VIENEU_CODEC_DIR",
    str(Path.home() / "Developer" / "local-ai" / "models" / "moss-audio-tokenizer-onnx"),
))
VIENEU_THREADS = int(os.getenv("VIENEU_THREADS", "6"))


class SpeechRequest(BaseModel):
    input: str
    voice: str = "Đức Trí"
    response_format: str = "wav"
    speed: float = 1.0
    steps: int = 16


def get_tts():
    global tts
    if tts is None:
        missing = [
            str(path) for path in (
                MODEL_ROOT / "config.json",
                MODEL_ROOT / "vieneu_prefill.onnx",
                MODEL_ROOT / "vieneu_backbone_shared.data",
                CODEC_ROOT / "moss_audio_tokenizer_decode_full.onnx",
                CODEC_ROOT / "moss_audio_tokenizer_decode_shared.data",
            ) if not path.is_file()
        ]
        if missing:
            raise RuntimeError("Thiếu artifact VieNeu Turbo ONNX local: " + ", ".join(missing[:3]))
        # VieNeu 3.8.x exposes ``onnx_dir`` but not ``codec_dir`` on the public
        # Vieneu factory. Route its codec fetcher to the explicit local folder so
        # ONNX external-data files resolve next to their graph instead of through
        # Hugging Face blob symlinks.
        from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
        original_fetch = OnnxV3LiteEngine._fetch
        def local_fetch(repo, files, subfolder):
            if repo == "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX":
                return CODEC_ROOT
            return original_fetch(repo, files, subfolder)
        OnnxV3LiteEngine._fetch = staticmethod(local_fetch)
        try:
            tts = Vieneu(
                mode="v3turbo",
                backend="onnx",
                device="cpu",
                precision="int8",
                onnx_dir=str(MODEL_ROOT),
                codec_dir=str(CODEC_ROOT),
                threads=VIENEU_THREADS,
            )
        finally:
            OnnxV3LiteEngine._fetch = staticmethod(original_fetch)
    return tts


@app.get("/health")
def health():
    try:
        get_tts()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"VieNeu Turbo chưa sẵn sàng: {exc}") from exc
    return {"ok": True, "engine": "vieneu-v3turbo-onnx-cpu", "sample_rate": 48000, "threads": VIENEU_THREADS}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    if request.response_format.lower() != "wav":
        raise HTTPException(status_code=400, detail="Only wav is supported")
    if not request.input.strip():
        raise HTTPException(status_code=400, detail="input must not be empty")
    if request.steps < 4 or request.steps > 32:
        raise HTTPException(status_code=400, detail="steps must be between 4 and 32")
    try:
        audio = get_tts().infer(
            request.input,
            voice=request.voice,
            temperature=max(0.2, min(1.0, 0.4 / max(request.speed, 0.5))),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    fd, output_path = tempfile.mkstemp(prefix="vieneu-", suffix=".wav")
    os.close(fd)
    output = Path(output_path)
    get_tts().save(audio, str(output))
    return FileResponse(output, media_type="audio/wav", filename="voiceover.wav")
