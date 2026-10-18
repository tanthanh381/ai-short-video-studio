"""Small OpenAI-compatible local transcription bridge backed by faster-whisper.

The studio only needs word timestamps, so this service keeps the existing
whisper.cpp `/inference` contract while using CTranslate2's CPU/int8 runtime.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel
from uvicorn import run


MODEL_NAME = os.getenv("FASTER_WHISPER_MODEL", "large-v3-turbo")
_model_dir = os.getenv("FASTER_WHISPER_MODEL_DIR", "").strip()
MODEL_DIR = Path(_model_dir) if _model_dir else None
COMPUTE_TYPE = os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "int8")
DEVICE = os.getenv("FASTER_WHISPER_DEVICE", "cpu")
PORT = int(os.getenv("FASTER_WHISPER_PORT", "8080"))

app = FastAPI(title="AI Short Video Studio faster-whisper")
_model: WhisperModel | None = None
_model_lock = Lock()


def model() -> WhisperModel:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                kwargs = {"device": DEVICE, "compute_type": COMPUTE_TYPE}
                if MODEL_DIR:
                    kwargs["download_root"] = str(MODEL_DIR)
                _model = WhisperModel(MODEL_NAME, **kwargs)
    return _model


@app.get("/")
@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "engine": "faster-whisper", "model": MODEL_NAME, "device": DEVICE, "computeType": COMPUTE_TYPE}


@app.post("/inference")
async def inference(file: UploadFile = File(...), language: str = "vi") -> dict[str, object]:
    suffix = Path(file.filename or "audio.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(prefix="studio-whisper-", suffix=suffix, delete=False) as temp:
        temp.write(await file.read())
        audio_path = Path(temp.name)
    try:
        segments, _info = model().transcribe(
            str(audio_path),
            language=language or "vi",
            word_timestamps=True,
            vad_filter=True,
            beam_size=1,
            condition_on_previous_text=False,
        )
        result_segments: list[dict[str, object]] = []
        for segment in segments:
            words = [
                {"word": word.word, "start": float(word.start or 0), "end": float(word.end or word.start or 0)}
                for word in (segment.words or [])
                if word.word and word.start is not None
            ]
            result_segments.append({"start": float(segment.start), "end": float(segment.end), "words": words})
        return {"text": " ".join(str(word["word"]).strip() for segment in result_segments for word in segment["words"]), "segments": result_segments}
    finally:
        audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    run(app, host="127.0.0.1", port=PORT, log_level="warning")
