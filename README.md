# Veronza Boutique

متجر إلكتروني (PWA) لبيع الأحذية والشنط الفاخرة، لعملاء ليبيا. الواجهة مبنية بـ HTML/CSS/JavaScript خام (بدون فريمورك)، والباك اند عبارة عن API functions على Vercel تتكلم مع Supabase.

## البنية التقنية

- **الواجهة (Frontend):** HTML + CSS + JavaScript عادي (بدون بناء/bundler)، PWA كامل (`manifest.webmanifest`, `service-worker.js`).
- **قاعدة البيانات والمصادقة (Backend):** [Supabase](https://supabase.com) — جداول المنتجات، الطلبات، حسابات العملاء، الأدمن، والمحادثات.
- **الاستضافة والدوال الخلفية:** [Vercel](https://vercel.com) — كل ملف داخل `api/` هو Serverless Function مستقلة (`vercel.json` يوجّه `/api/*` إليها).
- **واتساب:** [Meta WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp) لإرسال تأكيد الطلبات وتحديثات الحالة.
- **إشعارات الأدمن:** Web Push عبر مكتبة [`web-push`](https://www.npmjs.com/package/web-push) (VAPID keys محفوظة في Supabase).

## هيكل المشروع

```
├── index.html, styles.css, app.js       # واجهة المتجر (منتجات، سلة، تشك اوت)
├── auth.js                              # حساب الزبون (تسجيل دخول/تسجيل، عناوين، طلباتي)
├── chat-widget.js                       # ودجت الشات للزبون
├── product/<CODE>/index.html            # صفحة ثابتة لكل منتج (مشاركة روابط)
├── admin*.html, admin*.js, admin*.css   # لوحة تحكم الأدمن (الطلبات، المنتجات، الشات)
├── service-worker.js, manifest*.webmanifest  # PWA (تخزين مؤقت، تثبيت كتطبيق)
├── api/
│   ├── send-order.js       # استقبال الطلب: يعيد حساب السعر/المخزون من السيرفر ويرسل واتساب
│   ├── track-order.js      # تتبع طلب عبر الهاتف + رقم الطلب (بدون تسجيل دخول)
│   ├── admin-auth.js       # التحقق من صلاحية الأدمن (Supabase session + جدول admin_users)
│   ├── admin-orders.js     # عرض/تحديث حالة الطلبات (للأدمن فقط)
│   ├── push-config.js      # تسليم مفتاح VAPID العام (للأدمن فقط)
│   ├── push-subscribe.js   # تسجيل/حذف اشتراك Push (للأدمن فقط)
│   ├── chat.js             # محادثات الزبون مع الأدمن
│   └── version.js          # نسخة النشر الحالية (لتحديث الـ PWA تلقائياً)
```

## متغيرات البيئة (Environment Variables)

تُضبط من لوحة تحكم Vercel (Project Settings → Environment Variables). بدونها بعض الميزات ترجع خطأ "Server configuration incomplete" بدل ما تتوقف الموقع كامل.

| المتغير | الاستخدام |
|---|---|
| `SUPABASE_URL` | رابط مشروع Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح Supabase الإداري (سري — للسيرفر فقط، لا يظهر في المتصفح) |
| `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` | مفتاح Supabase العام، يُستخدم فقط للتحقق من جلسة المستخدم (`/auth/v1/user`) |
| `META_ACCESS_TOKEN` | توكن Meta WhatsApp Cloud API |
| `META_PHONE_NUMBER_ID` | رقم هاتف واتساب المرتبط بحساب Meta Business |
| `WHATSAPP_ORDER_RECIPIENT` | رقم واتساب الأدمن اللي تصله تفاصيل الطلبات الجديدة |
| `SITE_URL` | رابط الموقع النهائي (يُستخدم في روابط المنتجات المرسلة بواتساب)؛ اختياري — يتراجع تلقائياً لـ `VERCEL_URL` |

> **ملاحظة:** المفتاح المستخدم داخل `app.js` و `auth.js` (يبدأ بـ `sb_publishable_...`) هو مفتاح Supabase العام (Publishable/Anon) المخصص للعمل من المتصفح مباشرة — نشره في الكود أمر متوقع وسليم، بعكس `SUPABASE_SERVICE_ROLE_KEY` اللي يجب أن يبقى سري على السيرفر فقط.

## جداول Supabase المتوقعة

`products`, `orders`, `order_items`, `admin_users`, `customer_profiles`, `customer_addresses`, `wishlist_items`, `notifications`, `push_config`, `push_subscriptions`, `chat_conversations`, `chat_messages` — بالإضافة إلى دالة RPC واحدة على الأقل: `place_order_atomic` (حجز المخزون وإنشاء الطلب بشكل atomic) و `validate_cart_stock`.

## التشغيل والنشر

المشروع بلا خطوة بناء (`buildCommand: null` في `vercel.json`) — أي دفعة (push) على الفرع المربوط بـ Vercel تُنشر مباشرة. الاعتماد الوحيد في `package.json` هو `web-push`، ويُثبَّت تلقائياً عند نشر دوال `api/`.

## لوحة الأدمن

الدخول من `/admin.html` بحساب Supabase مُسجَّل مسبقاً في جدول `admin_users` — تسجيل الدخول لوحده غير كافٍ للوصول، الحساب يجب أن يكون له صف في هذا الجدول.
