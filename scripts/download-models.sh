#!/usr/bin/env bash
# Download every weight the Spark stack needs (~38 GB LLMs + ~71 GB image/video).
# Safe to re-run: finished files are skipped and partial downloads resume.
#   HF_ENDPOINT=https://hf-mirror.com scripts/download-models.sh     # mainland mirror
set -uo pipefail
MODELS="${SPARK_MODEL_DIR:-/home/orion/models}"
export HF_HOME="$MODELS/hf" HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
command -v hf >/dev/null || { echo "Install the Hugging Face CLI first: pip install -U huggingface_hub" >&2; exit 1; }
mkdir -p "$MODELS"/comfyui/{diffusion_models,text_encoders,vae,loras}

retry() { for _ in 1 2 3 4 5 6 7 8; do "$@" && return 0; sleep 10; done; echo "FAILED: $*" >&2; return 1; }

# LLMs, served by vLLM from the shared Hugging Face cache.
for repo in \
  nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 \
  nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark \
  stepfun-ai/Step3-VL-10B-FP8
do retry hf download "$repo" >/dev/null && echo "done $repo"; done

# fetch <repo> <path in repo> <ComfyUI model folder>
fetch() {
  local target="$MODELS/comfyui/$3/$(basename "$2")"
  [ -s "$target" ] && { echo "have $target"; return 0; }
  retry hf download "$1" "$2" --local-dir "$MODELS/.staging/$1" >/dev/null \
    && mv "$MODELS/.staging/$1/$2" "$target" && echo "done $target"
}
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors diffusion_models
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors text_encoders
fetch Comfy-Org/Qwen-Image_ComfyUI split_files/vae/qwen_image_vae.safetensors vae
fetch lightx2v/Qwen-Image-Lightning Qwen-Image-Lightning-8steps-V1.0.safetensors loras
fetch Comfy-Org/Qwen-Image-Edit_ComfyUI split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors diffusion_models
fetch lightx2v/Qwen-Image-Lightning Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors loras
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors diffusion_models
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors text_encoders
fetch Comfy-Org/Wan_2.2_ComfyUI_Repackaged split_files/vae/wan2.2_vae.safetensors vae
rm -rf "$MODELS/.staging"
du -sh "$MODELS/hf" "$MODELS/comfyui"
