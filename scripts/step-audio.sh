#!/usr/bin/env bash
# Run Step-Audio-EditX (StepFun) inference in the local container. Arguments are passed to tts_infer.py.
#   scripts/step-audio.sh --prompt-audio /work/ref.wav --prompt-text "..." --generated-text "..." --edit-type clone --output-dir /work/out
# Paths given to the model must be inside /work (= runtime-data/step-audio) or /app/examples.
set -euo pipefail
cd "$(dirname "$0")/.."
EDITX=$(ls -d /home/orion/models/hf/hub/models--stepfun-ai--Step-Audio-EditX/snapshots/*/ | head -1)
TOK=$(ls -d /home/orion/models/hf/hub/models--stepfun-ai--Step-Audio-Tokenizer/snapshots/*/ | head -1)
mkdir -p runtime-data/step-audio
docker run --rm --device nvidia.com/gpu=all --ipc=host --network host \
  -v "$PWD/runtime-data/Step-Audio-EditX:/app" -v "$EDITX:/models/editx:ro" -v "$TOK:/models/tokenizer:ro" \
  -v "$PWD/runtime-data/step-audio:/work" -v /home/orion/models/hf:/root/.cache/huggingface \
  -e HF_HUB_OFFLINE=1 -e MODELSCOPE_CACHE=/work/.modelscope -e PYTHONPATH=/app \
  cineloom/step-audio:local tts_infer.py --model-path /models/editx --tokenizer-path /models/tokenizer --model-source local \
  --gpu-memory-utilization "${STEP_AUDIO_GPU_MEM:-0.12}" --max-model-len 3072 --enforce-eager --cosyvoice-dtype bfloat16 "$@"
