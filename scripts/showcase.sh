#!/usr/bin/env bash
# Produce the showcase films one after another. Sequential on purpose: one GPU, one memory pool.
set -uo pipefail
cd "$(dirname "$0")/.."
run() { # id, brief
  echo "=== $(date '+%H:%M:%S') $1"
  rm -rf "projects/$1"
  node dist/cli.js harness "$2" --id "$1" 2>&1 | grep -E "^▸|error|wallSeconds|qaRegenerations" | cut -c1-220
}
run show-soda     "给一款叫“冷”的无糖气泡水做一条 15 秒竖版短视频广告，面向大学生，夏天。电影质感：微距、冰、气泡、逆光，节奏克制。产品是银色铝罐，青绿色标签上有白色书法字“冷”。"
run show-coffee   "给一款叫“醒”的挂耳咖啡做一条 15 秒横版广告，面向清晨通勤的上班族。电影质感：晨光、蒸汽、慢倒的热水、深色木桌，温暖克制。产品是牛皮纸色的挂耳咖啡包装盒，正面有黑色衬线字“醒”。"
run show-cream    "给国货保湿面霜“润”做一条 15 秒竖版广告，面向 25 到 35 岁女性，质感高级、安静。电影质感：乳白与暖金、柔光、水波与霜体纹理的微距。产品是磨砂白色圆罐，金色盖子，罐身有金色细体字“润”。"
run show-keyboard "给机械键盘“青”做一条 15 秒横版广告，面向程序员，利落、有科技感。电影质感：暗调、冷色轮廓光、按键微距、键帽背光逐排亮起。产品是深灰色铝合金机械键盘，空格键上方有一枚小小的青色“青”字铭牌。"
echo "=== $(date '+%H:%M:%S') SHOWCASE_DONE"
