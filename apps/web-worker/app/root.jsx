// ديلاوي — غلاف المستند (عربي RTL) + الهيدر والفوتر المشتركان.
// لا روابط تنقّل لصفحات غير موجودة بعد: الهيدر فيه اسم الموقع فقط.
import { Links, Meta, Outlet, Scripts, ScrollRestoration, Link, isRouteErrorResponse, useRouteError } from "react-router";
import "./app.css";

export function links() {
  return [
    {
      rel: "icon",
      href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%2314532d'/%3E%3Ctext x='50' y='70' font-size='62' text-anchor='middle' fill='white' font-family='sans-serif'%3E%D8%AF%3C/text%3E%3C/svg%3E",
    },
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap",
    },
  ];
}

export function meta() {
  return [
    { title: "ديلاوي" },
    { name: "theme-color", content: "#f7f8f7" },
    { name: "description", content: "أسعار نون مصر من المتابعة الفعلية — ديلاوي" },
  ];
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "حدث خطأ غير متوقع.";
  let message = "حاول مرة أخرى، أو ارجع للصفحة الرئيسية.";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "غير موجود";
      message = typeof error.data === "string" ? error.data : "الصفحة غير موجودة.";
    } else {
      message = `خطأ ${error.status}.`;
    }
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-balance">{title}</h1>
      <p className="mt-2 text-muted">{message}</p>
      <Link to="/" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 font-bold text-white hover:bg-primary-dark">
        الرجوع للمنتجات
      </Link>
    </main>
  );
}

export default function Root() {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
        >
          تخطَّ إلى المحتوى
        </a>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link to="/" className="text-xl font-bold text-primary">
              ديلاوي
            </Link>
            <span className="text-sm text-muted">أسعار نون مصر — متابعة حقيقية</span>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-center text-xs leading-relaxed text-muted">
          نسخة تجريبية — الأسعار من متابعة نون (Spike) وليست عرضاً مباشراً من المتجر. تحقق من السعر على صفحة المنتج قبل الشراء.
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
