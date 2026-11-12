/*
 * Lightweight, offline-capable product search.
 * Phase 1: brand nicknames, pack/size equivalents, and order-independent words.
 * No fuzzy spelling correction or external services.
 */
(function (root) {
  'use strict';

  // These are brand/product-family names, never parent-company ownership links.
  // In particular, "coke" must not match Sprite or Fanta.
  const ALIASES = [
    [/\bcoca cola\b/g, 'coke'],
    [/\bmtn dew\b/g, 'mountain dew'],
    [/\bmt dew\b/g, 'mountain dew'],
    [/\bdrpepper\b/g, 'dr pepper'],
    [/\bdr p\b/g, 'dr pepper'],
    [/\b7 up\b/g, '7up'],
    [/\bredbull\b/g, 'red bull'],
    [/\bbody armor\b/g, 'bodyarmor'],
    [/\bpower aid\b/g, 'powerade']
  ];

  const cache = new WeakMap();

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/(\d)\.(\d)/g, '$1p$2')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function tokens(value, applyAliases) {
    let text = normalize(value);
    if (applyAliases) {
      for (const [pattern, replacement] of ALIASES) {
        text = text.replace(pattern, replacement);
      }
    }

    // Separate quantity from unit size: 12-pack != 12-fl-oz.
    text = text
      .replace(/\b(\d{1,4})\s*(?:packs?|pks?|counts?|ct)\b/g, ' package$1 ')
      .replace(/\b(\d+(?:p\d+)?)\s*(?:liters?|litres?|ltrs?|ltr|l)\b/g, ' volume$1l ')
      .replace(/\b(\d+(?:p\d+)?)\s*(?:fl\s*oz|fluid\s*ounces?|ounces?|oz)\b/g, ' volume$1oz ')
      .replace(/\bbottles?\b/g, ' bottle ')
      .replace(/\bcans?\b/g, ' can ');

    return [...new Set(text.trim().split(/\s+/).filter(Boolean))];
  }

  function compile(query) {
    const terms = tokens(query, true);
    return { terms, normalized: normalize(query) };
  }

  function indexProduct(product) {
    if (cache.has(product)) return cache.get(product);

    const primary = new Set(tokens([
      product.productName, product.brand, product.variety
    ].filter(Boolean).join(' '), false));

    // Only the actual Coke/Diet Coke brand gets this nickname.
    const brand = normalize(product.brand);
    if (brand === 'coca cola' || brand === 'diet coke') primary.add('coke');

    const secondary = new Set(tokens([
      product.category, product.subcategory
    ].filter(Boolean).join(' '), false).filter(term =>
      !/^package\d+$/.test(term) && !/^volume\d/.test(term)
    ));

    const packages = new Set(tokens(product.packCount, false));
    const sizes = new Set(tokens(product.individualSize, false));

    // Allow bare numeric pack searches, while pack phrases remain strict.
    for (const term of packages) {
      if (/^package\d+$/.test(term)) packages.add(term.slice(7));
    }

    const indexed = {
      primary,
      secondary,
      packages,
      sizes,
      productNumber: String(product.productNumber || '').trim(),
      name: normalize(product.productName),
      brand,
      primaryWords: [...primary]
    };
    cache.set(product, indexed);
    return indexed;
  }

  // Returns 0 for no match; higher scores represent more relevant matches.
  function score(product, compiled) {
    const search = typeof compiled === 'string' ? compile(compiled) : compiled;
    if (!search || !search.terms.length) return 1;

    const item = indexProduct(product);
    let rank = 0;

    for (const term of search.terms) {
      if (/^package\d+$/.test(term)) {
        if (!item.packages.has(term)) return 0;
        rank += 5;
      } else if (/^volume\d/.test(term)) {
        if (!item.sizes.has(term)) return 0;
        rank += 5;
      } else if (item.primary.has(term)) {
        rank += 6;
      } else if (item.packages.has(term) || item.sizes.has(term)) {
        rank += 3;
      } else if (item.productNumber === term) {
        rank += 12;
      } else if (item.secondary.has(term)) {
        // Category/subcategory words can help general searches, but a Coke
        // family query only matches the product's own name or brand.
        if (term === 'coke') return 0;
        rank += 1;
      } else if (term.length >= 3 && item.primaryWords.some(word => word.startsWith(term))) {
        // As-you-type prefixes, not typo correction.
        rank += 2;
      } else {
        return 0;
      }
    }

    if (search.normalized && item.name === search.normalized) rank += 12;
    else if (search.normalized && item.name.startsWith(search.normalized + ' ')) rank += 6;
    if (search.normalized && item.brand === search.normalized) rank += 4;
    return rank;
  }

  const api = Object.freeze({ compile, score, normalize });
  if (root) root.StoreCatalogSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
