# Product variants

Sizes, colours and other versions of a product. The stock mode is chosen **per product**.

## Two stock modes

| | Shared stock | Separate stock |
|---|---|---|
| What it is | ONE product, ONE stock count | each variant is its OWN product |
| Where variants live | `products.variant_config_json` (`mode: "shared"`, `variants[]`) | one product row each, tied by `variant_group_id` = main product id |
| Per-variant price | optional override (`priceCents`, null = product price) | the variant product's own selling price |
| Per-variant SKU/barcode | optional, inside the config | the variant product's own |
| Typical use | colours you never count apart | sizes you count separately |

In separate mode the **main product is itself one of the variants**: its own `variant_group_id` is its
own id, and it carries the config (`mode: "separate"`, options, title, empty `variants`).

Config shape (`ProductVariantConfig`, parsed defensively in `product-repository.ts`):

```json
{ "mode": "shared", "title": "Cotton Tee",
  "options": [{ "name": "Size", "values": ["S", "M", "L"] }],
  "variants": [{ "key": "v_3f9a…", "values": { "Size": "M" }, "priceCents": null,
                 "sku": null, "barcode": "6001234", "active": true }] }
```

`key` is stable across edits (matched by option values), so sale lines can reference it later.

## Rules (main/services/product-variant-service.ts)

- Neither mode changes how stock moves. Selling a shared variant deducts the product's own stock.
- 1–3 options; every variant has exactly one value per option; no duplicate combinations.
- A SKU/barcode is unique across products (any status) AND every product's shared variants,
  enforced both ways (`findSharedVariantCodeOwner` is also used by `product-service.ts`).
- A product is in at most one group; modes can't be switched without removing the variants first.
- New separate-stock products are copies of the main product (no image file shared) with 0 stock.

## Grouping existing products

From Products → select ≥ 2 → **Group as Variants**.

- **Separate stock (link)**: nothing moves; products are just grouped. Ungroup any time.
- **Shared stock (merge)**: each other product's stock moves into the main product via `adjustment`
  movements (`reference_type = 'variant_merge'`, shared `reference_id`) at every location; Main Store
  named earmarks move bucket-for-bucket, the rest as unallocated. Its barcode moves onto its variant,
  and it is deactivated (history kept). Needs `products:edit` + `inventory:edit`. Not reversible.

## Phases

A (done) schema, brand, "was" price · B (done) POS management + grouping · C checkout picker,
barcode scan, variant labels on receipts/invoices/quotations · D website · E mobile app.
