#!/bin/zsh
# Keep the optional LTX service available on the secondary Mac. MPS is faster,
# but a failed MPS allocation can terminate the Python process without letting
# the HTTP handler return an error. Restart once in CPU mode so the worker can
# still use real motion instead of silently falling back to a still image.
set -u

studio_root=${STUDIO_ROOT:-${0:A:h:h}}
local_ai_root=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
ltx_root=${LTX_VIDEO_ROOT:-"$local_ai_root/LTX-Video"}
ltx_env=${LTX_ENV:-"$local_ai_root/ltx-venv"}
checkpoint=${LTX_VIDEO_CHECKPOINT:-"$local_ai_root/models/ltx-video/ltxv-2b-0.9.8-distilled.safetensors"}
upscaler=${LTX_VIDEO_SPATIAL_UPSCALER:-"$local_ai_root/models/ltx-video/ltxv-spatial-upscaler-0.9.8.safetensors"}
text_encoder=${LTX_VIDEO_TEXT_ENCODER:-"$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/current"}
device=${LTX_VIDEO_DEVICE:-mps}

while true; do
  print "[ltx-supervisor] starting device=$device" >&2
  env LTX_VIDEO_ROOT="$ltx_root" LTX_VIDEO_CHECKPOINT="$checkpoint" \
    LTX_VIDEO_SPATIAL_UPSCALER="$upscaler" LTX_VIDEO_TEXT_ENCODER="$text_encoder" \
    LTX_VIDEO_DEVICE="$device" "$ltx_env/bin/python" "$studio_root/local-tools/ltx_server.py"
  exit_code=$?
  print "[ltx-supervisor] LTX exited with code=$exit_code" >&2
  # A media request can terminate the HTTP process while the kernel still
  # holds port 8770 briefly. Waiting here prevents the fallback restart from
  # racing the old process and entering an Address already in use loop.
  port=${LTX_VIDEO_PORT:-8770}
  for _ in {1..30}; do
    lsof -tiTCP:$port -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 1
  done
  # SIGTERM (143) and SIGINT (130) are clean exits from a restart/update.
  # Only fall back to CPU when MPS actually crashed with an unexpected error.
  if [[ "$device" == "mps" && "$exit_code" != "143" && "$exit_code" != "130" && "$exit_code" != "0" ]]; then
    device=cpu
    print "[ltx-supervisor] retrying with CPU fallback (exit_code=$exit_code)" >&2
  else
    if [[ "$exit_code" == "143" || "$exit_code" == "130" || "$exit_code" == "0" ]]; then
      print "[ltx-supervisor] clean exit, restarting with device=$device" >&2
    fi
    sleep 2
  fi
done
