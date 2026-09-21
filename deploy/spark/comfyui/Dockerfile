# ComfyUI for DGX Spark (aarch64, GB10).
# Built on the vLLM image because its PyTorch/CUDA build is already proven on GB10 by the
# two LLM services, which avoids carrying a second multi-gigabyte CUDA base image.
# Build context is a ComfyUI checkout (scripts/spark-up.sh clones it into runtime-data/ComfyUI).
ARG BASE_IMAGE=vllm/vllm-openai:v0.27.1
FROM ${BASE_IMAGE}
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/ComfyUI
COPY . /opt/ComfyUI
# Keep the torch stack from the base image. The workflow-templates package only carries
# example graphs for the web UI and pulls hundreds of MB of media sub-packages (which
# mirrors lag behind on), so it is installed without its dependencies.
RUN grep -v -E '^(torch|torchvision|torchaudio|comfyui-workflow-templates)([=<>~ ]|$)' requirements.txt > /tmp/requirements.txt \
    && pip install --no-cache-dir -i ${PIP_INDEX_URL} -r /tmp/requirements.txt \
    && pip install --no-cache-dir -i ${PIP_INDEX_URL} --no-deps "$(grep -E '^comfyui-workflow-templates' requirements.txt)"
EXPOSE 8188
ENTRYPOINT ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
