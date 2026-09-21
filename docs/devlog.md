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

**下午：两个模型在 Spark 上真实跑起来。**
- 本机 Docker 通过 CDI（`nvidia.com/gpu=all`）暴露 GPU，没有注册 `nvidia` 运行时，compose 里的 `runtime: nvidia` 直接报错，改成 CDI 设备声明。
- Nemotron 一次启动成功。实测端到端解码 98–106 tok/s，工具调用 1.0 s 且参数正确；服务实占约 35 GB，比计划的 30 GB 多，预算表按实测改。900 个 token 全部用在推理上、正文为空，说明 `max_tokens` 要给够。
- Step3-VL-10B-FP8 连续崩溃重启。第一层原因是 DeepGEMM 的 FP8 内核在 GB10 上断言失败（Unknown SF transformation），设 `VLLM_USE_DEEP_GEMM=0` 解决。第二层原因是我给的内存比例 0.17 只剩约 2 GiB 给 KV cache。先试着降上下文长度，降了两次都差一点，方向错了；改成把比例提到 0.20，KV cache 47,616 token，32K 上下文保住。
- `cineloom qa` 在本地 Step3-VL 上跑通：同一张图，要求相符给 90 分通过，要求不符给 30 分拒绝并说出缺了什么。首次 26 s，之后 10 s。
- 两个 LLM 常驻后可用统一内存 47.6 GB，够扩散模型用。

**README。** 横幅改成 ANSI Shadow 方块字，方块画成矩形、文字转成 Google Sans Code 轮廓，不依赖访问者字体。架构图用 archify 生成，showcase 档 9/9 通过；横向五列放进 README 后字太小，改成竖向主线。截图时抹像素去工具栏连错两次，最后改为在临时副本里用 CSS 隐藏控件。

**明天。** 启动 ComfyUI，过 `cineloom doctor`；生成第一张首帧和第一段视频并记录耗时；接通 Harness 到本地模型。
