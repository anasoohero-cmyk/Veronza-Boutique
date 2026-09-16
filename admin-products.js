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

async function checkAdmin(token) {
  try {
    const r = await fetch('/api/admin-auth', { headers: { Authorization: `Bearer ${token}` } });
    let data = {};
    try {
      data = await r.json();
    } catch (_) {}
    return { ok: r.ok && data.ok === true, status: r.status };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

function showApp(session) {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#adminEmail').textContent = session.user.email || '';
  load();
}

function showLogin() {
  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

async function load() {
  const { data, error } = await sb
    .from('products')
    .select(
      'id,code,name,description,price,discount_price,type,img,extra_img,rating,reviews,colors,sizes,size_quantities,is_active,quantity,created_at,updated_at',
    )
    .order('id', { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  products = Array.isArray(data) ? data : [];
  render();
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const list = products.filter(
    (p) =>
      !q || String(p.name).toLowerCase().includes(q) || String(p.code).toLowerCase().includes(q),
  );
  const box = $('#products');
  if (!box) return;
  box.innerHTML = list
    .map((p) => {
      const hasDiscount = p.discount_price != null && Number(p.discount_price) < Number(p.price);
      const priceHtml = hasDiscount
        ? `<div class="price"><s>${Number(p.price || 0).toLocaleString('ar-LY')} د.ل</s><br>${Number(p.discount_price).toLocaleString('ar-LY')} د.ل</div>`
        : `<div class="price">${Number(p.price || 0).toLocaleString('ar-LY')} د.ل</div>`;
      return `<div class="product-row"><img class="thumb" src="${esc(p.img)}" alt=""><div class="product-main"><h3>${esc(p.name)}${hasDiscount ? ' <span class="badge off" style="background:#c0392b;color:#fff">خصم</span>' : ''}</h3><div class="meta">الكود: ${esc(p.code)} · النوع: ${typeNames[p.type] || esc(p.type)} · الكمية: ${Number(p.quantity || 0)}<br>الألوان: ${esc((p.colors || []).join('، ') || '—')} · المقاسات: ${esc((p.sizes || []).join('، ') || '—')}</div></div>${priceHtml}<span class="badge ${p.is_active ? 'on' : 'off'}">${p.is_active ? 'متوفر' : 'غير متوفر'}</span><div class="row-actions"><button data-edit="${p.id}">تعديل</button><button class="danger" data-delete="${p.id}">حذف</button></div></div>`;
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
  $('#type').value = 'shoes';
  $('#extraImgs').value = '';
  $('#isActive').value = 'true';
  $('#sizeOptions').innerHTML = '';
  $('#sizeQuantities').innerHTML = '';
  currentImages = [];
  renderPreview();
}

function openModal(p) {
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
    $('#modalTitle').textContent = 'تعديل المنتج';
    renderPreview();
  }
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
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

async function uploadImageFile(file) {
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from('product-images')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
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
  renderSizeOptions([], {});
}

function renderSizeQuantities(existing = {}) {
  document.querySelectorAll('.size-quantity').forEach((input) => {
    const size = input.dataset.size;
    input.value = existing[size] || 0;
  });
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
  const isSized = $('#type').value === 'shoes' || $('#type').value === 'set';

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
  if (discountPrice != null && (Number.isNaN(discountPrice) || discountPrice >= price)) {
    $('#formError').textContent = 'سعر الخصم لازم يكون أقل من السعر الأصلي.';
    return;
  }

  const sizeQuantities = isSized ? getSizeQuantities() : {};

  const payload = {
    name: $('#name').value.trim(),
    description: $('#description').value.trim() || null,
    code: $('#code').value.trim(),
    price,
    discount_price: discountPrice,
    type: $('#type').value,
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
    closeModal();
    toast(id ? 'تم تعديل المنتج' : 'تمت إضافة المنتج');
    await load();
  } catch (error) {
    $('#formError').textContent = error.message || 'تعذر حفظ المنتج';
  }
}

async function remove(id) {
  const p = products.find((x) => Number(x.id) === Number(id));
  if (!p) return;
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
  if (check.ok) showApp(session);
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
  if (check.ok) showApp(session);
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
$('#addBtn').onclick = () => openModal();
$('#cancelBtn').onclick = closeModal;
$('#closeModal').onclick = closeModal;
$('#search').addEventListener('input', render);
$('#migrateImagesBtn')?.addEventListener('click', migrateOldImages);

$('#type').addEventListener('change', () => {
  updateSizesRequired();
  renderSizeQuantities();
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
