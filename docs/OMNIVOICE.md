# OmniVoice local TTS

OmniVoice is integrated as an optional TTS engine behind the existing media
bridge. VieNeu remains the default and is used when OmniVoice is not healthy.

## Runtime

Install the isolated Python 3.12 runtime on the Mac that will host the voice
service:

```bash
zsh scripts/install-omnivoice.sh
```

The runtime alone does not download model weights. The official OmniVoice
checkpoint is currently published under a CC-BY-NC license, so it must not be
used for a commercial production workload without separate licensing.

After placing an authorised checkpoint at
`$HOME/Developer/local-ai/models/omnivoice`, restart the local services. The
bridge will advertise `omnivoice` only when `GET /health` returns `ok: true`.
The website then exposes it automatically in the local TTS selector. Existing
projects continue using VieNeu unless `localModels.tts` is explicitly set to
`omnivoice`.

Useful checks:

```bash
curl -fsS http://127.0.0.1:5010/health
curl -fsS http://127.0.0.1:8765/models
```

Do not enable voice cloning without the speaker's consent. The current
integration uses OmniVoice voice-design instructions and keeps the existing
subtitle alignment path unchanged.
