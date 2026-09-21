# 十日谈 · 开发日志

每天记录：做了什么、卡在哪、怎么决定的。只写发生过的事和实测到的数。

## Day 1 · 2026-09-21

**定题。** 广告成片：需求 → 脚本 → 合规 → 分镜 → 生图 → 质检 → 生视频 → 成片，全部跑在一台 DGX Spark 上。理由是未发布新品素材不能上云，以及按条计费让反复修改变贵。

**选模型。** 在 Hugging Face 上逐个核对了体积：
- Nemotron 3.5 Lightning 30B-A3B NVFP4 为 21.6 GB，官方另有为 DGX Spark 调优的 DSpark 投机解码权重 1.3 GB，模型卡里有单机 Spark 的 vLLM 配方。模型卡列出的支持语言不含中文。
- Step3-VL-10B-FP8 为 15.1 GB。
- Step-3.7-Flash 的 NVFP4 版 129 GB，超过本机 121.7 GB 统一内存；GGUF IQ4_XS 为 105 GB，加视觉投影和运行时约 116 GB，和扩散模型无法共存。决定走 API，并在记录中标注 cloud。
- 结论：Nemotron 做规划和英文提示词，StepFun 做中文和看图，正好对上“内部用英文、对用户用中文”的分工。

**踩坑。**
- `docker stats` 在 GB10 上看不到 CUDA 占用：一个实占约 100 GB 的推理容器只显示 4.3 GiB。此后一律以 `/proc/meminfo` 的可用内存为准，并写进了 `spark-model-scheduler`。
- 代理间歇性 503，Hugging Face 直连几乎为零；改用 hf-mirror 直连实测约 43 MB/s。
- DeepSeek Harness 的 `sdk-minimal` 配置只带 DeepSeek 专用适配器，调本地 OpenAI 兼容端点返回 HTTP 400。本地模型应走“自定义提供方 + openai-completions”，待验证。

**写代码。** TypeScript CLI `cineloom`（10 个子命令）、Studio 看板、4 个 ComfyUI 工作流模板、9 个 Skill 和 20 条评测任务。16 个测试通过，其中端到端测试用真实 ffmpeg 加 ComfyUI 桩服务，从立项走到成片。

**实测数据。** 本机统一内存 121.7 GB；内存预算 Nemotron 30 + Step3-VL 20 + ComfyUI 45 = 95 GB，预留 10 GB 后余量 16.7 GB。

**明天。** 在 Spark 上真实启动 vLLM 和 ComfyUI，过 `cineloom doctor`；接通 Harness 到本地模型；生成第一张首帧并记录耗时。
