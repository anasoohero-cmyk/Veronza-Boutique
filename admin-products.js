const SUPABASE_URL = 'https://kahbxvbirsjmednkybse.supabase.co';
const SUPABASE_KEY = 'sb_publishable_L1TY-QEyFsWDeDRy_saOUQ_GP8TjADm';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.veronzaSupabase = sb;
let products = [];
let currentImages = [];
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c],
  );
const typeNames = { shoes: 'حذاء', bags: 'شنطة', set: 'Set' };

function toast(t) {
  const x = $('#toast');
  x.textContent = t;
  x.classList.add('show');
  setTimeout(() => x.classList.remove('show'), 2500);
}
// Covers this page's own modal plus the floating chat widget it also loads,
// so closing one doesn't unlock scrolling while the other is still open.
// overflow:hidden alone doesn't reliably block touch-driven scrolling on
// some mobile browsers - pin the body with position:fixed at its current
// scroll offset, which actually holds there too.
let vzScrollLockY = 0;
function syncBodyScrollLock() {
  const anyOpen =
    !$('#modal').classList.contains('hidden') || !!document.querySelector('.vz-chatw-panel.open');
  const isLocked = document.body.style.position === 'fixed';
  if (anyOpen && !isLocked) {
    vzScrollLockY = window.scrollY;
    Object.assign(document.body.style, {
      position: 'fixed',
      top: `-${vzScrollLockY}px`,
      left: '0',
      right: '0',
      width: '100%',
    });
  } else if (!anyOpen && isLocked) {
    Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, vzScrollLockY);
  }
}
window.syncBodyScrollLock = syncBodyScrollLock;

async function checkAdmin(token) {
  try {
    const r = await fetch('/api/admin-auth', { headers: { Authorization: `Bearer ${token}` } });
    let data = {};
    try {
      data = await r.json();
    } catch (_) {}
    return {
      ok: r.ok && data.ok === true,
      status: r.status,
      role: data.role,
      permissions: data.permissions || {},
    };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

// Permissions are per product category (see product-categories.js) rather
// than one flat products.view/edit — an admin can be given access to, say,
// discounts without also getting shoes. The owner bypasses all of this the
// same way the database's RLS policies do (role === 'owner'), so its own
// permissions JSON never needs to enumerate every category.
let isOwner = false;
let currentPermissions = { products: {} };
function canViewType(type) {
  return isOwner || !!currentPermissions.products?.[type]?.view;
}
function canEditType(type) {
  return isOwner || !!currentPermissions.products?.[type]?.edit;
}
function canViewDiscount() {
  return isOwner || !!currentPermissions.products?.discount?.view;
}
function canEditDiscount() {
  return isOwner || !!currentPermissions.products?.discount?.edit;
}
function restrictTypeOptions() {
  [...($('#type')?.options || [])].forEach((opt) => {
    opt.disabled = !canEditType(opt.value);
  });
}
function toggleDiscountField() {
  const label = $('#discountPriceLabel');
  if (!label) return;
  label.hidden = !canViewDiscount();
  $('#discountPrice').disabled = !canEditDiscount();
}
function applyProductsPermissions(adminCheck) {
  isOwner = adminCheck.role === 'owner';
  currentPermissions = { products: adminCheck.permissions?.products || {} };
  $('#usersMenuLink')?.toggleAttribute('hidden', adminCheck.role !== 'owner');
  const types = Object.keys(typeNames);
  const canEditAnyType = types.some(canEditType);
  const canViewAnyType = types.some(canViewType);
  $('#addBtn').hidden = !canEditAnyType;
  restrictTypeOptions();
  toggleDiscountField();
  if (!canViewAnyType) {
    $('main').innerHTML =
      '<p style="text-align:center;color:#888;padding:40px 16px">ماعندك صلاحية الوصول لقسم المنتجات.</p>';
  }
}

function showApp(session, adminCheck) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
  if (adminCheck) applyProductsPermissions(adminCheck);
  if (isOwner || Object.keys(typeNames).some(canViewType)) load();
}

function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

async function load() {
  const { data, error } = await sb
    .from('products')
    .select(
      'id,code,name,description,price,discount_price,type,model_code,img,extra_img,rating,reviews,colors,sizes,size_quantities,is_active,quantity,created_at,updated_at',
    )
    .order('id', { ascending: false });
  if (error) {
    console.error(error);
    toast('تعذر تحميل المنتجات: ' + error.message);
    const box = $('#products');
    if (box) box.innerHTML = `<p class="empty">تعذر تحميل المنتجات (${esc(error.message)}). حاول تحديث الصفحة.</p>`;
    return;
  }
  products = Array.isArray(data) ? data : [];
  render();
  renderModelCodeOptions();
  restoreAfterUpdate();
}
function renderModelCodeOptions() {
  const codes = [...new Set(products.map((p) => p.model_code).filter(Boolean))].sort();
  $('#modelCodeList').innerHTML = codes.map((c) => `<option value="${esc(c)}">`).join('');
}
let restoredAfterUpdate = false;
function restoreAfterUpdate() {
  if (restoredAfterUpdate) return;
  restoredAfterUpdate = true;
  const state = window.veronzaConsumeRestoreState?.();
  if (!state) return;
  if (state.window === 'admin-product-edit' && state.context?.productId) {
    const product = products.find((p) => String(p.id) === String(state.context.productId));
    if (product) openModal(product);
  } else if (state.window === 'admin-chat-widget') {
    waitAndRestoreChatWidget();
  }
  if (typeof state.scrollY === 'number') window.scrollTo(0, state.scrollY);
}
function waitAndRestoreChatWidget(tries = 20) {
  if (window.veronzaOpenAdminChatWidget) window.veronzaOpenAdminChatWidget();
  else if (tries > 0) setTimeout(() => waitAndRestoreChatWidget(tries - 1), 200);
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const list = products.filter(
    (p) =>
      canViewType(p.type) &&
      (!q || String(p.name).toLowerCase().includes(q) || String(p.code).toLowerCase().includes(q)),
  );
  const box = $('#products');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<p class="empty">${products.length ? 'لا توجد منتجات مطابقة للبحث.' : 'لا توجد منتجات مضافة بعد. اضغط "+ إضافة منتج" لإضافة أول منتج.'}</p>`;
    return;
  }
  box.innerHTML = list
    .map((p) => {
      const hasDiscount =
        canViewDiscount() && p.discount_price != null && Number(p.discount_price) < Number(p.price);
      const priceHtml = hasDiscount
        ? `<div class="price"><s>${Number(p.price || 0).toLocaleString('ar-LY')} د.ل</s><br>${Number(p.discount_price).toLocaleString('ar-LY')} د.ل</div>`
        : `<div class="price">${Number(p.price || 0).toLocaleString('ar-LY')} د.ل</div>`;
      return `<div class="product-row"><img class="thumb" src="${esc(p.img)}" alt=""><div class="product-main"><h3>${esc(p.name)}${hasDiscount ? ' <span class="badge off" style="background:#c0392b;color:#fff">خصم</span>' : ''}</h3><div class="meta">الكود: ${esc(p.code)} · النوع: ${typeNames[p.type] || esc(p.type)} · الكمية: ${Number(p.quantity || 0)}<br>الألوان: ${esc((p.colors || []).join('، ') || '—')} · المقاسات: ${esc((p.sizes || []).join('، ') || '—')}</div></div>${priceHtml}<span class="badge ${p.is_active ? 'on' : 'off'}">${p.is_active ? 'متوفر' : 'غير متوفر'}</span>${canEditType(p.type) ? `<div class="row-actions"><button data-edit="${p.id}">تعديل</button><button class="danger" data-delete="${p.id}">حذف</button></div>` : ''}</div>`;
    })
    .join('');
}

function resetForm() {
  ['productId', 'name', 'description', 'code', 'price', 'discountPrice', 'img', 'colors', 'sizes'].forEach(
    (id) => ($('#' + id).value = ''),
  );
  $('#code').readOnly = true;
  $('#code').required = false;
  $('#quantity').value = '0';
  $('#modelCode').value = '';
  $('#bagSetLinks').value = '';
  $('#type').value = Object.keys(typeNames).find(canEditType) || 'shoes';
  $('#extraImgs').value = '';
  $('#isActive').value = 'true';
  $('#sizeOptions').innerHTML = '';
  $('#sizeQuantities').innerHTML = '';
  currentImages = [];
  renderPreview();
  toggleDiscountField();
  toggleBagLinksField();
}

function toggleBagLinksField() {
  $('#bagLinksLabel').hidden = $('#type').value !== 'bags';
}

async function loadBagSetLinks(bagId) {
  const { data, error } = await sb
    .from('bag_set_links')
    .select('set_model_code')
    .eq('bag_product_id', bagId);
  if (error) return;
  $('#bagSetLinks').value = (data || []).map((r) => r.set_model_code).join(', ');
}

function openModal(p) {
  if (p && !canEditType(p.type)) return;
  if (!p) {
    resetForm();
    renderSizeOptions();
    $('#modalTitle').textContent = 'إضافة منتج';
  } else {
    $('#productId').value = p.id;
    $('#name').value = p.name || '';
    $('#description').value = p.description || '';
    $('#code').value = p.code || '';
    $('#code').readOnly = true;
    $('#code').required = false;
    $('#price').value = p.price || '';
    $('#discountPrice').value = p.discount_price != null ? p.discount_price : '';
    $('#type').value = p.type || 'shoes';
    $('#modelCode').value = p.model_code || '';
    $('#bagSetLinks').value = '';
    toggleBagLinksField();
    if (p.type === 'bags') loadBagSetLinks(p.id);
    $('#img').value = p.img || '';
    $('#extraImgs').value = p.extra_img || '';
    currentImages = [p.img, ...String(p.extra_img || '').split(/\n+/)]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    $('#colors').value = (Array.isArray(p.colors) ? p.colors : []).join(', ');
    $('#isActive').value = p.is_active !== false ? 'true' : 'false';
    const sizes = Array.isArray(p.sizes) ? p.sizes : [];
    $('#sizes').value = sizes.join(', ');
    renderSizeOptions(sizes, p.size_quantities || {});
    renderSizeQuantities(p.size_quantities || {});
    if (p.type === 'shoes' || p.type === 'set') {
      syncTotalQuantity();
    } else {
      $('#quantity').value = Number(p.quantity || 0);
    }
    $('#modalTitle').textContent = 'تعديل المنتج';
    renderPreview();
  }
  $('#modal').classList.remove('hidden');
  syncBodyScrollLock();
}

function closeModal() {
  $('#modal').classList.add('hidden');
  syncBodyScrollLock();
}

function csv(v) {
  return String(v || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function syncImageFields() {
  $('#img').value = currentImages[0] || '';
  $('#extraImgs').value = currentImages.slice(1).join('\n');
}

function renderPreview() {
  syncImageFields();
  $('#preview').innerHTML = currentImages
    .map(
      (url, i) =>
        `<div class="preview-item"><img src="${esc(url)}" alt="معاينة"><button type="button" class="preview-remove" data-remove-img="${i}" aria-label="حذف الصورة">×</button>${i === 0 ? '<span class="preview-main">رئيسية</span>' : ''}</div>`,
    )
    .join('');
  $('#preview')
    .querySelectorAll('[data-remove-img]')
    .forEach(
      (btn) =>
        (btn.onclick = () => {
          currentImages.splice(Number(btn.dataset.removeImg), 1);
          renderPreview();
        }),
    );
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('نتيجة غير متوقعة'));
      }
    };
    reader.readAsDataURL(file);
  });
}

// Phone camera photos routinely come in at several MB, which is fine to
// capture but far too heavy to serve as-is to every customer - especially
// on a slow connection, where it can time out and show as a broken image
// entirely. Downscale and re-encode before upload so a product photo stays
// a few hundred KB regardless of what the admin's camera produced.
function resizeImageFile(file, maxDim = 2200, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('تعذر ضغط الصورة'));
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذر قراءة الصورة'));
    };
    img.src = url;
  });
}

async function uploadImageFile(file) {
  let uploadFile = file;
  try {
    uploadFile = await resizeImageFile(file);
  } catch (_) {
    // Resizing failed for some reason - upload the original rather than
    // block the admin from adding the photo at all.
  }
  const ext = (uploadFile.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from('product-images')
    .upload(path, uploadFile, { upsert: true, contentType: uploadFile.type || 'image/jpeg' });
  if (error) throw new Error('تعذر رفع الصورة: ' + error.message);
  const { data } = sb.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

async function handleImageFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const invalid = files.find((file) => !file.type.startsWith('image/'));
  if (invalid) {
    $('#formError').textContent = 'جميع الملفات يجب أن تكون صور.';
    return;
  }
  try {
    const newUrls = await Promise.all(files.map((f) => uploadImageFile(f)));
    currentImages = [...currentImages, ...newUrls];
    renderPreview();
  } catch (error) {
    $('#formError').textContent = error.message || 'تعذر معالجة الصور';
  }
  e.target.value = '';
}

function base64ToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

async function uploadBase64Image(dataUrl, label) {
  const parsed = base64ToBlob(dataUrl);
  if (!parsed) return dataUrl;
  const ext = (parsed.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `migrated-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { error } = await sb.storage
    .from('product-images')
    .upload(path, parsed.blob, { upsert: true, contentType: parsed.mime });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

async function migrateOldImages() {
  const button = $('#migrateImagesBtn');
  const targets = products.filter(
    (p) => (p.img && p.img.startsWith('data:')) || (p.extra_img && p.extra_img.includes('data:')),
  );
  if (!targets.length) {
    toast('كل الصور محدثة، ما فيه شي يحتاج ترحيل ✓');
    return;
  }
  if (
    !confirm(
      `فيه ${targets.length} منتج يحتوي صور قديمة. تحويلها لصور حقيقية يحسّن سرعة الموقع بشكل كبير. نبدأ؟`,
    )
  )
    return;
  button.disabled = true;
  let done = 0,
    failed = 0;
  for (const p of targets) {
    try {
      const update = {};
      if (p.img && p.img.startsWith('data:')) {
        update.img = await uploadBase64Image(p.img, `${p.id}-main`);
      }
      if (p.extra_img) {
        const lines = String(p.extra_img)
          .split(/\n+/)
          .map((x) => x.trim())
          .filter(Boolean);
        const newLines = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('data:'))
            newLines.push(await uploadBase64Image(lines[i], `${p.id}-extra-${i}`));
          else newLines.push(lines[i]);
        }
        update.extra_img = newLines.join('\n');
      }
      if (Object.keys(update).length) {
        const { error } = await sb.from('products').update(update).eq('id', p.id);
        if (error) throw error;
      }
      done++;
      button.textContent = `جاري الترحيل... (${done}/${targets.length})`;
    } catch (error) {
      failed++;
      console.error('Migrate image failed for product', p.id, error);
    }
  }
  button.disabled = false;
  button.textContent = 'ترحيل الصور القديمة';
  toast(
    failed ? `تم ترحيل ${done}، وفشل ${failed} — راجع الكونسول` : `تم ترحيل ${done} منتج بنجاح ✓`,
  );
  await load();
}

function renderSizeOptions(selected = [], existing = {}) {
  const box = $('#sizeOptions');
  if (!box) return;
  const required = $('#type').value === 'shoes' || $('#type').value === 'set';
  if (!required) {
    box.innerHTML = '';
    return;
  }
  const commonSizes = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47'];
  box.innerHTML = commonSizes
    .map(
      (size) =>
        `<label><input type="checkbox" class="size-option" value="${size}" ${selected.includes(size) ? 'checked' : ''}>${size}<span class="size-quantity-wrap">الكمية: <input type="number" class="size-quantity" data-size="${size}" value="${existing[size] || 0}" min="0"></span></label>`,
    )
    .join('');
}

function syncSelectedSizes() {
  const selected = [...document.querySelectorAll('.size-option:checked')].map(
    (input) => input.value,
  );
  $('#sizes').value = selected.join(', ');
}

function updateSizesRequired() {
  const required = $('#type').value === 'shoes' || $('#type').value === 'set';
  $('#sizes').required = required;
  $('#sizes').closest('label').classList.toggle('required', required);
  const selected = [...document.querySelectorAll('.size-option:checked')].map((i) => i.value);
  const existing = getSizeQuantities();
  renderSizeOptions(selected, existing);
}

function renderSizeQuantities(existing = {}) {
  document.querySelectorAll('.size-quantity').forEach((input) => {
    const size = input.dataset.size;
    input.value = existing[size] || 0;
  });
}

// While the admin is still filling the form (before save), pull sizes from
// an existing shoe/set sibling under the same model - the DB trigger only
// mirrors stock after the row is actually inserted, which is too late to
// save the admin from re-typing sizes that already exist on the sibling.
function findModelSizeSibling(modelCode) {
  const currentId = $('#productId').value;
  return products.find(
    (p) =>
      p.model_code === modelCode &&
      (p.type === 'shoes' || p.type === 'set') &&
      String(p.id) !== String(currentId) &&
      Object.keys(p.size_quantities || {}).length > 0,
  );
}
function applyModelSizesIfAvailable() {
  if ($('#productId').value) return; // only auto-fill for a brand-new product
  const type = $('#type').value;
  if (type !== 'shoes' && type !== 'set') return;
  const modelCode = $('#modelCode').value.trim().toUpperCase();
  if (!modelCode) return;
  const sibling = findModelSizeSibling(modelCode);
  if (!sibling) return;
  renderSizeOptions(sibling.sizes || [], sibling.size_quantities || {});
  syncSelectedSizes();
  syncTotalQuantity();
}

function syncTotalQuantity() {
  const inputs = [...document.querySelectorAll('.size-quantity')];
  if (!inputs.length) return;
  const total = inputs
    .filter((input) => input.closest('label')?.querySelector('.size-option')?.checked)
    .reduce((sum, input) => sum + Math.max(0, Math.floor(Number(input.value || 0))), 0);
  $('#quantity').value = total;
}

function getSizeQuantities() {
  const result = {};
  document.querySelectorAll('.size-quantity').forEach((input) => {
    const checked = input.closest('label')?.querySelector('.size-option')?.checked;
    if (checked) result[input.dataset.size] = Math.max(0, Math.floor(Number(input.value || 0)));
  });
  return result;
}

async function save(e) {
  e.preventDefault();
  $('#formError').textContent = '';
  const id = $('#productId').value;
  const sizes = csv($('#sizes').value);
  const type = $('#type').value;
  const isSized = type === 'shoes' || type === 'set';

  if (!canEditType(type)) {
    $('#formError').textContent = 'ماعندكش صلاحية تعديل هذا القسم.';
    return;
  }

  if (isSized && !sizes.length) {
    $('#formError').textContent = 'المقاسات مطلوبة للحذاء والـ Set.';
    return;
  }

  if (isSized) {
    const missing = [...document.querySelectorAll('.size-option:checked')].some((option) => {
      const input = option.closest('label')?.querySelector('.size-quantity');
      return !input || input.value === '';
    });
    if (missing) {
      $('#formError').textContent = 'حدد كمية لكل مقاس.';
      return;
    }
  }

  const modelCode = $('#modelCode').value.trim().toUpperCase();
  if (!/^V[0-9]{2,}$/.test(modelCode)) {
    $('#formError').textContent = 'كود الموديل مطلوب، بصيغة V01 وهكذا.';
    return;
  }
  $('#modelCode').value = modelCode;

  if (!id) {
    const { data, error } = await sb.rpc('next_product_code');
    if (error) {
      $('#formError').textContent = 'تعذر توليد كود المنتج: ' + error.message;
      return;
    }
    $('#code').value = String(data);
    $('#code').required = true;
  }

  const price = Number($('#price').value || 0);
  const discountPriceRaw = $('#discountPrice').value.trim();
  const discountPrice = discountPriceRaw === '' ? null : Number(discountPriceRaw);
  if (
    discountPrice != null &&
    (Number.isNaN(discountPrice) || discountPrice < 0 || discountPrice >= price)
  ) {
    $('#formError').textContent = 'سعر الخصم لازم يكون رقم موجب وأقل من السعر الأصلي.';
    return;
  }

  const original = id ? products.find((p) => String(p.id) === String(id)) : null;
  const originalDiscountPrice = original?.discount_price ?? null;
  const discountChanged = discountPrice !== originalDiscountPrice;
  if (discountChanged && !canEditDiscount()) {
    $('#formError').textContent = 'ماعندكش صلاحية تعديل التخفيضات.';
    return;
  }

  const sizeQuantities = isSized ? getSizeQuantities() : {};

  const payload = {
    name: $('#name').value.trim(),
    description: $('#description').value.trim() || null,
    code: $('#code').value.trim(),
    price,
    discount_price: discountPrice,
    type,
    model_code: modelCode,
    img: $('#img').value.trim(),
    extra_img:
      $('#extraImgs')
        .value.split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .join('\n') || null,
    colors: csv($('#colors').value),
    sizes,
    size_quantities: sizeQuantities,
    quantity: isSized
      ? Object.values(sizeQuantities).reduce((a, b) => a + b, 0)
      : Math.max(0, Math.floor(Number($('#quantity').value || 0))),
    is_active: $('#isActive').value === 'true',
    updated_at: new Date().toISOString(),
  };

  if (!payload.name || !payload.code || !payload.img) {
    $('#formError').textContent = 'الاسم والكود والصورة الرئيسية مطلوبة.';
    return;
  }

  try {
    let result;
    if (id) result = await sb.from('products').update(payload).eq('id', id).select().single();
    else result = await sb.from('products').insert(payload).select().single();
    if (result.error) throw result.error;
    if (payload.type === 'bags') await syncBagSetLinks(result.data.id);
    closeModal();
    toast(id ? 'تم تعديل المنتج' : 'تمت إضافة المنتج');
    await load();
  } catch (error) {
    $('#formError').textContent = error.message || 'تعذر حفظ المنتج';
  }
}

async function syncBagSetLinks(bagId) {
  const codes = [
    ...new Set(
      $('#bagSetLinks')
        .value.split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const { data: existing } = await sb
    .from('bag_set_links')
    .select('id,set_model_code')
    .eq('bag_product_id', bagId);
  const toDelete = (existing || []).filter((r) => !codes.includes(r.set_model_code)).map((r) => r.id);
  const existingCodes = new Set((existing || []).map((r) => r.set_model_code));
  const toInsert = codes
    .filter((c) => !existingCodes.has(c))
    .map((c) => ({ bag_product_id: bagId, set_model_code: c }));
  if (toDelete.length) await sb.from('bag_set_links').delete().in('id', toDelete);
  if (toInsert.length) await sb.from('bag_set_links').insert(toInsert);
}

async function remove(id) {
  const p = products.find((x) => Number(x.id) === Number(id));
  if (!p) return;
  if (!canEditType(p.type)) {
    toast('ماعندكش صلاحية حذف هذا القسم.');
    return;
  }
  if (!confirm(`حذف المنتج «${p.name}» نهائياً؟\nإذا كنت تبي توقف ظهوره فقط، عدّله وأطفل الحالة.`))
    return;
  try {
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) throw error;
    toast('تم حذف المنتج');
    await load();
  } catch (error) {
    alert('تعذر حذف المنتج: ' + error.message);
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const { data, error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(),
    password: $('#password').value,
  });
  if (error) {
    $('#loginError').textContent = error.message;
    return;
  }
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return;
  const check = await checkAdmin(session.access_token);
  if (check.ok) showApp(session, check);
  else {
    await sb.auth.signOut();
    $('#loginError').textContent = 'أنت لا تملك صلاحيات الإدارة.';
  }
});

(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) {
    $('#loginView').classList.remove('hidden');
    return;
  }
  const check = await checkAdmin(session.access_token);
  if (check.ok) showApp(session, check);
  else if (check.status === 401 || check.status === 403) {
    await sb.auth.signOut();
    $('#loginView').classList.remove('hidden');
  } else showApp(session);
})();

$('#logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  showLogin();
};
$('#refreshBtn').onclick = load;
$('#copySiteLinkBtn').onclick = async () => {
  const link = `${location.origin}/`;
  try {
    await navigator.clipboard.writeText(link);
    toast('تم نسخ رابط الموقع ✓');
  } catch (_) {
    prompt('انسخ رابط الموقع:', link);
  }
};
$('#addBtn').onclick = () => openModal();
$('#cancelBtn').onclick = closeModal;
$('#closeModal').onclick = closeModal;
$('#genModelCode').onclick = async () => {
  const { data, error } = await sb.rpc('next_model_code');
  if (error) {
    toast('تعذر توليد كود الموديل: ' + error.message);
    return;
  }
  $('#modelCode').value = data;
};
$('#modelCode').addEventListener('input', applyModelSizesIfAvailable);
$('#modelCode').addEventListener('change', applyModelSizesIfAvailable);
$('#search').addEventListener('input', render);
$('#migrateImagesBtn')?.addEventListener('click', migrateOldImages);

$('#type').addEventListener('change', () => {
  updateSizesRequired();
  renderSizeQuantities();
  applyModelSizesIfAvailable();
  toggleBagLinksField();
});
$('#sizes').addEventListener('input', () => {
  syncSelectedSizes();
  renderSizeQuantities();
  syncTotalQuantity();
});

$('#products').addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    const p = products.find((x) => Number(x.id) === Number(editBtn.dataset.edit));
    if (p) openModal(p);
    return;
  }
  const deleteBtn = e.target.closest('[data-delete]');
  if (deleteBtn) {
    remove(deleteBtn.dataset.delete);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('size-option')) {
    syncSelectedSizes();
    syncTotalQuantity();
  }
  if (e.target.classList.contains('size-quantity')) {
    syncTotalQuantity();
  }
});

$('#productForm').addEventListener('submit', save);
$('#imgButton').addEventListener('click', () => $('#imgFile').click());
$('#imgFile').addEventListener('change', handleImageFile);
