"""Small local Piper TTS API for the Vietnamese voice installed in this project."""

import os
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from piper import PiperVoice


ROOT = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("PIPER_MODEL_DIR", ROOT / "models" / "piper"))
MODEL_NAME = os.environ.get("PIPER_MODEL", "vi_VN-vais1000-medium")
MODEL_PATH = MODEL_DIR / f"{MODEL_NAME}.onnx"

app = FastAPI(title="Local Vietnamese Piper TTS")
voice = None


class SpeechRequest(BaseModel):
    input: str
    response_format: str = "wav"


@app.get("/health")
def health():
    return {"ok": MODEL_PATH.exists(), "model": MODEL_NAME, "engine": "piper"}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    global voice
    if request.response_format.lower() != "wav":
        raise HTTPException(status_code=400, detail="Only wav is supported")
    if not request.input.strip():
        raise HTTPException(status_code=400, detail="input must not be empty")
    if voice is None:
        if not MODEL_PATH.exists():
            raise HTTPException(status_code=500, detail=f"Missing model: {MODEL_PATH}")
        voice = PiperVoice.load(str(MODEL_PATH))
    fd, output_path = tempfile.mkstemp(prefix="piper-", suffix=".wav")
    os.close(fd)
    with wave.open(output_path, "wb") as wav_file:
        voice.synthesize_wav(request.input, wav_file)
    return FileResponse(output_path, media_type="audio/wav", filename="speech.wav")
