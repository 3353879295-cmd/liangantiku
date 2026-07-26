"""Render the practical-skill icon family as deterministic local PNG assets."""

from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw


SCALE = 4
SIZE = 256
BACKGROUND = "#F1EADB"
INK = "#355C4B"
ACCENT = "#B37A34"
LINE_WIDTH = 10
ASSET_DIR = Path(__file__).resolve().parents[1] / "miniprogram" / "assets" / "practical"


def scaled(point: tuple[int, int]) -> tuple[int, int]:
    return (point[0] * SCALE, point[1] * SCALE)


def line(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    *,
    fill: str = INK,
    width: int = LINE_WIDTH,
) -> None:
    rendered = [scaled(point) for point in points]
    rendered_width = width * SCALE
    draw.line(rendered, fill=fill, width=rendered_width, joint="curve")
    radius = rendered_width // 2
    for x, y in (rendered[0], rendered[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def ellipse(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    fill: str | None = None,
    outline: str = INK,
    width: int = LINE_WIDTH,
) -> None:
    draw.ellipse(
        tuple(value * SCALE for value in box),
        fill=fill,
        outline=outline,
        width=width * SCALE,
    )


def rounded_rectangle(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    radius: int,
    fill: str | None = None,
    outline: str = INK,
    width: int = LINE_WIDTH,
) -> None:
    draw.rounded_rectangle(
        tuple(value * SCALE for value in box),
        radius=radius * SCALE,
        fill=fill,
        outline=outline,
        width=width * SCALE,
    )


def draw_warehouse(draw: ImageDraw.ImageDraw) -> None:
    line(draw, [(51, 112), (128, 55), (205, 112)])
    line(draw, [(66, 105), (66, 195), (190, 195), (190, 105)])
    rounded_rectangle(draw, (102, 130, 154, 195), radius=8)
    line(draw, [(84, 123), (172, 123)], fill=ACCENT, width=8)
    line(draw, [(84, 143), (84, 177)], fill=ACCENT, width=8)


def draw_thermometer(draw: ImageDraw.ImageDraw) -> None:
    rounded_rectangle(draw, (104, 48, 151, 162), radius=24)
    ellipse(draw, (85, 142, 171, 228), fill=BACKGROUND)
    line(draw, [(128, 79), (128, 180)], fill=ACCENT, width=9)
    ellipse(draw, (107, 159, 149, 201), fill=ACCENT, outline=ACCENT, width=4)
    line(draw, [(160, 88), (183, 88)], width=7)
    line(draw, [(160, 116), (176, 116)], width=7)


def draw_grain_pest(draw: ImageDraw.ImageDraw) -> None:
    ellipse(draw, (82, 76, 174, 204), fill=BACKGROUND)
    ellipse(draw, (99, 48, 157, 98), fill=BACKGROUND)
    line(draw, [(128, 91), (128, 191)], width=7)
    line(draw, [(103, 59), (82, 41)], width=7)
    line(draw, [(153, 59), (174, 41)], width=7)
    for y, offset in [(106, 0), (137, 8), (168, 0)]:
        line(draw, [(88, y), (58 - offset, y - 14)], width=7)
        line(draw, [(168, y), (198 + offset, y - 14)], width=7)
    ellipse(draw, (118, 105, 138, 125), fill=ACCENT, outline=ACCENT, width=3)


def draw_sampler(draw: ImageDraw.ImageDraw) -> None:
    line(draw, [(71, 191), (169, 93)], width=16)
    line(draw, [(91, 211), (189, 113)], width=16)
    line(draw, [(64, 186), (96, 218)], fill=ACCENT, width=13)
    line(draw, [(164, 78), (204, 118)], fill=ACCENT, width=13)
    ellipse(draw, (154, 120, 170, 136), fill=BACKGROUND, outline=BACKGROUND, width=2)
    ellipse(draw, (132, 142, 148, 158), fill=BACKGROUND, outline=BACKGROUND, width=2)
    line(draw, [(64, 145), (88, 145)], width=7)
    ellipse(draw, (50, 135, 65, 151), fill=ACCENT, outline=ACCENT, width=2)
    ellipse(draw, (79, 131, 94, 147), fill=ACCENT, outline=ACCENT, width=2)


def draw_moisture_test(draw: ImageDraw.ImageDraw) -> None:
    line(draw, [(102, 50), (154, 50)], width=9)
    line(draw, [(112, 54), (112, 102), (75, 180), (78, 198), (178, 198), (181, 180), (144, 102), (144, 54)])
    line(draw, [(91, 158), (165, 158)], fill=ACCENT, width=8)
    ellipse(draw, (107, 168, 126, 187), fill=ACCENT, outline=ACCENT, width=2)
    line(draw, [(183, 71), (199, 95), (215, 71)], fill=ACCENT, width=8)
    ellipse(draw, (181, 86, 217, 122), fill=BACKGROUND, outline=ACCENT, width=8)


def render_icon(filename: str, painter: Callable[[ImageDraw.ImageDraw], None]) -> None:
    image = Image.new("RGB", (SIZE * SCALE, SIZE * SCALE), BACKGROUND)
    painter(ImageDraw.Draw(image))
    image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(
        ASSET_DIR / filename,
        format="PNG",
        optimize=True,
    )


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    painters = {
        "warehouse.png": draw_warehouse,
        "thermometer.png": draw_thermometer,
        "grain-pest.png": draw_grain_pest,
        "sampler.png": draw_sampler,
        "moisture-test.png": draw_moisture_test,
    }
    for filename, painter in painters.items():
        render_icon(filename, painter)


if __name__ == "__main__":
    main()
