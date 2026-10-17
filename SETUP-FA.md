# راهنمای نصب و جایگزینی نسخهٔ 4.0

این نسخه شامل Worker، ربات تلگرام، داشبورد GitHub Pages و تست‌های خودکار است. زمان بررسی پیش‌فرض را **ساعتی** نگه داشته‌ام تا رفتار نسخهٔ قبلی عوض نشود و تعداد درخواست‌های GitHub API بی‌دلیل افزایش پیدا نکند.

## قبل از هر کاری: از KVهای فعلی محافظت کن

مهم‌ترین نکته این است که فهرست مشترکین و نسخه‌های ثبت‌شده داخل Cloudflare KV نگهداری می‌شوند. فایل `wrangler.toml` داخل بسته عمداً به‌جای ID واقعی دو فضای KV، مقدارهای زیر را دارد:

- `REPLACE_WITH_EXISTING_RELEASES_KV_NAMESPACE_ID`
- `REPLACE_WITH_EXISTING_USERS_KV_NAMESPACE_ID`

**قبل از Deploy باید هر دو را با ID واقعی Namespaceهای متصل به Worker فعلی جایگزین کنی.** در Cloudflare Dashboard وارد **Workers & Pages → release-watcher-bot → Settings → Bindings** شو و IDهای Bindingهای `RELEASES` و `USERS` را بردار. این دو فضای فعلی را حذف یا با فضای جدید جایگزین نکن؛ در غیر این صورت ممکن است تاریخچهٔ انتشارها و فهرست کاربران قبلی قابل‌دسترسی نباشند.

## ۱. فایل‌ها را در ریپو جایگزین کن

1. فایل ZIP را استخراج کن.
2. از ریپوی فعلی یک نسخهٔ پشتیبان بگیر.
3. فایل‌های استخراج‌شده را در ریشهٔ ریپوی `release-notifier-bot` کپی کن و فایل‌های موجود را با نسخه‌های جدید جایگزین کن.
4. `wrangler.toml` را باز کن و دو KV ID واقعی را وارد کن.
5. مطمئن شو مقدار `name = "release-watcher-bot"` و آدرس Worker موردنظر همان Worker فعلی است.

مخزن‌های تحت نظر در متغیر `REPOS` از قبل تنظیم شده‌اند:

```text
2dust/v2rayN
2dust/v2rayNG
diegosouzapw/OmniRoute
WhiteDNS/WhiteDNS-Android
shirokhorshid/shirokhorshid-android
KNG7-P/Se7en-Pro
therealaleph/MasterHttpRelayVPN-RUST
anonvector/SlipNet
```

## ۲. تست محلی و آماده‌سازی Wrangler

در PowerShell وارد پوشهٔ پروژه شو:

```powershell
npm install
npx wrangler login
npm run check
npm test
```

دو تست خودکار باید موفق شوند. آن‌ها با Mock اجرا می‌شوند و انتشار واقعی در GitHub یا پیامی در تلگرام ایجاد نمی‌کنند.

## ۳. Secretهای Cloudflare را تنظیم کن

هر دستور را اجرا کن و مقدار را فقط در ورودی تعاملی Wrangler وارد کن. توکن‌ها را داخل سورس، `wrangler.toml` یا ریپوی GitHub قرار نده.

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SET_WEBHOOK_SECRET
npx wrangler secret put CHECK_SECRET
```

برای هر Secret مقدار قوی و مجزا انتخاب کن. `TELEGRAM_WEBHOOK_SECRET` باید فقط از حروف انگلیسی، عدد، `_` و `-` ساخته شده و ۱ تا ۲۵۶ کاراکتر باشد.

برای فعال‌کردن دستور مدیریتی `/check` در تلگرام، شناسهٔ عددی چت مدیر را هم به‌صورت Secret ثبت کن؛ اگر چند مدیر داری، شناسه‌ها را با ویرگول جدا کن:

```powershell
npx wrangler secret put ADMIN_CHAT_IDS
```

اگر این گزینه را تنظیم نکنی، `/check` برای کاربران عادی اجرا نمی‌شود. بررسی خودکار Cron مستقل از این دستور ادامه پیدا می‌کند.

## ۴. Deploy با Wrangler

پس از واردکردن IDهای KV واقعی و تنظیم Secretها:

```powershell
npm run deploy
```

Cron در `wrangler.toml` برابر `0 * * * *` است؛ یعنی یک بار در هر ساعت. نسخهٔ اولیهٔ موجود در KV به‌صورت پیش‌فرض بی‌سروصدا ثبت می‌شود تا هنگام اولین اجرا اعلان انبوه از انتشارهای قدیمی ارسال نشود. انتشار جدید بعدی اعلان ایجاد می‌کند.

## ۵. Webhook تلگرام را فعال کن

بعد از Deploy، این دستورات را مستقیماً در PowerShell اجرا کن. هنگام درخواست ورودی، مقدار Secret مربوط به `SET_WEBHOOK_SECRET` را بده:

```powershell
$setupSecret = Read-Host "Enter SET_WEBHOOK_SECRET"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/setwebhook" `
  -Headers @{ "X-Setup-Secret" = $setupSecret }
```

خروجی موفق باید شامل `ok: true` باشد. همین درخواست، Webhook تلگرام و منوی دستورات ربات را ثبت می‌کند.

## ۶. بررسی دستی و لاگ‌ها

برای اجرای یک بررسی فوری و احراز هویت‌شده:

```powershell
$checkSecret = Read-Host "Enter CHECK_SECRET"
Invoke-RestMethod -Method Post `
  -Uri "https://release-watcher-bot.game-developer-mb.workers.dev/check" `
  -Headers @{ "X-Check-Secret" = $checkSecret }
```

مشاهدهٔ لاگ‌های زنده:

```powershell
npx wrangler tail
```

مسیر وضعیت سرویس هم در دسترس است:

`https://release-watcher-bot.game-developer-mb.workers.dev/health`

## ۷. فعال‌کردن GitHub Pages

1. تغییرات فایل‌ها را به Branch اصلی (`main`) ریپو Push کن.
2. در GitHub وارد **Settings → Pages** شو.
3. از بخش **Build and deployment** گزینهٔ **Deploy from a branch** را انتخاب کن.
4. Branch را روی `main` و پوشه را روی `/(root)` قرار بده و Save کن.
5. بعد از تکمیل Deployment صفحه را باز کن:

`https://mehrdadmb2.github.io/release-notifier-bot/`

داشبورد از مسیر `/api/overview` روی Worker دادهٔ ذخیره‌شده را می‌خواند. در صورت نمایش `Using static watchlist` یا `Worker API unavailable`، ابتدا مسیر `/health` را بررسی کن و بعد لاگ‌های Worker را ببین. مقدار `PUBLIC_SITE_ORIGIN` باید دقیقاً `https://mehrdadmb2.github.io` باشد.

## ۸. تست ربات تلگرام

در گفت‌وگوی خصوصی ربات این فرمان‌ها را امتحان کن:

- `/start` ثبت اشتراک
- `/help` راهنمای دستورات
- `/repos` فهرست مخزن‌ها و آخرین وضعیت ثبت‌شده
- `/latest` دریافت خلاصهٔ زنده از همهٔ مخزن‌ها
- `/latest WhiteDNS/WhiteDNS-Android` اطلاعات کامل یک مخزن
- `/status` تعداد کاربران، مخزن‌ها و وضعیت آخرین بررسی
- `/stop` لغو اشتراک

در پیام انتشار، نام مخزن و نسخه با monospace، توضیحات انتشار با quote، لینک‌های مستقیم و دکمه‌های تلگرام ارائه می‌شوند.

## نکته دربارهٔ ریپوی GitHub

نسخهٔ عمومی ریپو در حال حاضر `wrangler.toml` با IDهای placeholder داشته است. من نمی‌توانم از بیرون IDهای واقعی Bindingهای Worker حساب Cloudflare تو را ببینم؛ باید آن‌ها را از تنظیمات Worker فعلی برداری. **قبل از اصلاح این دو ID، `wrangler deploy` را اجرا نکن.**
