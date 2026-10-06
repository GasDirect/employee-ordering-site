#!/usr/bin/env python3
"""
Validate data/products.json and repository-hosted product images.

Designed for both local use and GitHub Actions.

Exit codes:
  0 = catalog is valid (warnings may still be printed)
  1 = blocking validation errors were found
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "products.json"
PRODUCT_IMAGE_ROOT = ROOT / "assets" / "products"

ALLOWED_RETAILERS = {
    "Sam's Club": "sams",
    "Walmart": "walmart",
    "Aldi": "aldi",
}
REQUIRED_PRODUCT_FIELDS = (
    "id",
    "retailer",
    "retailerKey",
    "category",
    "brand",
    "productName",
    "packCount",
    "priceDisplay",
    "active",
    "displayOrder",
)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^(sams|walmart|aldi)-[A-Za-z0-9_-]+$")

errors: list[str] = []
warnings: list[str] = []


def gh_escape(value: str) -> str:
    return (
        str(value)
        .replace("%", "%25")
        .replace("\r", "%0D")
        .replace("\n", "%0A")
    )


def report_error(message: str) -> None:
    errors.append(message)
    if os.getenv("GITHUB_ACTIONS") == "true":
        print(f"::error file=data/products.json::{gh_escape(message)}")


def report_warning(message: str) -> None:
    warnings.append(message)
    if os.getenv("GITHUB_ACTIONS") == "true":
        print(f"::warning file=data/products.json::{gh_escape(message)}")


def nonempty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def normalized(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def load_catalog():
    if not DATA.is_file():
        report_error("data/products.json does not exist.")
        return None

    try:
        with DATA.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        report_error(
            f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        )
        return None
    except OSError as exc:
        report_error(f"Could not read data/products.json: {exc}")
        return None


def validate_external_image_url(pid: str, value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https":
        report_error(f"{pid}: external image URL must use https://")
        return
    if not parsed.netloc:
        report_error(f"{pid}: external image URL has no hostname.")


def validate_repo_image(pid: str, value: str) -> None:
    # Normalize "./assets/..." to "assets/..."
    rel = value[2:] if value.startswith("./") else value

    if "\\" in rel:
        report_error(f"{pid}: image path must use forward slashes: {value}")
        return

    parts = Path(rel).parts
    if ".." in parts:
        report_error(f"{pid}: image path may not contain '..': {value}")
        return

    if not rel.startswith("assets/products/"):
        report_error(
            f"{pid}: repository image must be under assets/products/: {value}"
        )
        return

    ext = Path(rel).suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        report_error(
            f"{pid}: unsupported repository image extension '{ext or '(none)'}': {value}"
        )

    path = ROOT / rel
    if not path.is_file():
        report_error(f"{pid}: repository image file is missing: {value}")


def main() -> int:
    data = load_catalog()
    if data is None:
        print_summary(0, {})
        return 1

    if not isinstance(data, dict):
        report_error("Catalog root must be a JSON object.")
        print_summary(0, {})
        return 1

    version = data.get("version")
    if not nonempty_string(version):
        report_error("Catalog is missing a non-empty top-level 'version' string.")

    categories = data.get("categories")
    if not isinstance(categories, list) or not categories:
        report_error("Top-level 'categories' must be a non-empty array.")
        categories = []
    else:
        bad_categories = [c for c in categories if not nonempty_string(c)]
        if bad_categories:
            report_error("Every category must be a non-empty string.")
        duplicate_categories = [
            name for name, count in Counter(categories).items() if count > 1
        ]
        for name in duplicate_categories:
            report_error(f"Duplicate category in categories list: {name}")

    category_set = set(c for c in categories if isinstance(c, str))

    products = data.get("products")
    if not isinstance(products, list):
        report_error("Top-level 'products' must be an array.")
        print_summary(0, {})
        return 1

    ids = []
    display_orders = []
    active_signatures = []
    active_product_numbers = []
    referenced_repo_images = set()

    for index, product in enumerate(products, start=1):
        label = f"product #{index}"

        if not isinstance(product, dict):
            report_error(f"{label}: entry must be a JSON object.")
            continue

        pid = product.get("id")
        if nonempty_string(pid):
            pid = pid.strip()
            label = pid
            ids.append(pid)
            if not ID_RE.match(pid):
                report_error(
                    f"{pid}: ID must start with sams-, walmart-, or aldi- and contain only letters, numbers, '_' or '-'."
                )
        else:
            report_error(f"product #{index}: missing or empty id.")
            pid = f"product #{index}"

        for field in REQUIRED_PRODUCT_FIELDS:
            if field not in product:
                report_error(f"{pid}: missing required field '{field}'.")

        for field in ("retailer", "retailerKey", "category", "brand", "productName", "packCount", "priceDisplay"):
            if field in product and not nonempty_string(product.get(field)):
                report_error(f"{pid}: '{field}' must be a non-empty string.")

        retailer = product.get("retailer")
        retailer_key = product.get("retailerKey")
        if retailer not in ALLOWED_RETAILERS:
            report_error(
                f"{pid}: invalid retailer {retailer!r}. Allowed: {', '.join(ALLOWED_RETAILERS)}"
            )
        elif retailer_key != ALLOWED_RETAILERS[retailer]:
            report_error(
                f"{pid}: retailerKey {retailer_key!r} does not match retailer {retailer!r}; expected {ALLOWED_RETAILERS[retailer]!r}."
            )

        category = product.get("category")
        if isinstance(category, str) and category_set and category not in category_set:
            report_error(
                f"{pid}: category {category!r} is not present in the top-level categories list."
            )

        active = product.get("active")
        if "active" in product and not isinstance(active, bool):
            report_error(f"{pid}: 'active' must be true or false.")

        display_order = product.get("displayOrder")
        if "displayOrder" in product:
            if not isinstance(display_order, int) or isinstance(display_order, bool) or display_order < 1:
                report_error(f"{pid}: displayOrder must be a positive integer.")
            else:
                display_orders.append(display_order)

        price = product.get("price")
        if price is not None:
            if not isinstance(price, (int, float)) or isinstance(price, bool):
                report_error(f"{pid}: price must be numeric when supplied.")
            elif price < 0:
                report_error(f"{pid}: price may not be negative.")

        price_as_of = product.get("priceAsOf")
        if price_as_of not in (None, ""):
            if not isinstance(price_as_of, str) or not DATE_RE.match(price_as_of):
                report_error(
                    f"{pid}: priceAsOf must be YYYY-MM-DD when supplied."
                )

        product_number = product.get("productNumber")
        if product_number not in (None, "") and not isinstance(product_number, str):
            report_warning(
                f"{pid}: productNumber should be stored as a string to preserve leading zeros."
            )

        image = product.get("image")
        if image in (None, ""):
            report_warning(f"{pid}: no product image is assigned.")
        elif not isinstance(image, str):
            report_error(f"{pid}: image must be a string.")
        else:
            image = image.strip()
            if image.startswith(("http://", "https://")):
                validate_external_image_url(pid, image)
            else:
                validate_repo_image(pid, image)
                rel = image[2:] if image.startswith("./") else image
                referenced_repo_images.add(rel)

        # Exact duplicate protection for active products.
        if active is True:
            signature = (
                normalized(retailer),
                normalized(product.get("productName")),
                normalized(product.get("packCount")),
                normalized(product.get("individualSize")),
                normalized(product.get("variety")),
            )
            active_signatures.append((signature, pid))

            if nonempty_string(product_number):
                active_product_numbers.append(
                    ((normalized(retailer), product_number.strip()), pid)
                )

    for pid, count in Counter(ids).items():
        if count > 1:
            report_error(f"Duplicate product ID: {pid} (x{count}).")

    for order, count in Counter(display_orders).items():
        if count > 1:
            report_error(f"Duplicate displayOrder value: {order} (x{count}).")

    signature_to_ids = {}
    for signature, pid in active_signatures:
        signature_to_ids.setdefault(signature, []).append(pid)
    for signature, sig_ids in signature_to_ids.items():
        if len(sig_ids) > 1:
            report_error(
                "Duplicate active product signature: "
                + ", ".join(sig_ids)
                + f" -> {signature}"
            )

    number_to_ids = {}
    for key, pid in active_product_numbers:
        number_to_ids.setdefault(key, []).append(pid)
    for (retailer, number), number_ids in number_to_ids.items():
        if len(number_ids) > 1:
            report_warning(
                f"Possible duplicate product number within {retailer}: {number} used by {', '.join(number_ids)}"
            )

    # Orphaned local product images are warnings only. They may be intentional
    # leftovers while a product is being replaced or deactivated.
    if PRODUCT_IMAGE_ROOT.is_dir():
        for path in PRODUCT_IMAGE_ROOT.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel not in referenced_repo_images:
                report_warning(f"Unreferenced repository product image: {rel}")

    retailer_counts = Counter(
        p.get("retailer")
        for p in products
        if isinstance(p, dict) and p.get("retailer")
    )
    print_summary(len(products), dict(retailer_counts))

    if warnings:
        print("\nWARNINGS:")
        for message in warnings:
            print(f"- {message}")

    if errors:
        print("\nERRORS:")
        for message in errors:
            print(f"- {message}")
        print(f"\nCatalog validation: FAIL ({len(errors)} error(s), {len(warnings)} warning(s))")
        return 1

    print(f"\nCatalog validation: PASS ({len(warnings)} warning(s))")
    return 0


def print_summary(product_count: int, retailer_counts: dict) -> None:
    print(f"Catalog: {DATA.relative_to(ROOT)}")
    print(f"Products: {product_count}")
    if retailer_counts:
        print("By retailer:", dict(retailer_counts))


if __name__ == "__main__":
    sys.exit(main())
