# Step-Audio-EditX (StepFun, 3B, zero-shot voice cloning + style editing) for DGX Spark.
# Built on the vLLM image already proven on GB10; the model's own Dockerfile targets x86 CUDA 12.4.
ARG BASE_IMAGE=vllm/vllm-openai:v0.27.1
FROM ${BASE_IMAGE}
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sox libsox-fmt-all git && rm -rf /var/lib/apt/lists/*
# Inference-only dependencies (training extras such as deepspeed / llmcompressor are not needed).
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} librosa soundfile onnxruntime openai-whisper hyperpyyaml conformer \
    rotary-embedding-torch torch-complex sox ffmpeg-python typer omegaconf hdbscan modelscope "numpy>=2"
WORKDIR /app
ENTRYPOINT ["python3"]
