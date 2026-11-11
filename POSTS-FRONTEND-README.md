# Posts frontend — انسخ الملفات فوق مشروع UIP-React بنفس المسارات

## جديد
- src/api/postsApi.js, src/lib/postMedia.js, src/styles/css/posts.css
- src/pages/posts/PostsFeed.jsx (الفيد + الكومبوزر), src/pages/posts/AdminPosts.jsx (إعدادات/خوارزمية، بلاغات، موافقات)
- src/components/posts/: PostCard, PostMedia, Comments, Composer, PdfCarousel (تقليب جانبي), PdfFull, CodeCard (تشغيل HTML/JS في iframe معزول + sandbox للباقي), SandboxTerminal, highlight.js, shared.jsx

## معدّل (سطور قليلة — لو ملفاتك اتغيرت طبّقها يدويًا)
- src/App.jsx: import لـ PostsFeed/AdminPosts + routes `/<portal>/posts` لكل البورتالات و `/admin/posts-control`
- src/config/navConfig.js: دالة withPosts (بند "المنشورات" بعد مكتبتي، perm posts.use) + بند "Posts Control" في قسم messaging للأدمن (perm posts.moderate)

## ملاحظات
- الفيديو/الصوت بيشتغلوا من رابط موقّع (`/media/{id}/link`)، والصور وPDF من الـ API بالتوكن.
- الملفات ≥ 4MB بتترفع على أجزاء عبر /messaging/uploads ثم POST /posts/media {upload_id}.
- زر Run للأكواد بيحتاج sandbox gateway متظبط على الباك اند؛ HTML/CSS/JS بتشتغل في iframe بدون same-origin.
- ما اتعملش build (مفيش node_modules هنا): الملفات اتفحصت syntax بـ esbuild وكل الـ imports اتأكدت إنها موجودة. شغّل `npm run dev` وجرّب.
