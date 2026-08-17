#!/usr/bin/env python3
"""把 record-demo.mjs FRAMES 模式产出的帧序列合成 GIF（无需 ffmpeg）。

用法：python scripts/assemble-gif.py <lang> <keep1_start> <keep1_end> <keep2_start> <keep2_end>
  时间区间为秒（相对 beats 的 t0，即脚本启动；帧号 ≈ t/0.28 + 启动偏移，容差 ±2 帧无碍）。
  例：python scripts/assemble-gif.py zh 0 9.5 21 40.5
"""
import json
import sys
from pathlib import Path

from PIL import Image

INTERVAL = 0.35  # 与 record-demo.mjs 的截帧间隔一致
WIDTH = 880


def main() -> None:
    lang, a1, a2, b1, b2 = sys.argv[1], *map(float, sys.argv[2:6])
    frames_dir = Path(f"/tmp/bridge-rec/frames-{lang}")
    frames = sorted(frames_dir.glob("*.png"))
    if not frames:
        raise SystemExit(f"无帧：{frames_dir}")

    # 帧号 → 秒：帧 1 大约在 t0+2s（浏览器启动+goto），用 beats 的 open 拍点校准
    beats = json.loads(Path(f"/tmp/bridge-rec/beats-{lang}.json").read_text())
    open_t = next(b["t"] for b in beats if b["name"] == "open")
    # 帧 i 的时间 ≈ open_t + (i-1)*INTERVAL - 1（goto 前已开始截帧，留 1s 余量）

    def t_of(i: int) -> float:
        return open_t - 1.0 + (i - 1) * INTERVAL

    keep = [f for i, f in enumerate(frames, 1) if (a1 <= t_of(i) <= a2) or (b1 <= t_of(i) <= b2)]
    print(f"总帧 {len(frames)}，保留 {len(keep)}")

    images = []
    for f in keep:
        im = Image.open(f).convert("RGB")
        ratio = WIDTH / im.width
        im = im.resize((WIDTH, int(im.height * ratio)), Image.LANCZOS)
        images.append(im)

    out = Path(f"assets/bridge-demo.{lang}.gif")
    out.parent.mkdir(exist_ok=True)
    first, rest = images[0], images[1:]
    first.save(
        out,
        save_all=True,
        append_images=rest,
        duration=int(INTERVAL * 1000),
        loop=0,
        optimize=True,
    )
    print(f"{out} {out.stat().st_size / 1e6:.1f}MB")


main()
