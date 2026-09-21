<p align="center">
  <img src="docs/assets/banner.svg" alt="CineLoom 影织" width="860">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d9b26a"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A5%2022-5fa04e">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.8-3178c6">
  <img alt="Platform" src="https://img.shields.io/badge/platform-NVIDIA%20DGX%20Spark%20(GB10%20%C2%B7%20aarch64)-76b900">
  <img alt="Agent Skills" src="https://img.shields.io/badge/Agent%20Skills-9-d9b26a">
  <img alt="Harness" src="https://img.shields.io/badge/harness-DeepSeek%20Harness-4d6bfe">
</p>

<p align="center">
  <a href="#项目说明">项目说明</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#部署说明">部署说明</a> ·
  <a href="#agent-skills">Agent Skills</a> ·
  <a href="#技术栈说明">技术栈</a> ·
  <a href="#当前状态">当前状态</a>
</p>

**CineLoom（影织）** 是一个跑在单台 NVIDIA DGX Spark 上的广告成片智能体。你说一句创意，它完成写脚本、审文案、排分镜、生图、质检、生视频、剪辑，交付一支可以直接发布的短片。素材和模型全程留在本机。

```text
> 给一款还没发布的无糖气泡水做一条 15 秒竖版广告，产品图在 refs/ 里

  ✓ 需求    确认受众与核心信息，立项 summer-soda（9:16 · 15s · 仅本地）
  ✓ 脚本    3 个节拍：钩子 / 证明 / 行动号召
  ✓ 合规    拦下“全网第一”“100%”，改写后通过
  ✓ 分镜    3 个镜头，统一风格行，产品参考图优先
  ✓ 生图    Qwen-Image · Spark 本地
  ✓ 质检    Step3-VL 复核产品一致性，镜头 2 重生成 1 次
  ✓ 生视频  Wan2.2 · 首帧驱动
  ✓ 成片    projects/summer-soda/cut/final.mp4
```

<sub>上面是流程示意，不是运行记录；真实运行数据见<a href="#当前状态">当前状态</a>。</sub>

> 第三届 NVIDIA DGX Spark 黑客松 · Agent Skills 开发挑战赛参赛作品 · 方舟团队

---

## 项目说明

### 解决什么问题

品牌方和中小商家做一条短视频广告，要经过策划、文案、分镜、拍摄或生成、剪辑五六个环节。现有的 AI 视频工具把这些环节接到了云端 API 上，带来三个实际问题：

- **未发布的新品素材不能上云。** 新品图、包装稿、代言人素材在发布前受保密约束，上传到第三方生成服务本身就是风险。
- **按条计费让迭代变贵。** 广告要反复改，一个镜头重生成五次是常态，云端视频生成按次收费，试错成本直接劝退。
- **生成结果没人把关。** 文案里一句“全网第一”、画面里一个变形的 logo，到了成片阶段才发现，整条重做。

### CineLoom 怎么做

CineLoom 把整条流水线搬到一台 DGX Spark 上，并把每个环节的专业判断写成 **Agent Skill**：

- **一个导演，九项技能。** [`AGENTS.md`](AGENTS.md) 定义导演智能体的流水线和底线规则；九个 Skill 分别封装需求澄清、脚本、合规、分镜、本地生成、质检、剪辑、拉片、内存调度的做法。Skill 是开放格式，换一个支持 Agent Skills 的客户端同样能用。
- **先审后生成。** 文案必须先过合规扫描（`cineloom copy-check`，对照《广告法》的确定性规则，本地、可复现），有 `block` 级问题的文案到不了生成环节。
- **先图后视频，中间有质检闭环。** 视频从过审的首帧生成；每张首帧由本地 StepFun 视觉模型对照产品参考图复核，不合格就按问题类型改提示词重生成，最多两次。把返工拦在几秒钟的生图阶段，而不是几分钟的生视频阶段。
- **一个内存池里排兵布阵。** GB10 的 CPU 和 GPU 共用约 121 GB 统一内存。`spark-model-scheduler` 先量后排：两个 LLM 常驻，扩散模型按阶段加载、用完释放。
- **过程对人可见。** 智能体每完成一个阶段就写入项目记录，[Studio 看板](#studio-看板) 实时显示阶段、每个素材的生成位置（本地 / 云端）、耗时和统一内存占用。

### 架构

<p align="center">
  <img src="docs/assets/architecture.png" alt="CineLoom 系统架构：创作者 → DeepSeek Harness 导演智能体 → Agent Skills → cineloom CLI → projects 记录 → Studio 看板；Nemotron、Step3-VL、ComfyUI 均在 DGX Spark 本地" width="820">
</p>

<p align="center"><sub>用 <a href="https://github.com/tt-a1i/archify">archify</a> 生成，showcase 档校验 9/9 通过。规格与可交互版本（缩放、搜索、关系追踪、明暗主题）：<a href="docs/architecture/cineloom.architecture.json">cineloom.architecture.json</a> · <a href="docs/architecture/cineloom-architecture.html">cineloom-architecture.html</a></sub></p>

设计取舍：

- **技能驱动命令行，而不是给框架写插件。** 每个 Skill 通过 `cineloom` 子命令做事，输入输出都是文件和 JSON。这样 Skill 不绑定某一个 Agent 框架，命令也能脱离智能体单独测试。
- **模型按语言和任务分工。** Nemotron 的官方支持语言不含中文，但擅长规划、工具调用和英文提示词，恰好生图生视频的提示词就是英文；中文文案和看图交给 StepFun。
- **记录即界面。** 看板只读 `projects/` 目录，不持有状态。智能体崩了重来，看板照常。

## 快速开始

```bash
git clone git@github.com:hojiahao/cineloom.git && cd cineloom
npm install && npm run build
npm test                      # 16 个测试，含一条从立项到成片的端到端流程

node dist/cli.js mem status   # 看统一内存
node dist/cli.js studio       # 看板：http://127.0.0.1:3090
```

不需要 GPU 就能试的两个命令：

```bash
echo "全网第一的气泡水，100%天然" | node dist/cli.js copy-check - --category food   # 合规扫描
node dist/cli.js shots some-ad.mp4 --out breakdown                                 # 参考片切镜
```

## 部署说明

### 1. 本地算力如何部署智能体

```bash
HF_ENDPOINT=https://hf-mirror.com scripts/download-models.sh   # 权重约 109 GB，可断点续传
scripts/spark-up.sh                                            # 起 Nemotron、Step3-VL、ComfyUI 并自检
```

`spark-up.sh` 会先检查统一内存余量（默认要求 95 GB 可用，不足则拒绝启动，避免模型加载到一半被杀），起好三个服务后运行 `cineloom doctor`，把工作流模板和正在运行的 ComfyUI 逐节点对一遍，缺节点、缺权重当场报出来。

然后让 DeepSeek Harness 接上本地模型，在本仓库目录里启动：

```bash
npx @deepseek-ai/dsh web      # 设置 → 模型 → 添加自定义提供方
```

两个提供方的写法见 [`deploy/spark/dsh-settings.example.yaml`](deploy/spark/dsh-settings.example.yaml)：协议选 `openai-completions`，地址分别是 `http://127.0.0.1:8001/v1`（Nemotron）和 `http://127.0.0.1:8002/v1`（Step3-VL）。Harness 会自动发现 `.agents/skills/` 下的全部 Skill 和根目录的 `AGENTS.md`。该配置同时关闭了 Harness 默认开启的会话日志上传。

### 2. 如何优化大模型

| 手段 | 做法 | 为什么 |
|---|---|---|
| NVFP4 量化 | Nemotron 3.5 Lightning 30B-A3B 用官方 NVFP4 权重，21.6 GB | 30B 参数只激活 3B，GB10 的内存带宽是瓶颈，权重越小解码越快 |
| 投机解码 | 搭配官方 `-DSpark` 草稿权重，`num_speculative_tokens=3` | NVIDIA 为 DGX Spark 低并发场景调优的方案，无损加速 |
| FP8 KV cache 与前缀缓存 | `--kv-cache-dtype fp8 --enable-prefix-caching` | 导演智能体每轮都带同一段系统提示和 Skill，前缀命中率高 |
| FP8 视觉模型 | Step3-VL-10B-FP8，15.1 GB；设 `VLLM_USE_DEEP_GEMM=0` | 质检要常驻，体积必须小。DeepGEMM 的 FP8 内核在 GB10 上断言失败，改走 vLLM 通用 FP8 路径 |
| 8 步蒸馏 LoRA | Qwen-Image + Lightning 8-step，cfg 1 | 把单张首帧压到可以反复重生成的量级 |
| 原生分辨率预算 | 超过 1328×1328 像素总量的请求先按预算生成再放大 | 扩散耗时随像素数增长，预算内生成、Lanczos 放大 |
| 分阶段显存调度 | vLLM 按总内存池比例预占（0.25 + 0.20），扩散模型按需加载，视频阶段结束调用 ComfyUI `/free` | 一个内存池，先常驻后按需 |

**本机实测（2026-09-21，DGX Spark，单请求）**

| 项目 | 实测值 |
|---|---|
| Nemotron 3.5 Lightning 解码速度（含 DSpark 投机解码，端到端） | 98–106 tok/s（900 token，两次） |
| Nemotron 工具调用一次往返 | 1.0 s，参数正确 |
| Nemotron 服务占用统一内存 | 约 35 GB（可用内存 108.6 → 73.6 GB） |
| Step3-VL-10B 权重加载 | 14.25 GiB，81.9 s |
| Step3-VL-10B KV cache（内存比例 0.20） | 47,616 token，32K 上下文可用 |
| 两个 LLM 同时常驻后的可用统一内存 | 47.6 GB |
| `cineloom qa` 单张首帧质检 | 首次 26 s（含预热），之后 10 s |

Nemotron 默认先推理再作答，推理内容计入 `max_tokens`；给得太小时正文会为空。

启动参数取自各模型卡的 DGX Spark 配方，完整写在 [`deploy/spark/compose.yaml`](deploy/spark/compose.yaml)。

### 3. 如何设计 Agent Skills

- **一个 Skill 只管一个判断。** “写脚本”和“审脚本”是两个 Skill，而且导演规则要求审查方不能是产出方。
- **description 写触发条件，不写功能介绍。** 每条都包含“什么时候用”和用户会说的原话（如“能不能这么说”“拉片”），智能体靠它决定加载哪个 Skill。
- **能确定的交给脚本，要判断的留给模型。** 广告法用词、切镜头、内存预算是确定性问题，由 `cineloom` 命令给出可复现的结果；是否有依据、怎么改写，才由模型判断。
- **写明失败分支。** 每个 Skill 都有“出错了怎么办”：质检不过怎么改提示词、切镜结果只有一个镜头怎么调阈值、工作流被拒先跑 `doctor`。
- **格式对齐 NVIDIA 官方 Skills 仓库。** frontmatter 带 `version`、`license`、`metadata`；每个 Skill 附 `evals/evals.json`（共 20 条任务，含正例和边界情况），用于“带 / 不带 Skill”的对比评测。

## Agent Skills

| Skill | 阶段 | 做什么 | 依赖的命令 / 模型 |
|---|---|---|---|
| [`ad-brief-intake`](.agents/skills/ad-brief-intake/SKILL.md) | 需求 | 只问阻塞项，其余自己定并说明，立项 | `cineloom project init` |
| [`ad-script-writing`](.agents/skills/ad-script-writing/SKILL.md) | 脚本 | 5 秒一个节拍，口播字数预算，首拍无声可懂 | Nemotron / Step3-VL |
| [`ad-compliance-review`](.agents/skills/ad-compliance-review/SKILL.md) | 合规 | 《广告法》用词筛查，`block` 级必须改写 | `cineloom copy-check` |
| [`ad-reference-breakdown`](.agents/skills/ad-reference-breakdown/SKILL.md) | 拉片 | 参考片切镜、逐镜描述、映射到新产品 | `cineloom shots` · Step3-VL |
| [`storyboard-design`](.agents/skills/storyboard-design/SKILL.md) | 分镜 | 统一风格行、单镜单动作、参考图分配 | Nemotron |
| [`spark-local-media-generation`](.agents/skills/spark-local-media-generation/SKILL.md) | 生图 / 生视频 | 本地生成，先图后视频 | `cineloom image` / `video` · Qwen-Image · Wan2.2 |
| [`shot-quality-gate`](.agents/skills/shot-quality-gate/SKILL.md) | 质检 | 产品一致性复核，按问题类型重生成，最多两次 | `cineloom qa` · Step3-VL |
| [`final-cut-assembly`](.agents/skills/final-cut-assembly/SKILL.md) | 成片 | 统一规格拼接、字幕、配乐、交付报告 | `cineloom cut` · ffmpeg |
| [`spark-model-scheduler`](.agents/skills/spark-model-scheduler/SKILL.md) | 贯穿 | 统一内存先量后排，分阶段加载释放 | `cineloom mem` |

## Studio 看板

`node dist/cli.js studio` 在 `http://127.0.0.1:3090` 提供只读看板：每个项目的八个阶段状态、按镜头排列的首帧和片段、每个素材的生成位置与实测耗时、成片播放，以及统一内存占用条。对话与技能调用过程在 DeepSeek Harness 的 Web 界面里看。

## 技术栈说明

**NVIDIA**

| 组件 | 用途 |
|---|---|
| DGX Spark（GB10 Grace Blackwell，aarch64，统一内存） | 全部推理与生成的运行平台 |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` | 导演智能体主模型：规划、工具调用、英文提示词 |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark` | 为 DGX Spark 调优的投机解码草稿权重 |
| NVFP4 量化（TensorRT Model Optimizer 产出的官方权重） | 降低权重体积与带宽压力 |
| NVIDIA Container Toolkit · NGC PyTorch 容器（arm64） | GPU 容器运行时；ComfyUI 的基础镜像 |
| CUDA | vLLM 与 ComfyUI 的计算后端 |
| [NVIDIA/skills](https://github.com/NVIDIA/skills) 规范 | Skill 的 frontmatter、`evals/`、评测报告格式对齐 |

**StepFun 阶跃星辰**

| 组件 | 用途 |
|---|---|
| `stepfun-ai/Step3-VL-10B-FP8`（本地，vLLM） | 中文文案润色；镜头质检；参考片逐镜理解 |
| Step-3.7-Flash（StepFun 开放平台 API，可选） | 创意总监级的方案发散。198B 参数，IQ4_XS 量化仍需约 116 GB，无法与扩散模型同机共存，因此走云端并在记录里标注 `cloud` |

**其他开源组件**

| 组件 | 用途 |
|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT） | Agent 运行时：Skill 发现与加载、子智能体、Web 界面 |
| vLLM | 两个 LLM 的 OpenAI 兼容服务 |
| ComfyUI · Qwen-Image / Qwen-Image-Edit-2509（含 Lightning 8-step LoRA） | 首帧生成；带产品参考图的生成；能渲染中文字 |
| ComfyUI · Wan2.2 TI2V-5B | 首帧驱动的 5 秒片段生成 |
| ffmpeg | 参考片切镜、尾帧续接、成片合成 |
| TypeScript · Node.js 22 · Vitest | CLI、看板与测试 |

## 当前状态

如实记录，随开发更新。

- [x] `cineloom` CLI 全部 10 个子命令，16 个测试通过；端到端测试走真实 ffmpeg，ComfyUI 用桩服务
- [x] 在本机 DGX Spark 上实测：`mem status` / `mem plan`、参考片切镜、合规扫描、Studio 看板
- [x] 9 个 Skill 与 20 条评测任务；Nemotron、DSpark 权重已下载
- [x] Nemotron 与 Step3-VL 已在本机 DGX Spark 上由 vLLM 真实启动；全部权重（约 109 GB）已下载
- [x] `cineloom qa` 在本地 Step3-VL 上真实跑通：符合要求的图 90 分通过，不符合的 30 分拒绝并指出缺失内容
- [ ] 启动 ComfyUI 并通过 `cineloom doctor`
- [ ] DeepSeek Harness 经自定义提供方接本地模型的完整链路
- [ ] 第一支真实成片，以及每个阶段的实测耗时和峰值内存
- [ ] “带 / 不带 Skill”对比评测，结果写入各 Skill 的 `BENCHMARK.md`
- [ ] 演示视频（B 站）与“十日谈”开发历程

本仓库不会出现未经实测的性能数字。

## 目录

```text
AGENTS.md                导演智能体的流水线与规则
.agents/skills/          9 个 Agent Skill（SKILL.md · references · evals）
src/                     cineloom CLI 与 Studio 看板（TypeScript）
workflows/               ComfyUI API 格式的工作流模板
deploy/spark/            本地推理栈（compose）、Harness 提供方配置
scripts/                 模型下载、一键启动
tests/                   单元测试与端到端流水线测试
```

## 致谢与许可

CineLoom 以 [MIT 许可证](LICENSE) 发布，版权归方舟团队所有。运行时依赖 DeepSeek Harness、vLLM、ComfyUI，以及 NVIDIA、StepFun、Qwen、Wan 团队开源的模型，各自遵循其许可证。用 CineLoom 生成并对外发布的内容，请按平台规范标注“AI 生成”。
