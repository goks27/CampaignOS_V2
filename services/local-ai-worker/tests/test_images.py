from PIL import Image

from app.image_processor import downscale, load, pixel_diff
from tests.conftest import make_png


def test_downscale_keeps_original_dimensions():
    p = downscale(make_png(3200, 1600), 1600)
    assert (p.width, p.height, p.original_width, p.original_height) == (1600, 800, 3200, 1600)


def test_pixel_diff_finds_the_changed_block():
    design = load(make_png(400, 800))
    staging = load(make_png(800, 1600, box=(200, 400, 400, 600)))  # 2x size; black box at 100-200,200-300 in design scale
    ratio, regions, resized = pixel_diff(design, staging)
    assert resized.size == (400, 800)
    assert 0 < ratio < 0.2
    r = regions[0]
    assert 80 <= r.x <= 110 and 180 <= r.y <= 210 and 90 <= r.w <= 130


def test_identical_images_have_no_regions():
    img = load(make_png(300, 300))
    ratio, regions, _ = pixel_diff(img, img.copy())
    assert ratio == 0 and regions == []


def test_tall_staging_page_is_flagged():
    design = Image.new("RGB", (300, 300), "white")
    staging = Image.new("RGB", (300, 600), "white")
    _, regions, _ = pixel_diff(design, staging)
    assert regions and regions[-1].y == 300
