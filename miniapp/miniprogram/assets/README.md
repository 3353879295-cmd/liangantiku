# 实操页本地视觉素材

本目录中的实操页素材均为本项目工作流内新生成的文件，页面只通过
`/assets/practical/...` 本地路径引用。未使用外部图片网站、素材库或第三方图标包，
也不将本说明作为任何外部许可证或来源声明。

## `practical/rice-ear-hero.webp`

- 生成日期：2026-07-26
- 生成工具：OpenAI 内置 ImageGen（built-in `image_gen`）
- 用途：实操技能详情页横向稻穗照片 hero
- 项目使用范围与来源记录：由本项目工作流按下方提示词生成，允许用于本项目内的
  应用界面与项目发布物（含商业项目使用）；未引入外部图片来源，不对项目外再许可、
  独占性或与其他生成结果的相似性作保证。
- 后期处理：使用 Pillow 11.3 将内置工具输出的 1536 × 1024 RGB PNG 居中裁切为
  1536 × 864（16:9）；发布优化时保持相同构图，以 Lanczos 缩放至 1024 × 576，并按
  quality 78、method 6 重编码为 WebP。未添加文字、标识、水印、滤镜或合成元素。
- 人工检查：确认画面为自然低饱和稻穗近景，横向构图完整，无可见文字、标志或水印。
- 最终提示词：

```text
Use case: photorealistic-natural
Asset type: wide hero photograph for a grain-storage skills detail card in a Chinese WeChat mini program
Primary request: Create a natural close-up photograph of mature rice ears and grains in a field, with a few softly layered rice panicles as the clear subject.
Scene/backdrop: quiet rural rice field near harvest, softly blurred background, no people, no buildings, no tools, no added props.
Composition: landscape 3:2 framing suitable for a wide UI card crop; the rice ears occupy the central and lower-middle area with comfortable breathing room near the upper edge; realistic depth of field; avoid placing a single important detail at the extreme edge.
Lighting and palette: soft overcast or gentle late-afternoon natural light, low saturation, warm straw gold balanced with muted olive green, matte and calm, no dramatic sunset, no harsh highlights.
Realism details: photorealistic botanical structure, individual grains and fine awns visible, natural minor imperfections, documentary agricultural photography rather than a glossy stock-photo look.
Constraints: absolutely no text, no letters, no labels, no logos, no watermark, no border, no frame, no UI elements, no glow, no heavy vignette, no artificial plastic texture, no excessive yellow saturation.
Output intent: polished but understated local hero image that remains legible beneath no text overlays and can be cropped to a broad rounded card.
```

## 语义图标

五枚图标使用同一个确定性代码源
[`scripts/generate-practical-icons.py`](../../scripts/generate-practical-icons.py) 绘制。
统一规范为 256 × 256 不透明哑光米色方形底、深绿主线和低饱和棕色强调色，不使用
汉字、字母、emoji、文字字形或水印。选择不透明 tile 是为了避免透明度生成工作流及
不必要的模型降级。

| 文件                          | 生成日期   | 工具                                 | 用途                         | 项目使用范围与来源记录                                                             | 后期处理/人工调整                                                         |
| ----------------------------- | ---------- | ------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `practical/warehouse.png`     | 2026-07-26 | Python 3.12 + Pillow 11.3 确定性绘制 | 仓房巡查、入仓检查、通风作业 | 本项目代码原生绘制；允许用于本项目内界面与发布物（含商业项目使用），无外部素材来源 | 4 倍超采样后 Lanczos 缩至 256 px，并做 PNG 无损优化；人工确认仓房轮廓可辨 |
| `practical/thermometer.png`   | 2026-07-26 | Python 3.12 + Pillow 11.3 确定性绘制 | 异常升温与测温作业           | 本项目代码原生绘制；允许用于本项目内界面与发布物（含商业项目使用），无外部素材来源 | 同一渲染流程；人工确认温度计轮廓和刻度可辨                                |
| `practical/grain-pest.png`    | 2026-07-26 | Python 3.12 + Pillow 11.3 确定性绘制 | 储粮害虫检查与熏蒸安全       | 本项目代码原生绘制；允许用于本项目内界面与发布物（含商业项目使用），无外部素材来源 | 同一渲染流程；人工确认甲虫轮廓可辨                                        |
| `practical/sampler.png`       | 2026-07-26 | Python 3.12 + Pillow 11.3 确定性绘制 | 扦样、分样及样品检验作业     | 本项目代码原生绘制；允许用于本项目内界面与发布物（含商业项目使用），无外部素材来源 | 同一渲染流程；人工确认扦样器和粮粒轮廓可辨                                |
| `practical/moisture-test.png` | 2026-07-26 | Python 3.12 + Pillow 11.3 确定性绘制 | 水分检验与检验室作业         | 本项目代码原生绘制；允许用于本项目内界面与发布物（含商业项目使用），无外部素材来源 | 同一渲染流程；人工确认烧瓶、水位和水滴轮廓可辨                            |

图标不使用自然语言生成提示词；其等价绘制规范为：“以统一 10 px 视觉线宽绘制仓房、
温度计、甲虫、扦样器、烧瓶/水滴五类语义符号；限制为哑光米色、深绿、低饱和棕色；
不得包含汉字、字母、emoji、文字字形、水印、发光或粗重外框。”
