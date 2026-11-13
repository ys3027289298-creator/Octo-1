# 声道音量 / 静音控制 — 交付报告

改造内容：音频链路由 `ScriptProcessor(单声道) → 主增益 → destination` 改为
`ScriptProcessor(单声道) → 主增益 → [左增益, 右增益] → ChannelMerger(2) → destination`。
每个声道（左/右）有独立音量（0–1）与可切换静音，全部经 `setTargetAtTime`
指数过渡（`AUDIO_RAMP_TAU = 0.02s`，见 `js/shared.js`），并随 `octoOptions`
持久化（`optionFlags` 新增 4 项），重启后自动恢复。

复现验证：`node tools/AudioVerify/verify.js <改造前shared.js> <改造后shared.js>`
（改造前版本用 `git show HEAD~:js/shared.js` 或提交前 stash 取得）。采样率 48000 Hz。

## 1. 改造前后对比数据（同一组输入）

三组固定输入（pattern / pitch / 时长），改造前后各跑一遍 `playPattern`：

| 输入 | 样本数 | SHA-256（改造前） | SHA-256（改造后） | 一致 |
|---|---|---|---|---|
| pattern-A, pitch=64, 0.10s | 4800 | e5e6342d…08c5703b | e5e6342d…08c5703b | ✅ |
| pattern-B, pitch=100, 0.05s | 2400 | 5f75b1e2…ad15f0568 | 5f75b1e2…ad15f0568 | ✅ |
| silence, pitch=64, 0.02s | 960 | a8eac8b0…b2429576 | a8eac8b0…b2429576 | ✅ |

输出链路对比（同一组输入）：旧链路 `out = s × 0.25`；新链路
`out = s × 0.25 × 声道增益(默认 1.0)`。IEEE-754 下 `x × 1.0 === x`，
全部 8160 个样本逐一相等（harness 第 2 节 PASS）。

## 2. 失败路径：可复现步骤与预期错误

UI 复现：打开 Audio Editor → 在 Volume level / Left volume / Right volume
中输入非法值并失焦（onchange）：
- 输入 `-0.1` 或 `1.5` → `#audio-error` 显示
  `Volume must be between 0 and 1, got <值>.`，输入框回退为当前生效值，
  不写入 localStorage，音频图不变。
- 输入 `abc` 或留空 → 显示 `Volume must be a number, got "<输入>".`，同上回退。

程序化复现（harness 第 4 节，全部 PASS）：

| 输入 | 结果 | 预期错误 |
|---|---|---|
| `0.25` / `0` / `1` / ` 0.5 ` | ok，value=解析值 | — |
| `-0.1` / `1.5` | ok=false | `Volume must be between 0 and 1, got …` |
| `abc` / `""` / `NaN` / `Infinity` | ok=false | `Volume must be a number, got "…"` |

注意：旧代码 `Math.max(0, Math.min(+v))` 只钳下界、无上限、无报错，且
`NaN` 会静默写入；新代码对越界/非数值一律报错并拒绝。

## 3. 资源 / 内存上界

- 音频图节点：固定新增 2 个 GainNode + 1 个 ChannelMergerNode，O(1)，
  不随播放时长/样本数增长；`stopAudio()` 全部 disconnect。
- 每样本分配：零。样本生成仍复用既有 `Float32Array`，增益由 Web Audio
  原生应用；`applyAudioChannels` 只写 3 个 AudioParam。
- 样本队列上界不变：`AudioControl.refresh` 截断到 ≤ 8 个 buffer，
  `onaudioprocess` 再按 `bufferSize`（≤8192 样本）截断，总量
  ≤ 8 × ceil(sampleRate × 单次时长) 个 float32，与改造前相同。
- 持久化：localStorage `octoOptions` 新增 4 个键（2 number + 2 boolean），
  每条 < 64 字节。
- CPU：每次音量/静音操作 O(1)（3 次 param 调用）；指数过渡由原生
  AudioParam 在每样本 O(1) 完成，与旧链路同阶。

## 4. 旧行为逐样本一致性验证

- 样本生成：`playPattern` 及其依赖（低通滤波、超采样）未改动；
  第 1 节三组输入 SHA-256 全部相同 = 逐位一致。
- 输出链路：默认设置（声道音量 1.0、未静音）下，新增声道增益为乘以 1.0，
  是 IEEE-754 恒等运算，主增益值不变，因此每个输出样本与旧链路逐位相等
  （harness 第 2 节 PASS）。`onaudioprocess` 回调逐行未改。
- 既有 jasmine 规格（`packOptions`/`unpackOptions` 等）不受影响；
  新增 `validateVolume` 与声道选项往返规格见 `jasmine/spec/shared.spec.js`。

## 5. 静音切换无阶跃爆音：切换前后各 100 样本

输入：pattern-A（含 0xFF 全高电平段），主音量 0.25，在样本 #2400
（t=0.0500s）处将左声道静音（增益 1 → 0）。完整 200 样本见
`mute-toggle-samples.txt`（index / source / smooth / hard 四列），关键片段：

```
 index |     source |  smooth(新) |   hard(若阶跃)
  2397 |  0.24999997 |  0.24999997 |   0.24999997
  2398 |  0.25000000 |  0.25000000 |   0.25000000
  2399 |  0.25000000 |  0.25000000 |   0.25000000
  2400 |  0.17587595 |  0.17587595 |   0.17587595   ← 切换瞬间
  2401 |  0.06294611 |  0.06288058 |   0.00000000   ← 阶跃法一样本内跌落
  2402 |  0.01539231 |  0.01536028 |   0.00000000
  2403 |  0.00303411 |  0.00302464 |   0.00000000
```

- 切换瞬间样本幅度：0.17587595（smooth 与 source 完全相同，增益包络在
  切换点连续，step = 0）。
- 窗口 [2300, 2500) 内相邻样本最大跳变：smooth = 0.11299537，
  source 自身 = 0.11292984；超出部分 ≤ 包络每样本衰减界
  |s|×(1−e^(−1/960)) ≤ 0.00026，判定无上界外跳变（PASS）。
- 对照：若直接阶跃静音，边界单样本跳变 0.17587595（满幅瞬时跌落 = 爆音）。
