(() => {
  'use strict';

  const STORAGE = {
    cart: 'storeOrder.cart.v1',
    identity: 'storeOrder.identity.v1',
    startedAt: 'storeOrder.startedAt.v1',
    clientId: 'storeOrder.clientId.v1'
  };

  const state = {
    config: null,
    catalog: [],
    categories: [],
    retailer: 'all',
    search: '',
    category: 'all',
    cart: {},
    employee: { storeId: '', customStore: '', name: '', notes: '' },
    submitting: false,
    requestId: null,
    submitTimer: null,
    startedAt: Number(localStorage.getItem(STORAGE.startedAt)) || Date.now()
  };

  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    bindEvents();
    restoreLocalState();

    try {
      const [configResponse, productsResponse] = await Promise.all([
        fetch('./data/config.json', { cache: 'no-store' }),
        fetch('./data/products.json', { cache: 'no-store' })
      ]);
      if (!configResponse.ok || !productsResponse.ok) throw new Error('Catalog files could not be loaded.');
      state.config = await configResponse.json();
      const payload = await productsResponse.json();
      state.catalog = payload.products.filter(p => p.active !== false);
      state.categories = payload.categories || [];
      hydrateConfig();
      renderAll();
      registerServiceWorker();
    } catch (error) {
      console.error(error);
      el.catalogContent.innerHTML = `<div class="no-results"><strong>Catalog unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
      el.resultCount.textContent = 'Could not load products';
    }
  }

  function cacheElements() {
    [
      'appTitle','appSubtitle','searchInput','clearSearch','retailerFilters','categoryStrip','resultCount','filterSummary','resetFilters',
      'catalogContent','cartButton','cartSummary','cartBadge','drawerBackdrop','orderDrawer','closeDrawer','storeSelect','customStoreField',
      'customStore','employeeName','generalNotes','websiteField','emptyOrder','reviewGroups','clearOrder','submissionStatus','sendHelp',
      'sendOrder','successModal','successMessage','newRequest','infoButton','infoModal','closeInfo','submissionFrame',
      'submissionForm','submissionPayload'
    ].forEach(id => el[id] = document.getElementById(id));
  }

  function bindEvents() {
    el.searchInput.addEventListener('input', event => {
      state.search = event.target.value.trim();
      el.clearSearch.hidden = !state.search;
      state.category = 'all';
      renderCatalog();
      renderCategoryStrip();
    });
    el.clearSearch.addEventListener('click', () => {
      state.search = '';
      el.searchInput.value = '';
      el.clearSearch.hidden = true;
      renderCatalog();
      el.searchInput.focus();
    });
    el.retailerFilters.addEventListener('click', event => {
      const button = event.target.closest('[data-retailer]');
      if (!button) return;
      state.retailer = button.dataset.retailer;
      state.category = 'all';
      [...el.retailerFilters.querySelectorAll('.segment')].forEach(b => {
        const active = b === button;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      renderCategoryStrip();
      renderCatalog();
    });
    el.categoryStrip.addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.category = button.dataset.category;
      renderCategoryStrip();
      renderCatalog();
      if (state.category !== 'all') {
        requestAnimationFrame(() => document.getElementById(categoryId(state.category))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    });
    el.resetFilters.addEventListener('click', resetFilters);
    el.catalogContent.addEventListener('click', onCatalogClick);
    el.catalogContent.addEventListener('input', onCatalogInput);
    el.cartButton.addEventListener('click', openDrawer);
    el.closeDrawer.addEventListener('click', closeDrawer);
    el.drawerBackdrop.addEventListener('click', closeDrawer);
    el.storeSelect.addEventListener('change', onStoreChange);
    el.customStore.addEventListener('input', persistIdentityFromForm);
    el.employeeName.addEventListener('input', persistIdentityFromForm);
    el.generalNotes.addEventListener('input', persistIdentityFromForm);
    el.clearOrder.addEventListener('click', clearCartWithConfirm);
    el.reviewGroups.addEventListener('click', onReviewClick);
    el.reviewGroups.addEventListener('input', onReviewInput);
    el.sendOrder.addEventListener('click', submitOrder);
    el.newRequest.addEventListener('click', startNewRequest);
    el.infoButton.addEventListener('click', () => el.infoModal.hidden = false);
    el.closeInfo.addEventListener('click', () => el.infoModal.hidden = true);
    el.infoModal.addEventListener('click', event => { if (event.target === el.infoModal) el.infoModal.hidden = true; });
    el.successModal.addEventListener('click', event => { if (event.target === el.successModal) startNewRequest(); });
    window.addEventListener('message', handleBackendMessage);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!el.infoModal.hidden) el.infoModal.hidden = true;
      else if (!el.successModal.hidden) startNewRequest();
      else if (!el.orderDrawer.hidden) closeDrawer();
    });
  }

  function restoreLocalState() {
    try { state.cart = JSON.parse(localStorage.getItem(STORAGE.cart) || '{}') || {}; } catch { state.cart = {}; }
    try { state.employee = { ...state.employee, ...(JSON.parse(localStorage.getItem(STORAGE.identity) || '{}') || {}) }; } catch {}
    if (!localStorage.getItem(STORAGE.clientId)) localStorage.setItem(STORAGE.clientId, uuid());
    if (!localStorage.getItem(STORAGE.startedAt)) localStorage.setItem(STORAGE.startedAt, String(state.startedAt));
  }

  function hydrateConfig() {
    document.title = state.config.appName || 'Store Order Reference';
    el.appTitle.textContent = state.config.appName || 'Store Order Reference';
    el.appSubtitle.textContent = state.config.subtitle || "Sam's Club + Walmart";
    el.storeSelect.innerHTML = '<option value="">Select store…</option>' + (state.config.stores || []).map(store =>
      `<option value="${escapeAttr(store.id)}">${escapeHtml(store.name)}</option>`
    ).join('');
    el.storeSelect.value = state.employee.storeId || '';
    el.customStore.value = state.employee.customStore || '';
    el.employeeName.value = state.employee.name || '';
    el.generalNotes.value = state.employee.notes || '';
    toggleCustomStore();
    const recipient = state.config.recipientDisplay || 'lpgasbilling@gmail.com';
    el.sendHelp.innerHTML = `Your request will be emailed to <strong>${escapeHtml(recipient)}</strong>.`;
  }

  function renderAll() {
    renderCategoryStrip();
    renderCatalog();
    renderCartSummary();
  }

  function filteredProducts(ignoreCategory = false) {
    const query = normalize(state.search);
    return state.catalog.filter(product => {
      if (state.retailer !== 'all' && product.retailerKey !== state.retailer) return false;
      if (!ignoreCategory && state.category !== 'all' && product.category !== state.category) return false;
      if (!query) return true;
      const haystack = normalize([
        product.productName, product.brand, product.variety, product.productNumber, product.packCount,
        product.individualSize, product.category, product.subcategory, product.sourceNote
      ].filter(Boolean).join(' '));
      return haystack.includes(query);
    });
  }

  function renderCategoryStrip() {
    const products = filteredProducts(true);
    const present = new Set(products.map(p => p.category));
    const ordered = state.categories.filter(category => present.has(category));
    if (state.category !== 'all' && !present.has(state.category)) state.category = 'all';
    el.categoryStrip.innerHTML = [
      `<button class="category-chip ${state.category === 'all' ? 'active' : ''}" type="button" data-category="all">All categories</button>`,
      ...ordered.map(category => `<button class="category-chip ${state.category === category ? 'active' : ''}" type="button" data-category="${escapeAttr(category)}">${escapeHtml(category)}</button>`)
    ].join('');
  }

  function renderCatalog() {
    const products = filteredProducts();
    el.resultCount.textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
    const bits = [];
    if (state.retailer !== 'all') bits.push(state.retailer === 'sams' ? "Sam's Club" : 'Walmart');
    if (state.category !== 'all') bits.push(state.category);
    if (state.search) bits.push(`“${state.search}”`);
    el.filterSummary.textContent = bits.join(' · ');
    el.resetFilters.hidden = !bits.length;

    if (!products.length) {
      el.catalogContent.innerHTML = `<div class="no-results"><strong>No matching products</strong><p>Try a different search or reset the filters.</p></div>`;
      return;
    }

    const byCategory = groupBy(products, p => p.category);
    const categories = state.categories.filter(category => byCategory[category]);
    el.catalogContent.innerHTML = categories.map(category => renderCategory(category, byCategory[category])).join('');
  }

  function renderCategory(category, products) {
    const byRetailer = groupBy(products, p => p.retailerKey);
    const retailerOrder = ['sams','walmart'];
    const retailerBlocks = retailerOrder.filter(key => byRetailer[key]).map(key => {
      const retailerProducts = byRetailer[key];
      const bySub = groupBy(retailerProducts, p => p.subcategory || '');
      const subOrder = [...new Set(retailerProducts.map(p => p.subcategory || ''))];
      const showRetailer = state.retailer === 'all';
      return `${showRetailer ? `<div class="retailer-label">${key === 'sams' ? "Sam's Club" : 'Walmart'}</div>` : ''}
        ${subOrder.map(sub => `${sub ? `<div class="subcategory-label">${escapeHtml(sub)}</div>` : ''}<div class="product-grid">${bySub[sub].map(renderProductCard).join('')}</div>`).join('')}`;
    }).join('');

    return `<section class="category-section" id="${categoryId(category)}">
      <div class="category-heading"><h2>${escapeHtml(category)}</h2><span class="category-count">${products.length}</span></div>
      ${retailerBlocks}
    </section>`;
  }

  function renderProductCard(product) {
    const cartItem = state.cart[product.id];
    const selected = Boolean(cartItem);
    const image = product.image
      ? `<img class="product-image" src="${escapeAttr(productImageSrc(product.image))}" alt="" loading="lazy" width="256" height="256">`
      : `<div class="product-placeholder" aria-hidden="true">No photo supplied</div>`;
    const priceNote = product.priceNote ? `<div class="price-note">${escapeHtml(product.priceNote)}</div>` : '';
    const stock = product.availability ? `<span class="stock-note">${escapeHtml(product.availability)}</span>` : '';
    const variety = product.variety && !normalize(product.productName).includes(normalize(product.variety))
      ? `<div class="product-variety">${escapeHtml(product.variety)}</div>` : '';
    const sourceNote = product.sourceNote && product.sourceNote !== product.variety && !product.sourceNote.startsWith('Supplied price') && !product.sourceNote.startsWith('Match the pictured')
      ? `<div class="product-variety">${escapeHtml(product.sourceNote)}</div>` : '';
    const controls = selected
      ? `<div class="selected-controls" aria-label="Quantity for ${escapeAttr(product.productName)}">
           <button class="qty-button" type="button" data-action="decrease" data-id="${product.id}" aria-label="Decrease quantity">−</button>
           <span class="qty-value" aria-live="polite">${cartItem.quantity}</span>
           <button class="qty-button" type="button" data-action="increase" data-id="${product.id}" aria-label="Increase quantity">+</button>
         </div>`
      : `<button class="add-button" type="button" data-action="add" data-id="${product.id}">Add</button>`;
    const noteRow = selected ? `<div class="card-note-row">
        <button class="card-note-toggle" type="button" data-action="toggle-note" data-id="${product.id}">${cartItem.note ? 'Edit product note' : '+ Add product note'}</button>
        <textarea class="card-note-input" data-note-id="${product.id}" maxlength="300" rows="2" placeholder="Optional note for this product" ${cartItem.noteOpen ? '' : 'hidden'}>${escapeHtml(cartItem.note || '')}</textarea>
      </div>` : '';

    return `<article class="product-card ${selected ? 'selected' : ''}" data-product-id="${product.id}">
      <div class="product-image-wrap">${image}</div>
      <div class="product-main">
        ${product.brand ? `<div class="product-brand">${escapeHtml(product.brand)}</div>` : ''}
        <h3 class="product-name">${escapeHtml(product.productName)}</h3>
        ${variety}${sourceNote}
        <div class="product-meta">
          <span>${escapeHtml(product.packCount || '1 unit')}</span>
          ${product.individualSize ? `<span>${escapeHtml(product.individualSize)}</span>` : ''}
        </div>
        ${product.productNumber ? `<div class="product-number">Item # ${escapeHtml(product.productNumber)}</div>` : ''}
        ${stock}
        <div class="price-row">
          <div class="price-wrap"><div class="price">${escapeHtml(product.priceDisplay || 'Price not listed')}</div>${priceNote}</div>
          ${controls}
        </div>
      </div>
      ${noteRow}
    </article>`;
  }

  function onCatalogClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (action === 'add') addToCart(id);
    if (action === 'increase') changeQuantity(id, 1);
    if (action === 'decrease') changeQuantity(id, -1);
    if (action === 'toggle-note') {
      if (!state.cart[id]) return;
      state.cart[id].noteOpen = !state.cart[id].noteOpen;
      persistCart();
      renderCatalog();
      if (state.cart[id].noteOpen) requestAnimationFrame(() => document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
    }
  }

  function onCatalogInput(event) {
    const id = event.target.dataset.noteId;
    if (!id || !state.cart[id]) return;
    state.cart[id].note = event.target.value.slice(0,300);
    persistCart();
  }

  function addToCart(id) {
    if (!state.cart[id]) state.cart[id] = { quantity: 1, note: '', noteOpen: false };
    markOrderStarted();
    persistCart();
    renderCatalog();
    renderCartSummary();
  }

  function changeQuantity(id, delta) {
    const item = state.cart[id];
    if (!item) return;
    const next = Math.max(0, Math.min(999, Number(item.quantity || 1) + delta));
    if (next === 0) delete state.cart[id];
    else item.quantity = next;
    persistCart();
    renderCatalog();
    renderCartSummary();
    if (!el.orderDrawer.hidden) renderReview();
  }

  function removeFromCart(id) {
    delete state.cart[id];
    persistCart();
    renderCatalog();
    renderCartSummary();
    renderReview();
  }

  function markOrderStarted() {
    if (!Object.keys(state.cart).length) state.startedAt = Date.now();
    if (!localStorage.getItem(STORAGE.startedAt)) localStorage.setItem(STORAGE.startedAt, String(state.startedAt));
  }

  function persistCart() {
    localStorage.setItem(STORAGE.cart, JSON.stringify(state.cart));
  }

  function renderCartSummary() {
    const entries = Object.values(state.cart);
    const products = entries.length;
    const units = entries.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    el.cartBadge.textContent = String(products);
    el.cartSummary.textContent = products ? `${products} selected · ${units} total ${units === 1 ? 'unit' : 'units'}` : 'No products selected';
  }

  function openDrawer() {
    renderReview();
    el.drawerBackdrop.hidden = false;
    el.orderDrawer.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => el.closeDrawer.focus(), 0);
  }

  function closeDrawer() {
    el.drawerBackdrop.hidden = true;
    el.orderDrawer.hidden = true;
    document.body.style.overflow = '';
    el.cartButton.focus();
  }

  function renderReview() {
    const selected = selectedProducts();
    el.emptyOrder.hidden = selected.length > 0;
    el.clearOrder.hidden = selected.length === 0;
    el.sendOrder.disabled = state.submitting || selected.length === 0;
    if (!selected.length) {
      el.reviewGroups.innerHTML = '';
      return;
    }
    const byRetailer = groupBy(selected, item => item.product.retailer);
    const retailerOrder = ["Sam's Club", 'Walmart'];
    el.reviewGroups.innerHTML = retailerOrder.filter(r => byRetailer[r]).map(retailer => {
      const byCategory = groupBy(byRetailer[retailer], item => item.product.category);
      const cats = state.categories.filter(c => byCategory[c]);
      return `<div class="review-retailer">
        <h4 class="review-retailer-title">${escapeHtml(retailer)}</h4>
        ${cats.map(category => `<div class="review-category">${escapeHtml(category)}</div>${byCategory[category].map(renderReviewItem).join('')}`).join('')}
      </div>`;
    }).join('');
  }

  function renderReviewItem(item) {
    const p = item.product;
    const image = p.image ? `<img class="review-thumb" src="${escapeAttr(productImageSrc(p.image))}" alt="" loading="lazy">` : `<div class="review-thumb-placeholder">No photo</div>`;
    return `<div class="review-item" data-review-id="${p.id}">
      ${image}
      <div>
        <p class="review-name">${escapeHtml(p.productName)}</p>
        <div class="review-meta">${escapeHtml([p.packCount,p.individualSize].filter(Boolean).join(' · '))}</div>
        <div class="review-actions">
          <button class="qty-button" type="button" data-review-action="decrease" data-id="${p.id}" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.cart.quantity}</span>
          <button class="qty-button" type="button" data-review-action="increase" data-id="${p.id}" aria-label="Increase quantity">+</button>
          <button class="remove-button" type="button" data-review-action="remove" data-id="${p.id}">Remove</button>
        </div>
      </div>
      <textarea class="review-note" data-review-note="${p.id}" maxlength="300" rows="2" placeholder="Optional product note">${escapeHtml(item.cart.note || '')}</textarea>
    </div>`;
  }

  function onReviewClick(event) {
    const button = event.target.closest('[data-review-action]');
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.reviewAction === 'increase') changeQuantity(id, 1);
    if (button.dataset.reviewAction === 'decrease') changeQuantity(id, -1);
    if (button.dataset.reviewAction === 'remove') removeFromCart(id);
  }

  function onReviewInput(event) {
    const id = event.target.dataset.reviewNote;
    if (!id || !state.cart[id]) return;
    state.cart[id].note = event.target.value.slice(0,300);
    persistCart();
  }

  function selectedProducts() {
    const productMap = new Map(state.catalog.map(p => [p.id, p]));
    return Object.entries(state.cart)
      .map(([id, cart]) => ({ product: productMap.get(id), cart }))
      .filter(item => item.product && Number(item.cart.quantity) > 0)
      .sort((a,b) => a.product.displayOrder - b.product.displayOrder);
  }

  function onStoreChange() {
    toggleCustomStore();
    persistIdentityFromForm();
  }

  function toggleCustomStore() {
    const store = (state.config?.stores || []).find(s => s.id === el.storeSelect.value);
    const show = Boolean(store?.allowCustom);
    el.customStoreField.hidden = !show;
    el.customStore.required = show;
    if (!show) el.customStore.classList.remove('invalid');
  }

  function persistIdentityFromForm() {
    state.employee = {
      storeId: el.storeSelect.value,
      customStore: el.customStore.value.trim(),
      name: el.employeeName.value.trim(),
      notes: el.generalNotes.value.trim()
    };
    localStorage.setItem(STORAGE.identity, JSON.stringify(state.employee));
  }

  function validateOrder() {
    persistIdentityFromForm();
    const selected = selectedProducts();
    const errors = [];
    el.storeSelect.closest('.field')?.classList.remove('invalid');
    el.employeeName.closest('.field')?.classList.remove('invalid');
    el.customStore.closest('.field')?.classList.remove('invalid');
    if (!state.employee.storeId) {
      errors.push('Select a store location.');
      el.storeSelect.closest('.field')?.classList.add('invalid');
    }
    const store = (state.config.stores || []).find(s => s.id === state.employee.storeId);
    if (store?.allowCustom && !state.employee.customStore) {
      errors.push('Enter the store name.');
      el.customStore.closest('.field')?.classList.add('invalid');
    }
    if (!state.employee.name) {
      errors.push('Enter the employee name.');
      el.employeeName.closest('.field')?.classList.add('invalid');
    }
    if (!selected.length) errors.push('Add at least one product.');
    if (el.websiteField.value) errors.push('Submission could not be validated.');
    showStatus(errors.length ? errors.join(' ') : '', errors.length ? 'error' : '');
    return errors.length === 0;
  }

  function buildPayload() {
    const storeConfig = (state.config.stores || []).find(s => s.id === state.employee.storeId);
    const storeName = storeConfig?.allowCustom ? state.employee.customStore : (storeConfig?.name || state.employee.storeId);
    const now = new Date();
    return {
      version: 1,
      requestId: uuid(),
      clientId: localStorage.getItem(STORAGE.clientId) || uuid(),
      startedAt: state.startedAt,
      submittedAt: now.toISOString(),
      submittedLocal: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      store: storeName,
      storeId: state.employee.storeId,
      employeeName: state.employee.name,
      generalNotes: state.employee.notes,
      honeypot: el.websiteField.value,
      pageUrl: location.href.split('#')[0],
      items: selectedProducts().map(({ product, cart }) => ({
        id: product.id,
        retailer: product.retailer,
        category: product.category,
        productName: product.productName,
        brand: product.brand,
        variety: product.variety || '',
        packCount: product.packCount || '',
        individualSize: product.individualSize || '',
        productNumber: product.productNumber || '',
        quantity: Number(cart.quantity),
        note: (cart.note || '').trim()
      }))
    };
  }

  function submitOrder() {
    if (state.submitting || !validateOrder()) return;
    const backendUrl = state.config.backend?.appsScriptUrl || '';
    if (!/^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/.test(backendUrl)) {
      showStatus('Email submission is not configured yet. Deploy backend/Code.gs as a Google Apps Script web app, then paste its /exec URL into data/config.json. Your selections are saved.', 'info');
      return;
    }

    const payload = buildPayload();
    state.requestId = payload.requestId;
    state.submitting = true;
    el.sendOrder.disabled = true;
    el.sendOrder.textContent = 'Sending…';
    showStatus('Sending your order request…', 'info');

    el.submissionPayload.value = JSON.stringify(payload);
    el.submissionForm.action = backendUrl;
    el.submissionForm.submit();

    clearTimeout(state.submitTimer);
    state.submitTimer = setTimeout(() => {
      if (!state.submitting) return;
      state.submitting = false;
      state.requestId = null;
      el.sendOrder.disabled = false;
      el.sendOrder.textContent = 'Send Order Request';
      showStatus('The request did not confirm within 20 seconds. Your order is still saved. Check your connection and try again. Duplicate protection on the server prevents an identical request from being emailed twice.', 'error');
    }, Number(state.config.backend?.timeoutMs) || 20000);
  }

  function handleBackendMessage(event) {
    const data = event.data;
    if (!state.submitting || !data || data.source !== 'store-order-backend' || data.requestId !== state.requestId) return;
    clearTimeout(state.submitTimer);
    state.submitting = false;
    state.requestId = null;
    el.sendOrder.disabled = false;
    el.sendOrder.textContent = 'Send Order Request';

    if (data.ok) {
      showStatus(data.duplicate ? 'This request was already received; a duplicate email was not sent.' : 'Order request sent successfully.', 'success');
      el.successMessage.textContent = data.duplicate
        ? 'This same request was already received recently, so a duplicate email was prevented.'
        : 'Your order request was emailed successfully.';
      el.successModal.hidden = false;
    } else {
      showStatus(data.message || 'The email could not be sent. Your selections are still saved; please try again.', 'error');
    }
  }

  function showStatus(message, type) {
    if (!message) {
      el.submissionStatus.hidden = true;
      el.submissionStatus.className = 'submission-status';
      el.submissionStatus.textContent = '';
      return;
    }
    el.submissionStatus.hidden = false;
    el.submissionStatus.className = `submission-status ${type}`;
    el.submissionStatus.textContent = message;
  }

  function startNewRequest() {
    state.cart = {};
    state.employee.notes = '';
    state.startedAt = Date.now();
    localStorage.setItem(STORAGE.startedAt, String(state.startedAt));
    localStorage.setItem(STORAGE.cart, '{}');
    el.generalNotes.value = '';
    persistIdentityFromForm();
    el.successModal.hidden = true;
    showStatus('', '');
    renderAll();
    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function clearCartWithConfirm() {
    if (!Object.keys(state.cart).length) return;
    if (!window.confirm('Clear all selected products from this order?')) return;
    state.cart = {};
    state.startedAt = Date.now();
    localStorage.setItem(STORAGE.startedAt, String(state.startedAt));
    persistCart();
    renderCatalog();
    renderCartSummary();
    renderReview();
  }

  function resetFilters() {
    state.retailer = 'all';
    state.category = 'all';
    state.search = '';
    el.searchInput.value = '';
    el.clearSearch.hidden = true;
    [...el.retailerFilters.querySelectorAll('.segment')].forEach(b => {
      const active = b.dataset.retailer === 'all';
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderCategoryStrip();
    renderCatalog();
  }

  function groupBy(items, keyFn) {
    return items.reduce((acc, item) => {
      const key = keyFn(item);
      (acc[key] ||= []).push(item);
      return acc;
    }, {});
  }

  function categoryId(category) {
    return `category-${category.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}`;
  }

  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%]+/g,' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function escapeAttr(value) { return escapeHtml(value); }

  function productImageSrc(value) {
    const src = String(value || '').trim();
    if (/^https?:\/\//i.test(src)) return src;
    return `./${src.replace(/^\.?\//, '')}`;
  }

  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed:', error));
    }
  }
})();
