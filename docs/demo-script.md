# 演示视频（B 站 Demo）

成片：1920×1080，4 分 36 秒，有旁白。由 `scripts/demo-reel.py` 从仓库自己的产物生成：运行记录、被拒与通过的首帧、四支样片、消融评测结果和一段真实操作录屏。画面上的所有数字都从 `projects/*/reports` 与 `eval/results` 读取，不手工填写。样片或数据变化后，重跑一次即可重出。

```bash
# 旁白音色与样片相同（见 README“部署说明”中的配音一节）
export CINELOOM_TTS_ENGINE=qwen-tts CINELOOM_TTS_REF_WAV=runtime-data/step-audio/voices/male-2.wav
export CINELOOM_TTS_REF_TEXT="$(python3 -c "import json;print(json.load(open('runtime-data/step-audio/voices/voices.json'))['male-2']['text'])")"
python3 scripts/demo-reel.py --out ~/cineloom-demo/cineloom-demo.mp4
```

录屏段落来自 Studio 的录制模式：`scripts/record-studio.sh "<创意>"` 在工作台上真实提交一条创意，运行期间每隔几秒截一次 `?record=1` 页面；`scripts/compose-recording.py` 把截图排成 1920×1080 画面，右侧同步显示流水线最新写出的图片（按文件写入时间），右下角标注“实时录屏 · 约 35 分钟压缩播放”。

## 分段

| 时间 | 段落 | 画面 | 旁白要点 |
|---|---|---|---|
| 0:00 | 片头 | CineLoom 影织标题卡 | 把一句创意，织成一支成片 |
| 0:07 | 痛点 | 三栏：素材不能上云、返工按次计费、没人把关 | 现有工具的三个问题 |
| 0:30 | Studio 与 Harness | 工作台截图与八个阶段 | 每个阶段是一个加载了 Skill 的子智能体；代码管顺序和验收，模型管判断 |
| 0:45 | 实时录屏 | 创意逐字输入，运行日志逐行增加，右侧显示最新生成的图 | 真实的一次运行，约 35 分钟压缩为 40 秒 |
| 1:25 | 运行记录回放 | 气泡水那支的 `run.jsonl` 逐行出现，被拒项标红 | 每一步都过校验，被拒的候选带着原因重生成 |
| 1:59 | 先审后生成 | 咖啡第 1 稿被审稿智能体退回的理由、Jev 判读概率、通过稿 | 广告法扫描、独立审稿、Jev 三道关 |
| 2:20 | 定妆图与质检 | 定妆图、被拒的候选与理由、通过的候选、四格画面 | 整支片子是同一只罐；返工拦在生图阶段 |
| 2:44 | 四支成片 | 饮料、数码、护肤、食品各一支，有声 | 画面、配音、配乐全部本机生成 |
| 4:08 | 证据 | 带 / 不带 Skill 的对比表；一支片子的实测耗时与内存 | 每条规则都对应一次真实的翻车 |
| 4:26 | 收尾 | 架构图与仓库地址 | 代码在 GitHub 公开 |

B 站投稿的标题、简介、章节与标签见 [`bilibili.md`](bilibili.md)。
