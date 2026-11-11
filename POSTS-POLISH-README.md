# Posts polish — انسخ الملفات فوق UIP-React-main بنفس المسارات

- components/posts/CodeCard.jsx — كارت الكود: أرقام أسطر، fade، أزرار نظيفة، معاينة HTML (كمبيوتر/موبايل، إعادة تحميل، ملء الشاشة، تغيير الارتفاع) وscrollbar رفيع
- components/posts/Composer.jsx — ملفات بأيقونات/صور مصغرة وأحجام مقروءة في RTL، محرر كود (أرقام أسطر، Tab، كشف اللغة)، قائمة اللغات في portal، مسجّل صوت جديد (موجة حيّة، إيقاف مؤقت، حذف، تم)، معاينة الرابط
- components/posts/LinkCard.jsx (جديد) — كارت رابط احترافي
- components/posts/PostCard.jsx, pages/posts/PublicPost.jsx — استخدام LinkCard + أيقونة التعليق
- styles/css/posts.css, posts-pro.css — أنماط الكل (اتشالت قواعد :has() القديمة)
