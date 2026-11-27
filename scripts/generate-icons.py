"""
Generates all app icons from one geometric definition.

    python scripts/generate-icons.py

Mark: Raijin as a horned oni head with a lightning-bolt face, in Bitcoin
orange. Same geometry as src/components/BrandMark.tsx.

Outputs (assets/images/):
  icon.png                       1024, full-bleed, no alpha (iOS + fallback)
  android-icon-foreground.png    1024, mark inside the adaptive-icon safe zone
  android-icon-background.png    1024, solid background
  android-icon-monochrome.png    1024, white mark for Android 13+ themed icons
  splash-icon.png                512, mark on transparent
  favicon.png                    48
  (desktop/build/icon.png is a copy of icon.png; copy it again after regenerating)
  notification-icon.png          96, white mark for Android notifications
  app-icons/<theme>(-foreground).png  alternate icons per theme

Requires Pillow (pip install pillow).
"""
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SS = 4  # supersampling factor for smooth edges

BG = (7, 8, 11)
ORANGE = (247, 147, 26)  # Bitcoin orange
WHITE = (255, 255, 255)

# The mark: Raijin as a horned oni head with a lightning-bolt face, in a
# 100x100 box. Paths use only M, L, C and Z (absolute). Keep in sync with
# src/components/BrandMark.tsx and the website's assets/img/mark.svg.
HORNS = [
    "M25 46 C17 38 14 26 19 12 C22 22 30 30 40 38 Z",
    "M75 46 C83 38 86 26 81 12 C78 22 70 30 60 38 Z",
]
HEAD = "M24 44 C20 54 21 68 27 78 C33 88 42 93 50 93 C58 93 67 88 73 78 C79 68 80 54 76 44 C70 36 30 36 24 44 Z"
# Cut out of the head (transparent): angry eyes and the bolt.
CUTS = [
    "M31 58 L45 62 L43.5 66.5 L32.5 63 Z",
    "M69 58 L55 62 L56.5 66.5 L67.5 63 Z",
    "M53.5 46 L45.5 66 L50.5 66 L46.5 87 L57 60 L52 60 L57 46 Z",
]
# The mark spans y 12..93; this shift centers it vertically.
CENTER_SHIFT = -2.5

VARIANTS = {
    "raijin": {"dir": ROOT / "assets" / "images", "head": ORANGE, "horns": ORANGE},
}


def path_points(d, steps=24):
    """Flattens an absolute M/L/C/Z path into a list of polygons (0..100 units)."""
    tokens = re.findall(r"[MLCZ]|-?\d*\.?\d+", d)
    polys, cur, i = [], [], 0
    pos = (0.0, 0.0)
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd == "M":
            if cur:
                polys.append(cur)
            pos = (float(tokens[i]), float(tokens[i + 1]))
            cur = [pos]
            i += 2
        elif cmd == "L":
            pos = (float(tokens[i]), float(tokens[i + 1]))
            cur.append(pos)
            i += 2
        elif cmd == "C":
            c1 = (float(tokens[i]), float(tokens[i + 1]))
            c2 = (float(tokens[i + 2]), float(tokens[i + 3]))
            end = (float(tokens[i + 4]), float(tokens[i + 5]))
            for k in range(1, steps + 1):
                t = k / steps
                u = 1 - t
                cur.append(tuple(u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * e
                                 for a, b, c, e in zip(pos, c1, c2, end)))
            pos = end
            i += 6
        elif cmd == "Z":
            pass
        else:
            raise ValueError(f"unsupported path command {cmd}")
    if cur:
        polys.append(cur)
    return polys


def draw_mark(size, head_color, horn_color, scale=1.0, bg=None, glow=True):
    """Draws the oni mark centered; scale=1.0 spans about 72% of the width.

    Eyes and bolt are cut out (transparent), so the background shows through.
    """
    S = size * SS

    def p(x, y):  # map a 0..100 coordinate around the center by `scale`
        return (((x / 100) - 0.5) * scale + 0.5) * S, ((((y + CENTER_SHIFT) / 100) - 0.5) * scale + 0.5) * S

    def mask_of(paths):
        m = Image.new("L", (S, S), 0)
        d = ImageDraw.Draw(m)
        for path in paths:
            for poly in path_points(path):
                d.polygon([p(x, y) for x, y in poly], fill=255)
        return m

    cuts = mask_of(CUTS)
    head = mask_of([HEAD])
    horns = mask_of(HORNS)
    head.paste(0, mask=cuts)
    full = Image.new("L", (S, S), 0)
    full.paste(255, mask=head)
    full.paste(255, mask=horns)

    img = Image.new("RGBA", (S, S), (bg + (255,)) if bg else (0, 0, 0, 0))
    if glow:
        halo = Image.new("RGBA", (S, S), head_color + (0,))
        halo.putalpha(full.point(lambda v: v * 90 // 255).filter(ImageFilter.GaussianBlur(S * 0.025 * scale)))
        img.alpha_composite(halo)
    img.paste(Image.new("RGBA", (S, S), horn_color + (255,)), mask=horns)
    img.paste(Image.new("RGBA", (S, S), head_color + (255,)), mask=head)
    if not bg:
        # Transparent layers: punch the cut-outs through everything below.
        alpha = img.getchannel("A")
        alpha.paste(0, mask=cuts)
        img.putalpha(alpha)
    else:
        img.paste(Image.new("RGBA", (S, S), bg + (255,)), mask=cuts)
    return img.resize((size, size), Image.LANCZOS)


def generate(name, cfg):
    out = cfg["dir"]
    out.mkdir(parents=True, exist_ok=True)
    head, horns = cfg["head"], cfg["horns"]

    # iOS rejects icons with alpha; the OS applies its own corner mask.
    draw_mark(1024, head, horns, bg=BG).convert("RGB").save(out / "icon.png")

    # Adaptive icon: only a 66dp circle of the 108dp layer is guaranteed visible;
    # scale 0.62 keeps the horn tips inside it.
    draw_mark(1024, head, horns, scale=0.62).save(out / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), BG + (255,)).save(out / "android-icon-background.png")
    draw_mark(1024, WHITE, WHITE, scale=0.62, glow=False).save(out / "android-icon-monochrome.png")

    draw_mark(512, head, horns).save(out / "splash-icon.png")
    draw_mark(48, head, horns, scale=1.15, bg=BG).save(out / "favicon.png")
    # Android notification icon: white on transparent, the system tints it.
    draw_mark(96, WHITE, WHITE, scale=1.15, glow=False).save(out / "notification-icon.png")
    print(f"{name}: wrote icons to {out.relative_to(ROOT)}")


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


# Alternate app icons, one per theme (expo-alternate-app-icons, see app.json).
# head = theme primary, horns = theme accent, background = theme bg.
# Keep in sync with src/theme.ts.
THEME_ICONS = {
    "terminal": ("#07080B", "#F7931A", "#00F0FF"),
    "matrix": ("#000000", "#00FF66", "#7DFFB2"),
    "amber": ("#0A0600", "#FFB000", "#FFD27A"),
    "cyberpunk": ("#0A0014", "#FF2E97", "#00F0FF"),
    "bitcoin": ("#0C0C0C", "#F7931A", "#FFC56B"),
    "oled": ("#000000", "#F7931A", "#9B4DFF"),
    "light": ("#F5F6FA", "#D9730B", "#0087A0"),
    "paper": ("#F4EFE6", "#7A3FD1", "#C2680A"),
}


def generate_theme_icons():
    out = ROOT / "assets" / "images" / "app-icons"
    out.mkdir(parents=True, exist_ok=True)
    for name, (bg, head, horns) in THEME_ICONS.items():
        bg, head, horns = hex_rgb(bg), hex_rgb(head), hex_rgb(horns)
        draw_mark(1024, head, horns, bg=bg).convert("RGB").save(out / f"{name}.png")
        draw_mark(1024, head, horns, scale=0.62).save(out / f"{name}-foreground.png")
    print(f"theme icons: wrote {len(THEME_ICONS)} variants to {out.relative_to(ROOT)}")


def generate_widget_preview():
    """Preview image for the Android widget picker (same layout as BalanceWidget)."""
    from PIL import ImageFont

    fonts_dir = ROOT / "node_modules" / "@expo-google-fonts" / "jetbrains-mono"
    bold = ImageFont.truetype(str(fonts_dir / "700Bold" / "JetBrainsMono_700Bold.ttf"), 34)
    small = ImageFont.truetype(str(fonts_dir / "400Regular" / "JetBrainsMono_400Regular.ttf"), 22)
    big = ImageFont.truetype(str(fonts_dir / "700Bold" / "JetBrainsMono_700Bold.ttf"), 64)
    W, H = 540, 330
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=30, fill=(11, 8, 18, 255), outline=(61, 47, 92, 255), width=3)
    mark = draw_mark(44, ORANGE, ORANGE, scale=1.25, glow=False)
    img.alpha_composite(mark, (26, 22))
    d.text((74, 28), "RAIJIN", font=bold, fill=(155, 77, 255))
    d.text((W - 32, 36), "home node", font=small, fill=(140, 125, 170), anchor="ra")
    d.text((32, 120), "21 000 sat", font=big, fill=(155, 77, 255))
    d.text((32, 205), "LN 18 000   ₿ 3 000", font=small, fill=(140, 125, 170))
    d.text((32, 275), "synced 2026-11-22 21:00", font=small, fill=(75, 64, 102))
    img.save(ROOT / "assets" / "images" / "widget-preview.png")
    print("widget preview: wrote assets/images/widget-preview.png")


if __name__ == "__main__":
    for variant, config in VARIANTS.items():
        generate(variant, config)
    generate_theme_icons()
    generate_widget_preview()
