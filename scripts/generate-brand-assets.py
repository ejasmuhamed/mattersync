#!/usr/bin/env python3
"""Render the original vector mark into app, adaptive, notification, and launch assets.

Run from any directory with Python 3 and Pillow installed. The SVG source uses only
rectangles and polygons, keeping the artwork editable without a proprietary tool.
"""

import json
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BRAND = json.loads((ROOT / 'assets/base/branding/brand.json').read_text())
MARK = ET.parse(ROOT / 'assets/base/branding/mark.svg').getroot()
SCALE = 4
ADAPTIVE_INSET = 0.085
COUNT = 0


def mark(size, *, background=True, monochrome=False, light=False, inset=0):
    canvas = Image.new('RGBA', (size * SCALE, size * SCALE))
    draw = ImageDraw.Draw(canvas)
    ratio = (size - inset * 2) * SCALE / 256
    offset = inset * SCALE

    def coordinate(value):
        return float(value) * ratio + offset

    def color(value, role=None):
        if monochrome:
            return (0, 0, 0, 0) if role == 'detail' else '#FFFFFF'
        if light and value == '#FFFFFF':
            return BRAND['background']
        if light and value == BRAND['accent']:
            return '#008C78'
        return value

    for item in MARK:
        kind = item.tag.rsplit('}', 1)[-1]
        role = item.get('data-role')
        if kind not in ('rect', 'polygon') or (role == 'background' and not background):
            continue
        fill = color(item.get('fill'), role)
        if kind == 'rect':
            x, y = coordinate(item.get('x', 0)), coordinate(item.get('y', 0))
            width, height = float(item.get('width')) * ratio, float(item.get('height')) * ratio
            radius = float(item.get('rx', 0)) * ratio
            stroke = float(item.get('stroke-width', 0)) * ratio
            if stroke:
                seam = BRAND['background'] if background else (0, 0, 0, 0)
                draw.rounded_rectangle((x-stroke/2, y-stroke/2, x+width+stroke/2, y+height+stroke/2), radius+stroke/2, fill=seam)
            draw.rounded_rectangle((x+stroke/2, y+stroke/2, x+width-stroke/2, y+height-stroke/2), max(0, radius-stroke/2), fill=fill)
        else:
            points = [tuple(coordinate(v) for v in point.split(',')) for point in item.get('points').split()]
            draw.polygon(points, fill=fill)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def save(image, path, *, opaque=False):
    global COUNT
    path.parent.mkdir(parents=True, exist_ok=True)
    if opaque:
        image = image.convert('RGB')
    temporary = path.with_name('.' + path.name + '.tmp')
    image.save(temporary, format='PNG', optimize=True)
    temporary.replace(path)
    COUNT += 1


def write_existing_icons():
    base = ROOT / 'assets/base/release/icons'
    for path in (base / 'ios').glob('*.png'):
        size = Image.open(path).width
        image = mark(size)
        save(image, path, opaque=True)
        save(image, ROOT / 'ios/Mattermost/Images.xcassets/AppIcon.appiconset' / path.name, opaque=True)
    for density in ('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'):
        folder = base / 'android' / f'mipmap-{density}'
        for path in folder.glob('*.png'):
            if path.stem == 'ic_launcher_monochrome':
                continue  # Generated separately below; never replace the mask with colored artwork.
            size = Image.open(path).width
            if path.stem == 'ic_launcher_background':
                image = Image.new('RGB', (size, size), BRAND['background'])
            elif path.stem == 'ic_launcher_foreground':
                image = mark(size, background=False, inset=round(size * ADAPTIVE_INSET))
            elif path.stem == 'ic_notification':
                image = mark(size, background=False, monochrome=True)
            else:
                image = mark(size)
                if path.stem == 'ic_launcher_round':
                    mask = Image.new('L', image.size)
                    ImageDraw.Draw(mask).ellipse((0, 0, size-1, size-1), fill=255)
                    image.putalpha(mask)
            save(image, path)
            save(image, ROOT / 'android/app/src/main/res' / f'mipmap-{density}' / path.name)
        mono_size = Image.open(folder / 'ic_launcher_foreground.png').width
        monochrome = mark(mono_size, background=False, monochrome=True, inset=round(mono_size * ADAPTIVE_INSET))
        for target in (folder, ROOT / 'android/app/src/main/res' / f'mipmap-{density}'):
            save(monochrome, target / 'ic_launcher_monochrome.png')


def write_splash_assets():
    base = ROOT / 'assets/base/release/splash_screen'
    for path in base.rglob('*.png'):
        if path.name == 'ic_notif_action_reply.png':
            continue  # Generic reply action glyph; not an app logo.
        size = Image.open(path).size
        dark = 'night-' in str(path) or 'Dark' in path.name or '_Dark' in path.name
        if 'Background' in path.name or 'background' in path.name:
            image = Image.new('RGB', size, BRAND['darkBackground' if dark else 'lightBackground'])
        else:
            image = mark(size[0], background=False, light=not dark)
        save(image, path)
        relative = path.relative_to(base)
        if relative.parts[0] == 'android':
            save(image, ROOT / 'android/app/src/main/res' / Path(*relative.parts[1:]))
        elif len(relative.parts) > 2:
            save(image, ROOT / 'ios/Mattermost/Images.xcassets' / Path(*relative.parts[1:]))
    for name in ('icon.png', 'logo.png'):
        path = ROOT / 'assets/base/images' / name
        size = Image.open(path).width
        save(mark(size), path)


def write_store_graphics():
    folder = ROOT / 'fastlane/metadata/android/en-US/images'
    for name, size in [('featureGraphic.png', (1024, 500)), ('tvBanner.png', (1280, 720))]:
        image = Image.new('RGB', size, BRAND['background'])
        draw = ImageDraw.Draw(image)
        icon_size = round(size[1] * 0.58)
        icon = mark(icon_size)
        image.paste(icon, (40, (size[1] - icon_size) // 2), icon)
        left = icon_size + 64
        title_font = ImageFont.truetype(str(ROOT / 'assets/fonts/OpenSans-SemiBold.ttf'), round(size[0] * 0.064))
        body_font = ImageFont.truetype(str(ROOT / 'assets/fonts/OpenSans-Regular.ttf'), round(size[0] * 0.024))
        draw.text((left, round(size[1] * 0.35)), BRAND['name'], font=title_font, fill=BRAND['foreground'])
        draw.text((left, round(size[1] * 0.55)), 'Channels. Threads. Voice.', font=body_font, fill=BRAND['accent'])
        draw.text((left, round(size[1] * 0.65)), 'By ' + BRAND['publisher']['name'], font=body_font, fill=BRAND['foreground'])
        save(image, folder / name, opaque=True)


write_existing_icons()
write_splash_assets()
write_store_graphics()
save(mark(1024), ROOT / 'assets/base/branding/app-icon.png', opaque=True)
save(mark(512), ROOT / 'fastlane/metadata/android/en-US/images/icon.png', opaque=True)
save(mark(512), ROOT / 'assets/base/branding/preview.png', opaque=True)
print(f'Generated {COUNT} Mattersync branding images.')
