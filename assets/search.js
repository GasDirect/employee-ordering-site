/*
 * Lightweight, offline-capable product search.
 * Brand aliases, pack/size equivalents, order-independent words, and
 * conservative typo recovery. Runs locally; no network or paid services.
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


  // Candidate words come only from actual product names and brands. This is
  // deliberate: arbitrary dictionary spelling guesses can create wrong orders.
  const vocabularyCache = new WeakMap();

  function vocabulary(products) {
    if (vocabularyCache.has(products)) return vocabularyCache.get(products);
    const words = new Map();
    for (const p of products) {
      if (p.active === false) continue;
      for (const w of tokens(p.brand, false)) {
        if (/^[a-z]{5,}$/.test(w)) words.set(w, { brand: true });
      }
      for (const w of tokens([p.productName, p.variety].filter(Boolean).join(' '), false)) {
        if (!/^[a-z]{6,}$/.test(w)) continue;
        if (!words.has(w)) words.set(w, { brand: false });
      }
    }
    vocabularyCache.set(products, words);
    return words;
  }

  // Restricted Damerau-Levenshtein: insertion, deletion, substitution and
  // an adjacent character swap. Small strings; only called after zero matches.
  function typoDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    const rows = [];
    for (let i = 0; i <= a.length; i++) {
      const row = new Array(b.length + 1);
      row[0] = i;
      rows.push(row);
    }
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let minimum = limit + 1;
      for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
        minimum = Math.min(minimum, rows[i][j]);
      }
      if (minimum > limit) return limit + 1;
    }
    return rows[a.length][b.length];
  }

  // A spelling correction is applied ONLY when the normal search has no
  // results. Correct at most one word and only to a unique, plausible product
  // word. Package sizes, short words, and numeric item codes are never fuzzy.
  function resolve(query, products) {
    const original = compile(query);
    if (!original.terms.length || products.some(p => score(p, original) > 0)) {
      return original;
    }

    const lexicon = vocabulary(products);
    const choices = [];
    for (let index = 0; index < original.terms.length; index++) {
      const term = original.terms[index];
      if (!/^[a-z]{5,}$/.test(term)) continue;
      for (const [word, meta] of lexicon) {
        if (term === word) continue;
        const maxDistance = meta.brand && term.length >= 8 && word.length >= 8 ? 2 : 1;
        if (maxDistance === 2 && term.slice(0, 3) !== word.slice(0, 3)) continue;
        const distance = typoDistance(term, word, maxDistance);
        if (distance === 0 || distance > maxDistance) continue;
        const terms = original.terms.slice();
        terms[index] = word;
        const candidate = { terms, normalized: original.normalized };
        if (products.some(p => score(p, candidate) > 0)) {
          choices.push({ from: term, to: word, index, distance, brand: meta.brand, terms });
        }
      }
    }

    choices.sort((a, b) => a.distance - b.distance || Number(b.brand) - Number(a.brand));
    if (!choices.length) return original;

    // Two equally plausible correction targets are ambiguous: return nothing
    // rather than silently showing a different product.
    const best = choices[0];
    if (choices.some(c => c !== best && c.distance === best.distance &&
        c.brand === best.brand)) return original;
    return {
      terms: best.terms,
      normalized: original.normalized,
      correction: { from: best.from, to: best.to }
    };
  }

  const api = Object.freeze({ compile, resolve, score, normalize });
  if (root) root.StoreCatalogSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
