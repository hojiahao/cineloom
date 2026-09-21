# ComfyUI for DGX Spark (aarch64, GB10). The NGC PyTorch image ships a CUDA/PyTorch
# build validated for Blackwell on Arm; override PYTORCH_IMAGE to match your DGX OS release.
ARG PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:25.10-py3
FROM ${PYTORCH_IMAGE}
ARG COMFYUI_REF=master
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${COMFYUI_REF} https://github.com/comfyanonymous/ComfyUI /opt/ComfyUI
WORKDIR /opt/ComfyUI
# Keep the torch build from the base image; install everything else ComfyUI needs.
RUN grep -v -E '^(torch|torchvision|torchaudio)([=<>~ ]|$)' requirements.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir -r /tmp/requirements.txt
EXPOSE 8188
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
