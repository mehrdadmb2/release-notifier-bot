# راهنمای نصب و جایگزینی Release Watcher v5.0

این بسته نسخهٔ کامل Worker، بات تلگرام، GitHub Pages، GitHub Actions و تست‌ها را دارد. معماری جدید طوری تنظیم شده که فقط Triggerهای مشخص‌شده اسکن واقعی GitHub را اجرا کنند؛ تمام درخواست‌های نمایشی از دیتای ذخیره‌شده استفاده می‌کنند.

## نکتهٔ حیاتی: KV فعلی را حفظ کن

برای جلوگیری از حذف شدن مشترکین و داده‌های قبلی، از همان دو Namespace فعلی Cloudflare استفاده می‌کنیم:

- `RELEASES`: دیتای Release، مشخصات Repository، تاریخچه نسخه، Snapshot روزانه و وضعیت اسکن
- `USERS`: فهرست Chat IDهای مشترک بات

در فایل `wrangler.toml` این دو مقدار عمداً placeholder هستند:

```toml
[[kv_namespaces]]
binding = "RELEASES"
id = "REPLACE_WITH_EXISTING_RELEASES_KV_NAMESPACE_ID"

[[kv_namespaces]]
binding = "USERS"
id = "REPLACE_WITH_EXISTING_USERS_KV_NAMESPACE_ID"
```

قبل از Deploy باید ID واقعی Namespaceهای متصل به Worker فعلی را در Cloudflare Dashboard از مسیر **Workers & Pages → release-watcher-bot → Settings → Bindings** برداری و جایگزین کنی. اگر IDهای واقعی در فایل فعلی سیستم تو وجود دارد، همان IDها را بدون تغییر نگه دار. Namespace جدید نساز و Binding را rename نکن؛ این دو کار می‌تواند باعث شود Worker به دیتابیس خالی وصل شود و مشترکین قبلی را نبیند.

## ۱. جایگزینی فایل‌ها در GitHub

1. از ریپوی فعلی یک ZIP یا Clone پشتیبان تهیه کن.
2. ZIP نسخهٔ v5.0 را Extract کن.
3. همهٔ فایل‌ها و پوشه‌ها از جمله `.github/workflows/`، `src/` و `assets/` را در ریشهٔ ریپوی `release-notifier-bot` جایگزین کن.
4. فایل `wrangler.toml` را باز کن و فقط دو KV ID را با مقادیر واقعی خودت تکمیل کن.
5. مقدار `name` و آدرس Worker را بررسی کن؛ این نسخه برای Worker فعلی `release-watcher-bot` تنظیم شده است.

فهرست پیش‌فرض ۸ ریپو از قبل در `REPOS` قرار دارد و داشبورد فهرست را مستقیم از Worker دریافت می‌کند.

## ۲. تست محلی و ورود به Wrangler

در PowerShell وارد پوشه پروژه شو:

```powershell
npm install
npx wrangler login
npm run check
npm test
```

هر سه تست فعلی باید موفق شوند. تست‌ها از Mock استفاده می‌کنند و به API واقعی GitHub یا Telegram پیام ارسال نمی‌کنند.

## ۳. تنظیم Secretهای Cloudflare

این Secretها را در محیط Worker ثبت کن. Wrangler هنگام اجرای هر دستور ورودی امن می‌گیرد؛ مقدار را داخل فایل‌ها یا پیام عمومی قرار نده:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SET_WEBHOOK_SECRET
npx wrangler secret put CHECK_SECRET
npx wrangler secret put ADMIN_CHAT_IDS
```

توضیحات:

- `TELEGRAM_BOT_TOKEN`: توکن BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: مقدار تصادفی برای اعتبارسنجی درخواست‌های ورودی تلگرام؛ استفاده از آن توصیه می‌شود.
- `SET_WEBHOOK_SECRET`: رمز مستقل برای راه‌اندازی Webhook.
- `CHECK_SECRET`: کلید اصلی اجرای اسکن از API و داشبورد.
- `ADMIN_CHAT_IDS`: شناسه عددی چت مدیر یا مدیران. برای چند مدیر، IDها را با ویرگول جدا کن، مثلاً `123456789,987654321`.

`GITHUB_TOKEN` برای اجرای اسکن در نسخه 5.0.1 **اجباری** است. API عمومی GitHub سهمیه احراز هویت‌نشده محدودی دارد و IP خروجی Cloudflare ممکن است بین کاربران Workerها مشترک باشد؛ بنابراین حتی فهرست کوچک ریپوها هم نباید به سهمیه ناشناس متکی باشد.

**ساخت توکن خواندنی GitHub:**

1. در GitHub به `Settings → Developer settings → Personal access tokens → Fine-grained tokens` برو و یک توکن جدید بساز.
2. برای این پروژه فقط دسترسی خواندن لازم است. برای ریپوهای عمومی، دسترسی عمومی/خواندنی را انتخاب کن؛ اگر ریپوی خصوصی هم مانیتور می‌کنی، همان ریپو را در Repository access قرار بده.
3. در Repository permissions این دسترسی‌ها را تنظیم کن:
   - `Metadata: Read-only` (معمولاً به‌صورت پیش‌فرض فعال است).
   - `Contents: Read-only` (برای خواندن Releaseها).
4. هیچ دسترسی Write، Administration، Actions یا Secrets لازم نیست.
5. توکن را فقط به‌عنوان Secret داخل Cloudflare Worker ذخیره کن:

```powershell
npx wrangler secret put GITHUB_TOKEN
```

مقدار توکن را در Cloudflare وارد کن و سپس Worker را Deploy کن:

```powershell
npm run deploy
```

6. پس از Deploy، این آدرس را باز کن:

`https://release-watcher-bot.game-developer-mb.workers.dev/health`

باید این فیلد را ببینی:

```json
{
  "githubAuthConfigured": true,
  "githubAuthMode": "authenticated"
}
```

این فقط وجود Secret را تأیید می‌کند، نه اعتبار یا مجوز آن را؛ اعتبار واقعی هنگام اسکن مشخص می‌شود. توکن را در GitHub Pages، JavaScript، فایل `wrangler.toml` یا Repository Variables قرار نده. آن را در GitHub Actions هم لازم نیست ذخیره کنی؛ درخواست اسکن از Worker انجام می‌شود و Worker خودش از Secret استفاده می‌کند.

### بهینه‌سازی و مدیریت Rate Limit در v5.0.1

- برای Metadata و Latest Release از درخواست‌های شرطی `ETag / If-None-Match` استفاده می‌شود؛ پاسخ `304 Not Modified` از Payload ذخیره‌شده در KV بازیابی می‌شود.
- اگر GitHub سهمیه اصلی یا ثانویه را محدود کند، اسکن بلافاصله متوقف می‌شود؛ دیگر برای ریپوهای بعدی درخواست تکراری نمی‌فرستد.
- زمان Reset و منبع Rate Limit در خروجی اسکن ثبت می‌شود.
- پاسخ `401` به‌عنوان توکن نامعتبر/منقضی و خطاهای مجوز `403` جداگانه گزارش می‌شوند.
- GitHub Action قبل از اسکن `/health` را بررسی می‌کند و در صورت نبودن Secret، پیام راهنمای واضح می‌دهد.

## ۴. Deploy Worker

پس از جایگزینی KV IDها و تنظیم Secretها:

```powershell
npm run deploy
```

در v5.0 عمداً هیچ `[triggers] crons` در `wrangler.toml` نداریم. اسکن دوره‌ای فقط از GitHub Actions اجرا می‌شود تا یک اسکن هم‌زمان از Cron کلادفلر و Action اتفاق نیفتد.

بررسی سلامت Worker:

```powershell
Invoke-RestMethod "https://release-watcher-bot.game-developer-mb.workers.dev/health"
```

در پاسخ باید `ok: true` و عبارت `GitHub Actions daily + authenticated manual scan` را ببینی.

## ۵. راه‌اندازی Telegram Webhook

بعد از Deploy این دستور را در PowerShell اجرا کن:

```powershell
$setupSecret = Read-Host "Enter SET_WEBHOOK_SECRET"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/setwebhook" `
  -Headers @{ "X-Setup-Secret" = $setupSecret }
```

خروجی موفق باید `ok: true` داشته باشد. همین درخواست Webhook و Command Menu ربات را ثبت می‌کند؛ منوی جدید شامل `/check` هم هست.

## ۶. فعال‌کردن اسکن روزانه GitHub Actions

در GitHub ریپو برو به:

**Settings → Secrets and variables → Actions → New repository secret**

یک Secret با این نام بساز:

```text
WORKER_CHECK_SECRET
```

مقدارش باید دقیقاً با `CHECK_SECRET` که در مرحله ۳ برای Cloudflare Worker ثبت کردی یکسان باشد. مقدار این کلید را در فایل workflow قرار نده.

فایل زیر در بسته اضافه شده است:

```text
.github/workflows/daily-repository-scan.yml
```

این Workflow هر روز ساعت `02:17 UTC` اجرا می‌شود و به `POST /check` درخواست احراز هویت‌شده می‌فرستد. برای اجرای دستی:

1. وارد تب **Actions** ریپو شو.
2. Workflow با نام **Daily repository scan** را انتخاب کن.
3. روی **Run workflow** کلیک کن.

در GitHub ممکن است اجرای زمان‌بندی‌شده در ساعات پرترافیک با کمی تأخیر شروع شود؛ `workflow_dispatch` برای اجرای فوری در دسترس است. مطمئن شو GitHub Actions در ریپو غیرفعال نشده باشد.

## ۷. اولین اسکن و پر کردن دیتابیس

بعد از Deploy و تنظیم `WORKER_CHECK_SECRET` یکی از این مسیرها را انتخاب کن:

**روش پیشنهادی از داشبورد:**

1. صفحه GitHub Pages را باز کن.
2. روی **Run repository scan** بزن.
3. مقدار `CHECK_SECRET` را در پنجره وارد کن.
4. منتظر نتیجه اسکن بمان؛ بعد از تکمیل، داشبورد Snapshot جدید را از Worker می‌خواند.

یا از تلگرام (فقط مدیران مجاز):

```text
/check
```

یا از PowerShell:

```powershell
$checkSecret = Read-Host "Enter CHECK_SECRET"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/check" `
  -Headers @{ "X-Check-Secret" = $checkSecret; "X-Scan-Source" = "powershell-manual" }
```

در اولین اسکن، Worker نسخه فعلی را بدون اعلان انبوه به‌عنوان Baseline ذخیره می‌کند و در صورت امکان نسخه پایدار قبلی را هم از فهرست Releaseهای GitHub پیدا می‌کند. پس از آن، هر تغییر Tag به شکل `previous → current` ثبت و به مشترکین اعلان می‌شود.

## ۸. رفتار دقیق دکمه‌ها و دستورها

| عملیات | اسکن واقعی GitHub؟ | توضیح |
| --- | --- | --- |
| باز کردن سایت | خیر | فقط Snapshot از KV دریافت می‌شود |
| Refresh Snapshot | خیر | فقط `/api/overview` را دوباره می‌خواند |
| باز کردن جزئیات هر Repo | خیر | تاریخچه و آمار ذخیره‌شده را نمایش می‌دهد |
| `/repos` | خیر | وضعیت و نسخه‌های ذخیره‌شده |
| `/latest` | خیر | خلاصه تمام Releaseهای ذخیره‌شده |
| `/latest owner/repo` | خیر | changelog و assetهای نسخه ذخیره‌شده |
| `/status` | خیر | وضعیت آخرین اسکن ذخیره‌شده |
| `/check` در تلگرام | بله | فقط IDهای موجود در `ADMIN_CHAT_IDS` |
| Run repository scan در سایت | بله | نیازمند `CHECK_SECRET` است |
| GitHub Action روزانه | بله | تنها Trigger زمان‌بندی‌شده |
| GitHub Actions → Run workflow | بله | Trigger دستی دوم |

**نکته:** به‌روزرسانی جزئیات صفحه یا زدن Refresh باعث مصرف API سهمیه GitHub نمی‌شود. فقط مسیرهای اسکن واقعی با GitHub ارتباط می‌گیرند.

## ۹. فعال‌سازی GitHub Pages

1. فایل‌ها را روی Branch اصلی ریپو Push کن.
2. وارد **Settings → Pages** شو.
3. گزینه **Deploy from a branch** را انتخاب کن.
4. Branch اصلی و پوشه `/(root)` را انتخاب و Save کن.
5. بعد از اتمام Deployment این آدرس را باز کن:

`https://mehrdadmb2.github.io/release-notifier-bot/`

در `wrangler.toml` مقدار `PUBLIC_SITE_ORIGIN` باید فقط Origin باشد، نه مسیر کامل صفحه:

```text
https://mehrdadmb2.github.io
```

آدرس Worker در ابتدای `assets/app.js` تنظیم شده است. اگر بعداً Worker hostname را تغییر دادی، مقدار `WORKER_BASE` را هم با آن هماهنگ کن.

## ۱۰. مدل ذخیره‌سازی و حفظ تاریخچه

همان Namespace فعلی `RELEASES` حفظ شده و کلیدهای جدید به آن افزوده شده‌اند:

| Key prefix | محتوا |
| --- | --- |
| `release:owner/repo` | آخرین Release به همراه changelog، assets و `previousTag` |
| `check:owner/repo` | زمان و نتیجه آخرین بررسی و منبع Trigger |
| `repo:owner/repo` | Metadata فعلی Repository |
| `history:owner/repo` | تاریخچه نسخه‌ها (حداکثر ۱۰۰ رکورد) |
| `snapshots:owner/repo` | آمار روزانه (حداکثر ۱۸۰ روز) |
| `meta:last-scan` | خلاصه آخرین اجرای سراسری |

هر Snapshot روزانه بر اساس تاریخ UTC یکتا است؛ چند اسکن دستی در یک روز رکوردهای تکراری ایجاد نمی‌کنند و همان روز را به‌روزرسانی می‌کنند. مقادیر قدیمی `release:` نیز قابل خواندن هستند و هنگام اولین اسکن جدید به ساختار تازه تبدیل می‌شوند.

## ۱۱. تست نهایی

```powershell
npm run check
npm test
npx wrangler tail
```

موارد زیر را بررسی کن:

- [ ] Worker با Bindingهای واقعی `RELEASES` و `USERS` Deploy شده است.
- [ ] `/health` مقدار `ok: true` برمی‌گرداند.
- [ ] Telegram Webhook با موفقیت ثبت شده و `/start` پاسخ می‌دهد.
- [ ] `WORKER_CHECK_SECRET` در GitHub Actions برابر `CHECK_SECRET` در Cloudflare است.
- [ ] Workflow روزانه در تب Actions قابل مشاهده و Run دستی است.
- [ ] اولین اسکن با `checked` موفق تمام شده و KV برای Repoها داده دارد.
- [ ] داشبورد `Worker connected` نشان می‌دهد و نسخه قبلی/فعلی و جزئیات Repo را نمایش می‌دهد.
- [ ] Refresh Snapshot هیچ اسکن جدیدی اجرا نمی‌کند.
- [ ] پس از تغییر Release در یکی از ریپوها، پیام تلگرام هر دو نسخه قبلی و جدید را نشان می‌دهد.

## بازیابی و عیب‌یابی

- **سایت خالی یا `Worker API unavailable`:** ابتدا `/health` را باز کن. سپس `RELEASES` binding و ID آن را بررسی کن. بعد از تغییر Bindingها یک اسکن دستی اجرا کن.
- **همه داده‌ها خالی هستند:** احتمالاً Worker به Namespace خالی یا اشتباه متصل شده است. ID Namespace قبلی را بازیابی کن؛ ساختن یک KV جدید داده‌های قبلی را برنمی‌گرداند.
- **GitHub Action با 401 شکست می‌خورد:** مقدار `WORKER_CHECK_SECRET` در GitHub را با `CHECK_SECRET` در Worker مقایسه کن. خطای 401 از خود GitHub نشان می‌دهد `GITHUB_TOKEN` در Cloudflare نامعتبر یا منقضی است.
- **GitHub Action با خطای 404 مواجه می‌شود:** آدرس `WORKER_URL` در Workflow و نام Worker را بررسی کن.
- **یک Repo وضعیت `not-found` دارد:** املای `owner/repo`، عمومی/خصوصی بودن ریپو و دسترسی `GITHUB_TOKEN` را بررسی کن.
- **خطای Rate Limit:** اسکن اکنون در اولین خطای Rate Limit متوقف می‌شود. `GITHUB_TOKEN` را به‌عنوان Worker Secret تنظیم کن، زمان `rateLimitResetAt` را بررسی کن و پس از Reset دوباره اسکن کن. اجرای مکرر Workflow پیش از Reset مشکل را حل نمی‌کند.
- **ربات پیام نمی‌دهد:** `TELEGRAM_BOT_TOKEN`، Webhook، `TELEGRAM_WEBHOOK_SECRET` و لاگ‌های `npx wrangler tail` را بررسی کن.

هیچ‌کدام از Secretها را در GitHub Pages، JavaScript سمت کاربر یا فایل‌های عمومی قرار نده.
